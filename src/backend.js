import {
  TRACKER_SCHEMA_VERSION,
} from "./schemas.js";
import {
  CHAT_KEYS,
  INACTIVE_CASE,
  SETUP_FORMAT,
  IMPORT_LOADED_TEXT,
  BEGIN_SETUP_TEXT,
  assignSetupSources,
  importedSetupForMessage,
  initialSetupForBranch,
  isImportSetupSelection,
  validateSetupFile,
  contentToText,
  buildSurpriseMeSample,
  compactPromptMessages,
  createStore,
  deriveTranscriptContext,
  isV14Prompt,
  latestValidCheckpoint,
  listEligibleTurns,
  normalizeStore,
  prefixFingerprint,
  remapTrackerStateSourceIds,
  selectCheckpoint,
  stripStartupMenuMarkers,
  transcriptForMigration,
} from "./state.js";
import {
  DEFAULT_TRACKER_OUTPUT_MODE,
  DEFAULT_TRACKER_MAX_TOKENS,
  DEFAULT_TRACKER_TIMEOUT_MS,
  MAX_TRACKER_MAX_TOKENS,
  MAX_TRACKER_TIMEOUT_MS,
  MIN_TRACKER_MAX_TOKENS,
  MIN_TRACKER_TIMEOUT_MS,
  TRACKER_OUTPUT_MODES,
  runMigrationTracker,
  runTracker,
} from "./tracker.js";

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  showStatusWidget: true,
  connectionId: "",
  maxTokens: DEFAULT_TRACKER_MAX_TOKENS,
  timeoutMs: DEFAULT_TRACKER_TIMEOUT_MS,
  outputMode: DEFAULT_TRACKER_OUTPUT_MODE,
});

const queues = new Map();
const userByChat = new Map();
const activeChatByUser = new Map();
const deletedChats = new Set();
const pendingCleanupByUser = new Map();
const beginningSetups = new Set();
const generatingChats = new Set();
let interceptorRegistered = false;
let activeChatId = null;
let frontendUserId = undefined;

const CLEANUP_CONFIRMATION_TTL_MS = 2 * 60 * 1000;

function validUserId(userId) {
  return typeof userId === "string" && Boolean(userId.trim());
}

function adoptActiveChat(chatId, userId) {
  if (typeof chatId === "string" && chatId.trim()) {
    activeChatId = chatId;
    if (validUserId(userId)) {
      frontendUserId = userId;
      userByChat.set(chatId, userId);
      activeChatByUser.set(userId, chatId);
    }
  }
  if (validUserId(userId)) return activeChatByUser.get(userId) ?? null;
  return activeChatId;
}

function userForChat(chatId, userId) {
  if (validUserId(userId)) {
    frontendUserId = userId;
    if (chatId) userByChat.set(chatId, userId);
    return userId;
  }
  return userByChat.get(chatId) ?? frontendUserId;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function normalizeConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: source.enabled !== false,
    showStatusWidget: source.showStatusWidget !== false,
    connectionId: typeof source.connectionId === "string" ? source.connectionId : "",
    outputMode: TRACKER_OUTPUT_MODES.includes(source.outputMode)
      ? source.outputMode
      : DEFAULT_TRACKER_OUTPUT_MODE,
    maxTokens: boundedInteger(
      source.maxTokens,
      DEFAULT_TRACKER_MAX_TOKENS,
      MIN_TRACKER_MAX_TOKENS,
      MAX_TRACKER_MAX_TOKENS,
    ),
    timeoutMs: boundedInteger(
      source.timeoutMs,
      DEFAULT_TRACKER_TIMEOUT_MS,
      MIN_TRACKER_TIMEOUT_MS,
      MAX_TRACKER_TIMEOUT_MS,
    ),
  };
}

async function loadConfig() {
  const value = await spindle.storage.getJson("config.json", { fallback: DEFAULT_CONFIG });
  return normalizeConfig(value);
}

async function saveConfig(value) {
  const config = normalizeConfig(value);
  await spindle.storage.setJson("config.json", config, { indent: 2 });
  return config;
}

async function saveWidgetVisibility(showStatusWidget) {
  const current = await loadConfig();
  return saveConfig({ ...current, showStatusWidget });
}

function safeChatToken(chatId) {
  return String(chatId ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180);
}

function storePath(chatId) {
  return `chats/${safeChatToken(chatId)}.json`;
}

async function loadStore(chatId) {
  const value = await spindle.storage.getJson(storePath(chatId), {
    fallback: createStore(chatId),
  });
  return normalizeStore(value, chatId);
}

async function saveStore(chatId, store) {
  await spindle.storage.setJson(storePath(chatId), store, { indent: 2 });
}

function isInertStore(value) {
  if (!value || typeof value !== "object" || value.processing === true) return false;
  const checkpoints = value.checkpoints && typeof value.checkpoints === "object"
    ? value.checkpoints
    : {};
  return (
    !String(value.caseText ?? "").trim()
    && value.current == null
    && value.initialSetup == null
    && Object.keys(checkpoints).length === 0
    && Number(value.revision ?? 0) === 0
    && value.migrationAccepted !== true
    && value.migrationRequired !== true
    && !String(value.migrationBaselineKey ?? "").trim()
    && !String(value.migrationBaselineFingerprint ?? "").trim()
    && !String(value.lastError ?? "").trim()
    && !String(value.lastWarning ?? "").trim()
    && !String(value.lastRevisionAt ?? "").trim()
  );
}

function cleanupUserKey(userId) {
  return validUserId(userId) ? userId : "__default__";
}

function strictStoreFile(entry) {
  return typeof entry === "string" && /^[a-zA-Z0-9_-]{1,180}\.json$/.test(entry);
}

async function readCleanupStore(entry) {
  if (!strictStoreFile(entry)) return null;
  const path = `chats/${entry}`;
  let raw;
  try {
    raw = await spindle.storage.read(path);
  } catch (error) {
    throw new Error(`Could not read ${path}: ${String(error?.message ?? error)}`);
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || ![1, 2].includes(value.schemaVersion)) return null;
  const chatId = typeof value.chatId === "string" ? value.chatId.trim() : "";
  if (!chatId || entry !== `${safeChatToken(chatId)}.json`) return null;
  return { path, chatId, value };
}

async function missingChat(chatId) {
  try {
    await spindle.chat.getMessages(chatId);
    return false;
  } catch (error) {
    if (String(error?.message ?? error).trim() === "Chat not found") return true;
    throw error;
  }
}

