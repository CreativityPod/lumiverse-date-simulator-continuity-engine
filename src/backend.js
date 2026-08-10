import {
  CHAT_KEYS,
  INACTIVE_CASE,
  compactPromptMessages,
  createStore,
  deriveTranscriptContext,
  isV14Prompt,
  latestValidCheckpoint,
  listEligibleTurns,
  normalizeStore,
  prefixFingerprint,
  selectCheckpoint,
  transcriptForMigration,
} from "./state.js";
import {
  DEFAULT_TRACKER_MAX_TOKENS,
  DEFAULT_TRACKER_TIMEOUT_MS,
  MAX_TRACKER_MAX_TOKENS,
  MAX_TRACKER_TIMEOUT_MS,
  MIN_TRACKER_MAX_TOKENS,
  MIN_TRACKER_TIMEOUT_MS,
  runMigrationTracker,
  runTracker,
} from "./tracker.js";

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  connectionId: "",
  maxTokens: DEFAULT_TRACKER_MAX_TOKENS,
  timeoutMs: DEFAULT_TRACKER_TIMEOUT_MS,
  promptWaitMs: 2_000,
});

const queues = new Map();
const pendingByChat = new Map();
const userByChat = new Map();
const activeChatByUser = new Map();
let interceptorRegistered = false;
let activeChatId = null;
let frontendUserId = undefined;

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
    connectionId: typeof source.connectionId === "string" ? source.connectionId : "",
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
    promptWaitMs: boundedInteger(source.promptWaitMs, 2_000, 0, 5_000),
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

async function setVariableIfChanged(chatId, key, value) {
  const previous = await spindle.variables.chat.get(chatId, key);
  if (previous !== value) await spindle.variables.chat.set(chatId, key, value);
}