async function classifyCleanupStore(entry) {
  const parsed = await readCleanupStore(entry);
  if (!parsed) return null;
  let reason = "";
  if (isInertStore(parsed.value)) reason = "inert";
  else if (await missingChat(parsed.chatId)) reason = "orphan";
  if (!reason) return null;
  let sizeBytes = 0;
  try {
    const stat = await spindle.storage.stat(parsed.path);
    sizeBytes = Number.isFinite(Number(stat?.sizeBytes)) ? Number(stat.sizeBytes) : 0;
  } catch {
    // Size is informational; a readable validated file remains a candidate.
  }
  return { ...parsed, reason, sizeBytes };
}

async function scanUnusedStores() {
  const entries = await spindle.storage.list("chats/");
  const result = {
    candidates: [],
    scanned: Array.isArray(entries) ? entries.length : 0,
    skipped: 0,
    errors: 0,
  };
  for (const entry of Array.isArray(entries) ? entries : []) {
    try {
      const candidate = await classifyCleanupStore(entry);
      if (candidate) result.candidates.push(candidate);
      else result.skipped += 1;
    } catch (error) {
      result.errors += 1;
      spindle.log.warn(`Continuity cleanup skipped ${String(entry)}: ${String(error?.message ?? error)}`);
    }
  }
  result.inert = result.candidates.filter((candidate) => candidate.reason === "inert").length;
  result.orphan = result.candidates.filter((candidate) => candidate.reason === "orphan").length;
  result.sizeBytes = result.candidates.reduce((total, candidate) => total + candidate.sizeBytes, 0);
  return result;
}

function forgetChat(chatId) {
  userByChat.delete(chatId);
  for (const [userId, mappedChatId] of activeChatByUser.entries()) {
    if (mappedChatId === chatId) activeChatByUser.delete(userId);
  }
  if (activeChatId === chatId) activeChatId = null;
}

function formatStorageSize(sizeBytes) {
  const bytes = Math.max(0, Number(sizeBytes) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function setVariableIfChanged(chatId, key, value) {
  const previous = await spindle.variables.chat.get(chatId, key);
  if (previous !== value) await spindle.variables.chat.set(chatId, key, value);
}

async function mirrorStore(chatId, store, context) {
  const current = store.current;
  const legacyArc = current
    ? {
      npcs: (current.arc?.npcs ?? []).map((npc) => ({
        name: npc.name,
        role: npc.role,
        relationship: npc.relationship,
        currentStatus: npc.currentStatus,
        immediateObjective: npc.immediateObjective,
      })),
      relationship: current.arc?.relationship ?? {},
      objectives: (current.arc?.objectives ?? []).map((objective) => ({
        owner: objective.owner,
        objective: objective.objective,
        status: objective.status,
      })),
    }
    : null;
  await Promise.all([
    setVariableIfChanged(chatId, CHAT_KEYS.case, context.active ? context.caseText : INACTIVE_CASE),
    setVariableIfChanged(chatId, CHAT_KEYS.phase, context.active ? "active" : "setup"),
    setVariableIfChanged(
      chatId,
      CHAT_KEYS.trackerVersion,
      context.active ? String(TRACKER_SCHEMA_VERSION) : "",
    ),
    setVariableIfChanged(chatId, CHAT_KEYS.scene, current ? JSON.stringify(current.scene) : ""),
    setVariableIfChanged(chatId, CHAT_KEYS.arc, current ? JSON.stringify(current.arc) : ""),
    setVariableIfChanged(chatId, CHAT_KEYS.legacyArc, legacyArc ? JSON.stringify(legacyArc) : ""),
    setVariableIfChanged(chatId, CHAT_KEYS.revision, String(store.revision ?? 0)),
  ]);
}

function readiness(config) {
  const missing = ["generation", "interceptor", "chat_mutation"].filter(
    (permission) => !spindle.permissions.has(permission),
  );
  if (!config.enabled) {
    return { level: "amber", code: "disabled", text: "Continuity Engine is installed but disabled." };
  }
  if (missing.length > 0) {
    return {
      level: "amber",
      code: "permissions",
      text: `Continuity Engine needs permission: ${missing.join(", ")}.`,
    };
  }
  return {
    level: "green",
    code: "ready",
    text: "Continuity Engine ready. Open a Date Simulator v1.4.x or v1.5.x chat to begin tracking.",
  };
}

function sendFrontend(payload, userId = frontendUserId) {
  try {
    spindle.sendToFrontend(payload, userId);
  } catch {
    // Frontend may not be connected yet.
  }
}

export function publicTrackerSnapshot(state) {
  if (!state || typeof state !== "object") return null;
  const scene = state.scene && typeof state.scene === "object" ? state.scene : {};
  const woman = scene.womanCurrent && typeof scene.womanCurrent === "object"
    ? scene.womanCurrent
    : {};
  const womanStable = scene.womanStable && typeof scene.womanStable === "object"
    ? scene.womanStable
    : {};
  const sceneLifecycle = scene.lifecycle && typeof scene.lifecycle === "object"
    ? scene.lifecycle
    : {};
  const manVisible = scene.manVisible && typeof scene.manVisible === "object"
    ? scene.manVisible
    : {};
  const spatial = scene.spatial && typeof scene.spatial === "object"
    ? scene.spatial
    : {};
  const arc = state.arc && typeof state.arc === "object" ? state.arc : {};
  const arcLifecycle = arc.lifecycle && typeof arc.lifecycle === "object"
    ? arc.lifecycle
    : {};
  const relationship = arc.relationship && typeof arc.relationship === "object"
    ? arc.relationship
    : {};
  const text = (value, fallback = "Unknown") => (
    typeof value === "string" && value.trim() ? value : fallback
  );

  return {
    scene: {
      date: text(scene.date),
      time: text(scene.time),
      weather: text(scene.weather),
      location: text(scene.location),
      immediateContext: text(scene.immediateContext),
      lifecycle: {
        status: text(sceneLifecycle.status, "active"),
      },
      womanStable: {
        face: text(womanStable.face),
        eyes: text(womanStable.eyes),
        skin: text(womanStable.skin),
        bodyTypeAndProportions: text(womanStable.bodyTypeAndProportions),
      },
      womanCurrent: {
        hairAndGrooming: text(woman.hairAndGrooming),
        dress: text(woman.dress),
        physicalState: text(woman.physicalState),
      },
      manVisible: {
        appearance: text(manVisible.appearance),
        dressAndLayers: text(manVisible.dressAndLayers),
        physicalState: text(manVisible.physicalState),
      },
      spatial: {
        womanPosition: text(spatial.womanPosition),
        manPosition: text(spatial.manPosition),
        proximityAndContact: text(spatial.proximityAndContact),
        importantItems: text(spatial.importantItems),
      },
    },
    arc: {
      lifecycle: {
        status: text(arcLifecycle.status, "active"),
      },
      npcs: Array.isArray(arc.npcs)
        ? arc.npcs.map((npc) => ({
          name: text(npc?.name),
          role: text(npc?.role),
          relationship: text(npc?.relationship),
          currentStatus: text(npc?.currentStatus),
        }))
        : [],
      relationship: {
        establishedStatus: text(relationship.establishedStatus, "No relationship status established."),
        latestChange: text(relationship.latestChange, "No recent relationship change."),
      },
    },
  };
}

async function statusPayload(chatId, options = {}) {
  const config = await loadConfig();
  const base = readiness(config);
  if (!chatId) return { type: "continuity_status", ...base, config, chatId: null };
  const store = await loadStore(chatId);
  let caseMessageId = null;
  let profileSaved = false;
  let caseError = "";
  let setup = { canImport: false, canExport: false, canBegin: false, fingerprint: "" };
  if (spindle.permissions.has("chat_mutation")) {
    try {
      const messages = await spindle.chat.getMessages(chatId);
      const transcript = deriveTranscriptContext(messages);
      setup = setupAvailability(messages, store, base.level === "green");
      caseMessageId = transcript.caseMessageId ?? transcript.invalidCaseMessageId;
      caseError = transcript.caseError;
      profileSaved = Boolean(
        transcript.active &&
        store.caseText === transcript.caseText &&
        store.epochKey === transcript.epochKey
      );
    } catch {
      // Status remains useful without a branch read.
    }
  }
  const payload = {
    type: "continuity_status",
    ...base,
    chatId,
    caseMessageId,
    profileSaved,
    config,
    processing: Boolean(store.processing),
    migrationRequired: Boolean(store.migrationRequired && !store.migrationAccepted),
    lastError: store.lastError || "",
    lastWarning: store.lastWarning || "",
    revision: store.revision || 0,
    lastRevisionAt: store.lastRevisionAt || "",
    publicState: publicTrackerSnapshot(store.current),
    setup,
  };
  if (payload.migrationRequired) {
    payload.level = "amber";
    payload.code = "migration_required";
    payload.text = "Legacy v1.3.1 state found. Open Continuity and choose Migrate Current Chat.";
  } else if (payload.processing) {
    payload.level = "amber";
    payload.code = "processing";
    payload.text = "Continuity Engine is updating scene and arc state…";
  } else if (payload.lastError) {
    payload.level = "amber";
    payload.code = "error";
    payload.text = `Continuity Engine kept the last valid state: ${payload.lastError}`;
  } else if (payload.lastWarning) {
    payload.level = "amber";
    payload.code = "recovered";
    payload.text = `Continuity Engine updated state conservatively: ${payload.lastWarning}`;
  } else if (caseError) {
    payload.level = "amber";
    payload.code = "invalid_profile";
    payload.text = `Continuity Engine could not save the private profile: ${caseError}`;
  } else if (base.level === "green" && caseMessageId && !profileSaved) {
    payload.level = "amber";
    payload.code = "profile_saving";
    payload.text = "Continuity Engine detected. Saving the private profile outside chat context…";
  } else if (base.level === "green" && caseMessageId && profileSaved) {
    payload.level = "green";
    payload.code = "ready";
    payload.text = "Continuity Engine active. Private profile saved; scene and arc tracking are automatic.";
  } else if (base.level === "green") {
    payload.code = "ready_no_profile";
    payload.text = "Continuity Engine ready. No Date Simulator v1.4.x or v1.5.x private profile was found in this chat yet.";
  }
  if (options.includePrivate) payload.state = store.current;
  return payload;
}

function setupAvailability(messages, store, ready = true) {
  const context = deriveTranscriptContext(messages);
  const turns = listEligibleTurns(messages, context);
  const markedMenu = messages.some((message) => message.role === "assistant"
    && /<!--DATE_SIM_STARTUP_MENU_V1-->/.test(contentToText(message.content))
    && /Import Saved Setup/.test(contentToText(message.content)));
  const imported = importedSetupForMessage(messages[context.caseMessageIndex]);
  return {
    canImport: ready && !context.active && markedMenu,
    canExport: Boolean(context.active && initialSetupForBranch(store, turns, context.caseText)),
    canBegin: Boolean(ready && imported && !messages.slice(context.caseMessageIndex + 1).some((m) => m.role === "user")),
    fingerprint: prefixFingerprint(messages, messages.length - 1),
  };
}

async function publishStatus(chatId, options = {}, userId) {
  sendFrontend(await statusPayload(chatId, options), userForChat(chatId, userId));
}

async function selectedBranchStillMatches(chatId, turn) {
  const messages = await spindle.chat.getMessages(chatId);
  const index = messages.findIndex((message) => String(message?.id ?? "") === String(turn.assistant.id));
  if (index < 0) return false;
  return prefixFingerprint(messages, index) === turn.fingerprint;
}

function resetForEpoch(store, context) {
  if (store.epochKey === context.epochKey) return store;
  const next = createStore(store.chatId);
  next.epochKey = context.epochKey;
  next.caseText = context.caseText ?? "";
  next.migrationRequired = context.migrationRequired;
  return next;
}

function recordRevision(store, timestamp = new Date().toISOString()) {
  store.revision += 1;
  store.lastRevisionAt = timestamp;
}

async function performMigration(chatId, messages, context, store, config, userId) {
  const turns = listEligibleTurns(messages, context);
  const latest = turns.at(-1);
  if (!latest) throw new Error("No immersive assistant turn is available to migrate.");
  const result = await runMigrationTracker(
    spindle,
    {
      caseText: context.caseText,
      legacySceneText: context.legacySceneText,
      transcript: transcriptForMigration(messages, context),
      sourceMessageId: String(latest.assistant.id),
    },
    config,
    userId,
  );
  if (!(await selectedBranchStillMatches(chatId, latest))) {
    throw new Error("The selected branch changed during migration.");
  }
  const createdAt = new Date().toISOString();
  store.checkpoints[latest.key] = {
    fingerprint: latest.fingerprint,
    state: result.state,
    warnings: result.warnings,
    createdAt,
    migrated: true,
  };
  store.current = result.state;
  store.lastWarning = result.warnings.join("; ").slice(0, 500);
  store.migrationAccepted = true;
  store.migrationRequired = false;
  store.migrationBaselineKey = latest.key;
  store.migrationBaselineFingerprint = latest.fingerprint;
  recordRevision(store, createdAt);
  return store;
}

async function reconcileChat(chatId, options = {}, userId) {
  if (!chatId || deletedChats.has(chatId) || !spindle.permissions.has("chat_mutation")) return;
  const scopedUserId = userForChat(chatId, userId);
  const config = await loadConfig();
  const messages = await spindle.chat.getMessages(chatId);
  const context = deriveTranscriptContext(messages);
  const existingStore = await spindle.storage.exists(storePath(chatId));
  if (!context.active && !existingStore) {
    await publishStatus(chatId, {}, scopedUserId);
    return;
  }
  let store = resetForEpoch(await loadStore(chatId), context);

  if (!context.active) {
    store.caseText = "";
    store.current = null;
    store.processing = false;
    store.migrationRequired = false;
    store.lastError = "";
    store.lastWarning = "";
    await saveStore(chatId, store);
    await mirrorStore(chatId, store, context);
    await publishStatus(chatId, {}, scopedUserId);
    return;
  }

  // Stable profile persistence is deterministic and must not wait for tracker
  // generation, provider availability, or structured-output repair.
  store.caseText = context.caseText;
  store.processing = false;
  // Imported metadata carries a validated portable seed. Rebuild its local
  // checkpoint without a model call, including after sidecar loss or a fork.
  const initialTurns = listEligibleTurns(messages, context);
  const imported = importedSetupForMessage(messages[context.caseMessageIndex]);
  if (imported && initialTurns[0] && !selectCheckpoint(store, initialTurns[0])) {
    const first = initialTurns[0];
    const state = assignSetupSources(imported.initialState, String(first.assistant.id));
    const createdAt = new Date().toISOString();
    store.checkpoints[first.key] = { fingerprint: first.fingerprint, state, warnings: [], createdAt, imported: true };
    store.current = state;
    recordRevision(store, createdAt);
  }
  store.initialSetup = initialSetupForBranch(store, initialTurns, context.caseText);
  await saveStore(chatId, store);
  await mirrorStore(chatId, store, context);
  await publishStatus(chatId, {}, scopedUserId);

  const nativeCurrent = /\b(?:Date Simulator\s+)?v1\.(?:4(?:\.\d+)?|5)\b/i.test(context.caseText);
  if (!nativeCurrent && !store.migrationAccepted && !options.allowMigration) {
    store.migrationRequired = true;
    store.processing = false;
    await saveStore(chatId, store);
    await mirrorStore(chatId, store, context);
    await publishStatus(chatId, {}, scopedUserId);
    return;
  }

  if (!nativeCurrent && store.migrationAccepted && store.migrationBaselineKey) {
    const turns = listEligibleTurns(messages, context);
    const baselineIndex = turns.findIndex(
      (turn) =>
        turn.key === store.migrationBaselineKey &&
        turn.fingerprint === store.migrationBaselineFingerprint,
    );
    const baseline = baselineIndex >= 0 ? selectCheckpoint(store, turns[baselineIndex]) : null;
    if (!baseline) {
      store.migrationAccepted = false;
      store.migrationRequired = true;
      store.migrationBaselineKey = "";
      store.migrationBaselineFingerprint = "";
      store.current = null;
      store.processing = false;
      await saveStore(chatId, store);
      await mirrorStore(chatId, store, context);
      await publishStatus(chatId, {}, scopedUserId);
      return;
    }
  }

  if (!config.enabled) {
    store.processing = false;
    await saveStore(chatId, store);
    await mirrorStore(chatId, store, context);
    await publishStatus(chatId, {}, scopedUserId);
    return;
  }
  if (!spindle.permissions.has("generation")) {
    store.processing = false;
    store.lastError = "Generation permission is not granted.";
    await saveStore(chatId, store);
    await mirrorStore(chatId, store, context);
    await publishStatus(chatId, {}, scopedUserId);
    return;
  }

  store.processing = true;
  store.lastError = "";
  await saveStore(chatId, store);
  await publishStatus(chatId, {}, scopedUserId);

  try {
    if (options.allowMigration && !nativeCurrent && !store.migrationAccepted) {
      store = await performMigration(chatId, messages, context, store, config, scopedUserId);
    } else {
      const turns = listEligibleTurns(messages, context);
      let previousState = null;
      let startIndex = 0;

      if (store.migrationAccepted && store.migrationBaselineKey) {
        const baselineIndex = turns.findIndex(
          (turn) =>
            turn.key === store.migrationBaselineKey &&
            turn.fingerprint === store.migrationBaselineFingerprint,
        );
        if (baselineIndex >= 0) {
          const baseline = selectCheckpoint(store, turns[baselineIndex]);
          if (baseline) {
            previousState = baseline.state;
            startIndex = baselineIndex + 1;
          }
        }
      }

      if (!previousState) {
        const prior = latestValidCheckpoint(store, turns);
        if (prior && prior.turnIndex === turns.length - 1 && !options.forceLatest) {
          previousState = prior.checkpoint.state;
          startIndex = turns.length;
        }
      }

      for (let index = startIndex; index < turns.length; index += 1) {
        const turn = turns[index];
        const existing = options.forceLatest && index === turns.length - 1 && !importedSetupForMessage(turn.assistant)
          ? null
          : selectCheckpoint(store, turn);
        if (existing) {
          previousState = existing.state;
          continue;
        }
        const result = await runTracker(
          spindle,
          {
            caseText: context.caseText,
            previousState,
            userText: turn.userText,
            assistantText: turn.assistantText,
            sourceMessageId: String(turn.assistant.id),
          },
          config,
          scopedUserId,
        );
        if (!(await selectedBranchStillMatches(chatId, turn))) {
          throw new Error("The selected branch changed while tracking.");
        }
        const createdAt = new Date().toISOString();
        store.checkpoints[turn.key] = {
          fingerprint: turn.fingerprint,
          state: result.state,
          warnings: result.warnings,
          createdAt,
        };
        previousState = result.state;
        store.lastWarning = result.warnings.join("; ").slice(0, 500);
        recordRevision(store, createdAt);
        store.initialSetup = initialSetupForBranch(store, turns, context.caseText);
      }

      const liveKeys = new Set(turns.map((turn) => turn.key));
      store.checkpoints = Object.fromEntries(
        Object.entries(store.checkpoints).filter(([key]) => liveKeys.has(key)),
      );
      store.current = previousState;
      store.initialSetup = initialSetupForBranch(store, turns, context.caseText);
    }
    store.lastError = "";
  } catch (error) {
    store.lastError = String(error?.message ?? error).slice(0, 500);
    spindle.log.warn(`Date Simulator continuity update failed for ${chatId}: ${store.lastError}`);
  } finally {
    store.processing = false;
    await saveStore(chatId, store);
    await mirrorStore(chatId, store, context);
    await publishStatus(chatId, {}, scopedUserId);
  }
}

function scheduleChatTask(chatId, task, label = "Continuity queue") {
  if (!chatId) return Promise.resolve();
  const previous = queues.get(chatId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(task)
    .catch((error) => spindle.log.error(`${label} failed: ${String(error)}`))
    .finally(() => {
      if (queues.get(chatId) === current) queues.delete(chatId);
    });
  queues.set(chatId, current);
  return current;
}

function scheduleReconcile(chatId, options = {}, userId) {
  if (!chatId || deletedChats.has(chatId)) return Promise.resolve();
  const scopedUserId = userForChat(chatId, userId);
  return scheduleChatTask(
    chatId,
    () => reconcileChat(chatId, options, scopedUserId),
    "Continuity queue",
  );
}

async function handleSetupAction(payload, userId) {
  const chatId = typeof payload.chatId === "string" ? payload.chatId : "";
  const respond = (ok, message, extra = {}) => sendFrontend({
    type: "continuity_setup_result", requestId: payload.requestId, action: payload.type,
    chatId, ok, message, ...extra,
  }, userId);
  const perform = async () => {
    try {
      if (!chatId || deletedChats.has(chatId)) throw new Error("Open a Date Simulator chat first.");
      if (!spindle.permissions.has("chat_mutation")) throw new Error("Continuity Engine needs chat_mutation permission.");
      const messages = await spindle.chat.getMessages(chatId);
      const store = await loadStore(chatId);
      const ready = readiness(await loadConfig()).level === "green";
      const available = setupAvailability(messages, store, ready);
      if (payload.type === "continuity_export_setup") {
        const context = deriveTranscriptContext(messages);
        const baseline = initialSetupForBranch(store, listEligibleTurns(messages, context), context.caseText);
        if (!context.active || !baseline) throw new Error("The original opening checkpoint is unavailable. An exact initial setup cannot be exported.");
        const result = validateSetupFile({ format: SETUP_FORMAT, version: 1, profile: context.caseText,
          initialState: assignSetupSources(baseline.state, "initial-setup") });
        if (!result.value) throw new Error(result.error);
        store.initialSetup = baseline;
        await saveStore(chatId, store);
        respond(true, "Initial setup is ready to save.", { fileText: `${JSON.stringify(result.value, null, 2)}\n`, filename: "date-simulator-initial-setup.json" });
      } else if (payload.type === "continuity_import_setup") {
        if (generatingChats.has(chatId)) throw new Error("Wait for the current response to finish before importing.");
        if (!available.canImport) throw new Error("Import requires an unused v1.5.6 startup menu and an enabled Continuity Engine with its required permissions. Open a new chat or reset this case first.");
        if (!payload.fingerprint || payload.fingerprint !== available.fingerprint) throw new Error("The chat changed while choosing the file. Choose the file again from the current setup.");
        const result = validateSetupFile(payload.fileText);
        if (!result.value) throw new Error(result.error);
        const liveMessages = await spindle.chat.getMessages(chatId);
        if (generatingChats.has(chatId) || prefixFingerprint(liveMessages, liveMessages.length - 1) !== available.fingerprint) {
          throw new Error("The chat changed during validation. Choose the file again after the current response finishes.");
        }
        await spindle.chat.appendMessage(chatId, {
          role: "assistant", content: IMPORT_LOADED_TEXT,
          metadata: { date_simulator_setup: result.value },
        });
        await reconcileChat(chatId, {}, userId);
        respond(true, "Setup loaded. Select Begin Simulation to present the starting scene.", { status: await statusPayload(chatId) });
      } else if (payload.type === "continuity_begin_setup") {
        if (!available.canBegin || generatingChats.has(chatId)) throw new Error("This imported setup has already begun, a response is running, or Continuity Engine is not ready.");
        await spindle.chat.appendMessage(chatId, { role: "user", content: BEGIN_SETUP_TEXT,
          metadata: { date_simulator_begin: true } }, true);
        respond(true, "The starting scene was requested. Continue in chat when the response is ready.");
      }
    } catch (error) {
      respond(false, String(error?.message ?? error).slice(0, 500));
    }
  };
  if (payload.type === "continuity_begin_setup") {
    // Never hold our queue while the host starts a generation: its interceptor
    // must be able to reconcile this chat before the request reaches the model.
    if (beginningSetups.has(chatId)) return respond(false, "This setup is already starting.");
    beginningSetups.add(chatId);
    try { await scheduleReconcile(chatId, {}, userId); await perform(); }
    finally { beginningSetups.delete(chatId); }
  } else {
    await scheduleChatTask(chatId, perform, "Saved setup action");
  }
}

function normalizeForkEvent(payload) {
  const sourceChatId = typeof payload?.sourceChatId === "string" ? payload.sourceChatId.trim() : "";
  const forkedChatId = typeof payload?.forkedChatId === "string" ? payload.forkedChatId.trim() : "";
  const forkedAtMessageId = typeof payload?.forkedAtMessageId === "string"
    ? payload.forkedAtMessageId.trim()
    : "";
  const rawMap = payload?.messageIdMap;
  if (!sourceChatId || !forkedChatId || sourceChatId === forkedChatId || !forkedAtMessageId) return null;
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) return null;

  const messageIdMap = new Map();
  const forkedIds = new Set();
  for (const [sourceId, forkedIdValue] of Object.entries(rawMap)) {
    const forkedId = typeof forkedIdValue === "string" ? forkedIdValue.trim() : "";
    if (!sourceId || !forkedId || forkedIds.has(forkedId)) return null;
    messageIdMap.set(sourceId, forkedId);
    forkedIds.add(forkedId);
  }
  if (!messageIdMap.has(forkedAtMessageId)) return null;
  return { sourceChatId, forkedChatId, forkedAtMessageId, messageIdMap };
}

/** Seed a newly-created Lumiverse fork from the source chat's validated prefix. */
async function inheritForkCheckpoints(payload, userId) {
  const fork = normalizeForkEvent(payload);
  if (!fork || !spindle.permissions.has("chat_mutation")) return false;
  const scopedUserId = userForChat(fork.forkedChatId, userId);
  const forkPath = storePath(fork.forkedChatId);
  if (await spindle.storage.exists(forkPath)) {
    const existing = await loadStore(fork.forkedChatId);
    if (!isInertStore(existing)) return false;
  }

  const forkMessages = await spindle.chat.getMessages(fork.forkedChatId);
  const reverseMap = new Map([...fork.messageIdMap].map(([sourceId, forkedId]) => [forkedId, sourceId]));
  if (
    forkMessages.length !== fork.messageIdMap.size
    || forkMessages.some((message) => !reverseMap.has(String(message?.id ?? "")))
  ) {
    spindle.log.warn(`Continuity fork inheritance skipped for ${fork.forkedChatId}: incomplete message id map.`);
    return false;
  }

  // Reconstruct the exact source prefix from the copied branch. This avoids a
  // race with later edits or messages in the source chat while still allowing
  // its stored fingerprints to prove that every inherited checkpoint matches.
  const sourcePrefix = forkMessages.map((message) => ({
    ...message,
    id: reverseMap.get(String(message.id)),
  }));
  const sourceContext = deriveTranscriptContext(sourcePrefix);
  const forkContext = deriveTranscriptContext(forkMessages);
  if (
    sourceContext.active !== forkContext.active
    || String(sourceContext.caseText ?? "") !== String(forkContext.caseText ?? "")
  ) {
    spindle.log.warn(`Continuity fork inheritance skipped for ${fork.forkedChatId}: branch context mismatch.`);
    return false;
  }
  if (!forkContext.active) return true;

  const sourceStore = await loadStore(fork.sourceChatId);
  const sourceTurns = listEligibleTurns(sourcePrefix, sourceContext);
  const forkTurns = listEligibleTurns(forkMessages, forkContext);
  if (sourceTurns.length !== forkTurns.length) {
    spindle.log.warn(`Continuity fork inheritance skipped for ${fork.forkedChatId}: eligible turn mismatch.`);
    return false;
  }

  const inherited = createStore(fork.forkedChatId);
  inherited.epochKey = forkContext.epochKey;
  inherited.caseText = forkContext.caseText ?? "";
  let latestCheckpoint = null;
  let inheritedMigrationBaseline = false;

  for (let index = 0; index < sourceTurns.length; index += 1) {
    const sourceTurn = sourceTurns[index];
    const forkTurn = forkTurns[index];
    if (fork.messageIdMap.get(String(sourceTurn.assistant.id)) !== String(forkTurn.assistant.id)) break;
    const checkpoint = selectCheckpoint(sourceStore, sourceTurn);
    if (!checkpoint) break;
    const state = remapTrackerStateSourceIds(checkpoint.state, fork.messageIdMap);
    if (!state) {
      spindle.log.warn(`Continuity fork inheritance stopped for ${fork.forkedChatId}: incomplete provenance map.`);
      break;
    }
    const forkCheckpoint = {
      ...checkpoint,
      fingerprint: forkTurn.fingerprint,
      state,
    };
    inherited.checkpoints[forkTurn.key] = forkCheckpoint;
    inherited.current = state;
    inherited.revision += 1;
    inherited.lastRevisionAt = checkpoint.createdAt || inherited.lastRevisionAt;
    inherited.lastWarning = Array.isArray(checkpoint.warnings)
      ? checkpoint.warnings.join("; ").slice(0, 500)
      : "";
    latestCheckpoint = forkCheckpoint;

    if (index === 0) {
      const baseline = initialSetupForBranch(sourceStore, sourceTurns, sourceContext.caseText);
      const initialState = baseline && remapTrackerStateSourceIds(baseline.state, fork.messageIdMap);
      if (initialState) inherited.initialSetup = { ...baseline, key: forkTurn.key,
        fingerprint: forkTurn.fingerprint, caseText: forkContext.caseText, state: initialState };
    }

    if (
      sourceStore.migrationAccepted
      && sourceStore.migrationBaselineKey === sourceTurn.key
      && sourceStore.migrationBaselineFingerprint === sourceTurn.fingerprint
    ) {
      inherited.migrationAccepted = true;
      inherited.migrationRequired = false;
      inherited.migrationBaselineKey = forkTurn.key;
      inherited.migrationBaselineFingerprint = forkTurn.fingerprint;
      inheritedMigrationBaseline = true;
    }
  }

  if (!inheritedMigrationBaseline) {
    inherited.migrationAccepted = false;
    inherited.migrationRequired = forkContext.migrationRequired;
  }
  inherited.processing = false;
  inherited.lastError = "";
  if (!latestCheckpoint) inherited.lastRevisionAt = "";

  await saveStore(fork.forkedChatId, inherited);
  await mirrorStore(fork.forkedChatId, inherited, forkContext);
  await publishStatus(fork.forkedChatId, {}, scopedUserId);
  return true;
}

function scheduleForkInheritance(payload, userId) {
  const fork = normalizeForkEvent(payload);
  if (!fork) return Promise.resolve(false);
  const sourcePending = queues.get(fork.sourceChatId) ?? Promise.resolve();
  // Reserve the fork queue immediately. CHAT_SWITCHED can follow the fork
  // event very quickly, and its normal reconciliation must run after seeding.
  return scheduleChatTask(
    fork.forkedChatId,
    async () => {
      await sourcePending.catch(() => undefined);
      return inheritForkCheckpoints(payload, userId);
    },
    "Continuity fork inheritance",
  );
}

async function removeDeletedChatStore(chatId) {
  if (!chatId) return;
  deletedChats.add(chatId);
  forgetChat(chatId);
  await scheduleChatTask(
    chatId,
    async () => {
      await spindle.storage.delete(storePath(chatId));
      forgetChat(chatId);
    },
    "Continuity chat cleanup",
  );
}

async function deleteUnusedStores() {
  const scan = await scanUnusedStores();
  let deleted = 0;
  let skipped = 0;
  let failed = 0;
  let deletedBytes = 0;

  for (const candidate of scan.candidates) {
    let removed = false;
    await scheduleChatTask(candidate.chatId, async () => {
      try {
        const current = await readCleanupStore(candidate.path.slice("chats/".length));
        if (!current) {
          skipped += 1;
          return;
        }
        const stillUnused = candidate.reason === "inert"
          ? isInertStore(current.value)
          : await missingChat(current.chatId);
        if (!stillUnused) {
          skipped += 1;
          return;
        }
        if (candidate.reason === "orphan") {
          deletedChats.add(candidate.chatId);
          forgetChat(candidate.chatId);
        }
        await spindle.storage.delete(candidate.path);
        removed = true;
      } catch (error) {
        failed += 1;
        spindle.log.warn(`Continuity cleanup could not delete ${candidate.path}: ${String(error?.message ?? error)}`);
      }
    }, "Continuity storage cleanup");
    if (removed) {
      deleted += 1;
      deletedBytes += candidate.sizeBytes;
    }
  }

  return { ...scan, deleted, skippedDuringDelete: skipped, failed, deletedBytes };
}

async function reconcileBeforePrompt(chatId) {
  if (!chatId || !spindle.permissions.has("chat_mutation")) return false;
  // Queue one verification pass even when an event-triggered update is already
  // running. The follow-up pass is normally a zero-generation checkpoint hit,
  // and closes races where prompt interception beats the message event.
  await scheduleReconcile(chatId, {}, userForChat(chatId));
  return true;
}

async function interceptPrompt(messages, context) {
  if (!isV14Prompt(messages)) return messages;
  const config = await loadConfig();
  if (!config.enabled) return messages;
  const chatId = context?.chatId;
  if (chatId) await reconcileBeforePrompt(chatId);

  let caseText = "";
  let state = null;
  let status = "starting";
  if (chatId) {
    const store = await loadStore(chatId);
    caseText = store.caseText;
    state = store.current;
    status = store.migrationRequired
      ? "migration_required"
      : store.lastError
        ? "degraded"
        : store.processing
          ? "processing"
          : "active";
  }

  // Setup turns need the card's worked case examples and gain nothing from an
  // empty tracker block. A Surprise Me turn may receive one deterministic,
  // prompt-only casting draw; begin continuity compaction only after a live
  // profile is saved.
  if (!caseText) {
    const sample = buildSurpriseMeSample(messages, chatId);
    if (!sample) return stripStartupMenuMarkers(messages);
    const sampledMessages = [...sample.messages];
    sampledMessages.splice(sample.insertionIndex, 0, sample.message);
    return {
      messages: sampledMessages,
      breakdown: [{ messageIndex: sample.insertionIndex, name: "Date Simulator Case Sampler" }],
    };
  }

  const compacted = compactPromptMessages(messages, caseText, state, status);
  return {
    messages: compacted.messages,
    breakdown: [
      {
        messageIndex: compacted.injectionIndex,
        name: "Date Simulator Continuity Engine",
      },
    ],
  };
}

function tryRegisterInterceptor() {
  if (interceptorRegistered || !spindle.permissions.has("interceptor")) return;
  spindle.registerInterceptor(interceptPrompt, 250);
  interceptorRegistered = true;
  spindle.log.info("Date Simulator Continuity Engine interceptor registered.");
}

for (const eventName of [
  "MESSAGE_SENT",
  "MESSAGE_EDITED",
  "MESSAGE_DELETED",
  "MESSAGE_SWIPED",
  "SWIPE_EDITED",
]) {
  spindle.on(eventName, (payload, userId) => {
    const chatId = adoptActiveChat(payload?.chatId, userId);
    if (eventName === "MESSAGE_SENT" && payload?.message && spindle.permissions.has("chat_mutation")) {
      // Only a real selected-branch startup command opens the drawer. Never
      // try to launch a browser file picker from a backend message event.
      spindle.chat.getMessages(chatId).then((messages) => {
        if (isImportSetupSelection(messages)) sendFrontend({ type: "continuity_open_import", chatId }, userId);
      }).catch(() => undefined);
    }
    return scheduleReconcile(chatId, {}, userId);
  });
}

spindle.on("CHAT_FORKED", (payload, userId) => scheduleForkInheritance(payload, userId));

for (const eventName of ["GENERATION_STARTED", "GENERATION_ENDED", "GENERATION_STOPPED"]) {
  spindle.on(eventName, (payload) => {
    if (!payload?.chatId) return;
    if (eventName === "GENERATION_STARTED") generatingChats.add(payload.chatId);
    else generatingChats.delete(payload.chatId);
  });
}

spindle.on("CHAT_DELETED", (payload) => {
  const chatId = typeof payload?.id === "string" ? payload.id : "";
  return removeDeletedChatStore(chatId);
});

spindle.on("CHAT_SWITCHED", (payload, userId) => {
  if (typeof payload?.chatId === "string" && payload.chatId) {
    const chatId = adoptActiveChat(payload.chatId, userId);
    scheduleReconcile(chatId, {}, userId);
    return;
  }
  if (validUserId(userId)) {
    const previousChatId = activeChatByUser.get(userId);
    activeChatByUser.delete(userId);
    if (activeChatId === previousChatId) activeChatId = null;
  } else {
    activeChatId = null;
  }
  publishStatus(null, {}, userId);
});

spindle.permissions.onChanged(({ permission, granted }) => {
  if (permission === "interceptor" && granted) tryRegisterInterceptor();
  if (activeChatId) scheduleReconcile(activeChatId);
});

spindle.onFrontendMessage(async (payload, userId) => {
  frontendUserId = userId;
  const type = payload?.type;
  if (["continuity_import_setup", "continuity_export_setup", "continuity_begin_setup"].includes(type)) {
    await handleSetupAction(payload, userId);
  } else if (type === "continuity_get_status") {
    const chatId = adoptActiveChat(payload.chatId, userId);
    if (chatId) scheduleReconcile(chatId, {}, userId);
    sendFrontend(await statusPayload(chatId, { includePrivate: Boolean(payload.includePrivate) }), userId);
  } else if (type === "continuity_get_connections") {
    let connections = [];
    let error = "";
    const permissionGranted = spindle.permissions.has("generation");
    if (permissionGranted) {
      try {
        const listed = await spindle.connections.list(userId);
        connections = Array.isArray(listed) ? listed : [];
      } catch (listError) {
        connections = [];
        error = listError instanceof Error ? listError.message : String(listError);
      }
    }
    sendFrontend({
      type: "continuity_connections",
      connections,
      permissionGranted,
      error,
    }, userId);
  } else if (type === "continuity_save_config") {
    const config = await saveConfig(payload.config);
    sendFrontend({ type: "continuity_config_saved", config }, userId);
    const chatId = adoptActiveChat(payload.chatId, userId);
    if (chatId) scheduleReconcile(chatId, {}, userId);
  } else if (
    type === "continuity_set_widget_visibility"
    && typeof payload.showStatusWidget === "boolean"
  ) {
    const config = await saveWidgetVisibility(payload.showStatusWidget);
    sendFrontend({ type: "continuity_config_saved", config }, userId);
    const chatId = adoptActiveChat(payload.chatId, userId);
    if (chatId) publishStatus(chatId, {}, userId);
  } else if (type === "continuity_scan_cleanup") {
    sendFrontend({
      type: "continuity_action_started",
      action: "cleanup_scan",
      message: "Scanning extension-owned tracking files…",
    }, userId);
    try {
      const scan = await scanUnusedStores();
      const count = scan.candidates.length;
      const token = count > 0 ? crypto.randomUUID() : "";
      const key = cleanupUserKey(userId);
      if (token) {
        pendingCleanupByUser.set(key, {
          token,
          expiresAt: Date.now() + CLEANUP_CONFIRMATION_TTL_MS,
        });
      } else {
        pendingCleanupByUser.delete(key);
      }
      sendFrontend({
        type: "continuity_cleanup_scan_result",
        ok: scan.errors === 0,
        token,
        count,
        inert: scan.inert,
        orphan: scan.orphan,
        sizeBytes: scan.sizeBytes,
        skipped: scan.skipped,
        errors: scan.errors,
        message: count > 0
          ? `Found ${count} unused tracking file${count === 1 ? "" : "s"} (${formatStorageSize(scan.sizeBytes)}): ${scan.orphan} orphaned, ${scan.inert} inert.${scan.errors > 0 ? ` ${scan.errors} other file${scan.errors === 1 ? " could" : "s could"} not be verified and will remain untouched.` : ""} Click Delete to confirm.`
          : scan.errors > 0
            ? `No confirmed unused files were found; ${scan.errors} file${scan.errors === 1 ? "" : "s"} could not be verified and were left untouched.`
            : "No unused tracking files were found.",
      }, userId);
    } catch (error) {
      pendingCleanupByUser.delete(cleanupUserKey(userId));
      sendFrontend({
        type: "continuity_cleanup_scan_result",
        ok: false,
        token: "",
        count: 0,
        message: `Cleanup scan failed without deleting anything: ${String(error?.message ?? error)}`,
      }, userId);
    }
  } else if (type === "continuity_cleanup_unused") {
    const key = cleanupUserKey(userId);
    const pending = pendingCleanupByUser.get(key);
    pendingCleanupByUser.delete(key);
    if (
      !pending
      || typeof payload.token !== "string"
      || payload.token !== pending.token
      || Date.now() > pending.expiresAt
    ) {
      sendFrontend({
        type: "continuity_action_result",
        action: "cleanup",
        ok: false,
        message: "Cleanup confirmation expired. Scan again before deleting files.",
      }, userId);
      return;
    }
    sendFrontend({
      type: "continuity_action_started",
      action: "cleanup",
      message: "Rechecking and deleting confirmed unused tracking files…",
    }, userId);
    try {
      const result = await deleteUnusedStores();
      const ok = result.failed === 0;
      const suffix = result.skippedDuringDelete > 0
        ? ` ${result.skippedDuringDelete} changed file${result.skippedDuringDelete === 1 ? " was" : "s were"} left untouched.`
        : "";
      sendFrontend({
        type: "continuity_action_result",
        action: "cleanup",
        ok,
        message: result.deleted > 0
          ? `Deleted ${result.deleted} unused tracking file${result.deleted === 1 ? "" : "s"} (${formatStorageSize(result.deletedBytes)}).${suffix}`
          : result.failed > 0
            ? `No files were deleted; ${result.failed} deletion${result.failed === 1 ? "" : "s"} failed.${suffix}`
            : `No files were deleted after the safety recheck.${suffix}`,
      }, userId);
    } catch (error) {
      sendFrontend({
        type: "continuity_action_result",
        action: "cleanup",
        ok: false,
        message: `Cleanup failed: ${String(error?.message ?? error)}`,
      }, userId);
    }
  } else if (type === "continuity_reprocess") {
    const chatId = adoptActiveChat(payload.chatId, userId);
    if (!chatId) {
      sendFrontend({
        type: "continuity_action_result",
        action: "reprocess",
        ok: false,
        message: "Open a Date Simulator chat before reprocessing.",
      }, userId);
      return;
    }
    sendFrontend({
      type: "continuity_action_started",
      action: "reprocess",
      chatId,
      message: "Reprocessing the latest eligible immersive turn…",
    }, userId);
    await scheduleReconcile(chatId, { forceLatest: true }, userId);
    const status = await statusPayload(chatId, { includePrivate: Boolean(payload.includePrivate) });
    const ok = !status.lastError && !status.migrationRequired;
    sendFrontend({
      type: "continuity_action_result",
      action: "reprocess",
      chatId,
      ok,
      message: ok
        ? status.lastWarning
          ? `Reprocess complete at revision ${status.revision || 0} with conservative recovery: ${status.lastWarning}`
          : `Reprocess complete at revision ${status.revision || 0}.`
        : status.lastError
          ? `Reprocess finished with a tracker error: ${status.lastError}`
          : "Reprocess cannot continue until this chat is migrated.",
      status,
    }, userId);
  } else if (type === "continuity_migrate") {
    const chatId = adoptActiveChat(payload.chatId, userId);
    if (!chatId) {
      sendFrontend({
        type: "continuity_action_result",
        action: "migrate",
        ok: false,
        message: "Open a Date Simulator chat before migrating.",
      }, userId);
      return;
    }
    sendFrontend({
      type: "continuity_action_started",
      action: "migrate",
      chatId,
      message: "Migrating the current chat…",
    }, userId);
    await scheduleReconcile(chatId, { allowMigration: true }, userId);
    const status = await statusPayload(chatId, { includePrivate: Boolean(payload.includePrivate) });
    const ok = !status.lastError && !status.migrationRequired;
    sendFrontend({
      type: "continuity_action_result",
      action: "migrate",
      chatId,
      ok,
      message: ok
        ? `Migration complete at revision ${status.revision || 0}.`
        : status.lastError
          ? `Migration finished with an error: ${status.lastError}`
          : "Migration is still required.",
      status,
    }, userId);
  }
});

tryRegisterInterceptor();
spindle.log.info("Date Simulator Continuity Engine loaded.");

export const backendTest = Object.freeze({
  normalizeConfig,
  publicTrackerSnapshot,
  readiness,
  safeChatToken,
  isInertStore,
  adoptActiveChat,
  userForChat,
  normalizeForkEvent,
  inheritForkCheckpoints,
});