async function mirrorStore(chatId, store, context) {
  const current = store.current;
  await Promise.all([
    setVariableIfChanged(chatId, CHAT_KEYS.case, context.active ? context.caseText : INACTIVE_CASE),
    setVariableIfChanged(chatId, CHAT_KEYS.phase, context.active ? "active" : "setup"),
    setVariableIfChanged(chatId, CHAT_KEYS.trackerVersion, context.active ? "1" : ""),
    setVariableIfChanged(chatId, CHAT_KEYS.scene, current ? JSON.stringify(current.scene) : ""),
    setVariableIfChanged(chatId, CHAT_KEYS.arc, current ? JSON.stringify(current.arc) : ""),
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
    text: "Continuity Engine ready. Open a Date Simulator v1.4 chat to begin tracking.",
  };
}

function sendFrontend(payload, userId = frontendUserId) {
  try {
    spindle.sendToFrontend(payload, userId);
  } catch {
    // Frontend may not be connected yet.
  }
}

async function statusPayload(chatId, options = {}) {
  const config = await loadConfig();
  const base = readiness(config);
  if (!chatId) return { type: "continuity_status", ...base, config, chatId: null };
  const store = await loadStore(chatId);
  let caseMessageId = null;
  let profileSaved = false;
  if (spindle.permissions.has("chat_mutation")) {
    try {
      const messages = await spindle.chat.getMessages(chatId);
      const transcript = deriveTranscriptContext(messages);
      caseMessageId = transcript.caseMessageId;
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
    revision: store.revision || 0,
    updatedAt: store.lastUpdatedAt || "",
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
    payload.text = "Continuity Engine ready. No Date Simulator v1.4 private profile was found in this chat yet.";
  }
  if (options.includePrivate) payload.state = store.current;
  return payload;
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

async function performMigration(chatId, messages, context, store, config, userId) {
  const turns = listEligibleTurns(messages, context);
  const latest = turns.at(-1);
  if (!latest) throw new Error("No immersive assistant turn is available to migrate.");
  const state = await runMigrationTracker(
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
  store.checkpoints[latest.key] = {
    fingerprint: latest.fingerprint,
    state,
    createdAt: new Date().toISOString(),
    migrated: true,
  };
  store.current = state;
  store.migrationAccepted = true;
  store.migrationRequired = false;
  store.migrationBaselineKey = latest.key;
  store.migrationBaselineFingerprint = latest.fingerprint;
  store.revision += 1;
  return store;
}

async function reconcileChat(chatId, options = {}, userId) {
  if (!chatId || !spindle.permissions.has("chat_mutation")) return;
  const scopedUserId = userForChat(chatId, userId);
  const config = await loadConfig();
  const messages = await spindle.chat.getMessages(chatId);
  const context = deriveTranscriptContext(messages);
  let store = resetForEpoch(await loadStore(chatId), context);

  if (!context.active) {
    store.caseText = "";
    store.current = null;
    store.processing = false;
    store.migrationRequired = false;
    store.lastError = "";
    await saveStore(chatId, store);
    await mirrorStore(chatId, store, context);
    await publishStatus(chatId, {}, scopedUserId);
    return;
  }

  store.caseText = context.caseText;
  const nativeV14 = /\b(?:Date Simulator\s+)?v1\.4(?:\.\d+)?\b/i.test(context.caseText);
  if (!nativeV14 && !store.migrationAccepted && !options.allowMigration) {
    store.migrationRequired = true;
    store.processing = false;
    await saveStore(chatId, store);
    await mirrorStore(chatId, store, context);
    await publishStatus(chatId, {}, scopedUserId);
    return;
  }

  if (!nativeV14 && store.migrationAccepted && store.migrationBaselineKey) {
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
    if (options.allowMigration && !nativeV14 && !store.migrationAccepted) {
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
        const existing = options.forceLatest && index === turns.length - 1
          ? null
          : selectCheckpoint(store, turn);
        if (existing) {
          previousState = existing.state;
          continue;
        }
        const state = await runTracker(
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
        store.checkpoints[turn.key] = {
          fingerprint: turn.fingerprint,
          state,
          createdAt: new Date().toISOString(),
        };
        previousState = state;
        store.revision += 1;
      }

      const liveKeys = new Set(turns.map((turn) => turn.key));
      store.checkpoints = Object.fromEntries(
        Object.entries(store.checkpoints).filter(([key]) => liveKeys.has(key)),
      );
      store.current = previousState;
    }
    store.lastError = "";
    store.lastUpdatedAt = new Date().toISOString();
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

function scheduleReconcile(chatId, options = {}, userId) {
  if (!chatId) return Promise.resolve();
  const scopedUserId = userForChat(chatId, userId);
  const previous = queues.get(chatId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => reconcileChat(chatId, options, scopedUserId))
    .catch((error) => spindle.log.error(`Continuity queue failed: ${String(error)}`))
    .finally(() => {
      if (queues.get(chatId) === current) queues.delete(chatId);
      if (pendingByChat.get(chatId) === current) pendingByChat.delete(chatId);
    });
  queues.set(chatId, current);
  pendingByChat.set(chatId, current);
  return current;
}

async function awaitPending(chatId, milliseconds) {
  const pending = pendingByChat.get(chatId);
  if (!pending || milliseconds <= 0) return;
  await Promise.race([
    pending.catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ]);
}

async function interceptPrompt(messages, context) {
  if (!isV14Prompt(messages)) return messages;
  const config = await loadConfig();
  if (!config.enabled) return messages;
  const chatId = context?.chatId;
  if (chatId) await awaitPending(chatId, config.promptWaitMs);

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
  // empty tracker block. Begin compaction only after a live profile is saved.
  if (!caseText) return messages;

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
    return scheduleReconcile(chatId, {}, userId);
  });
}

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
  if (type === "continuity_get_status") {
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
        ? `Reprocess complete at revision ${status.revision || 0}.`
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
  readiness,
  safeChatToken,
  adoptActiveChat,
  userForChat,
});
