import { cloneEmptyState, validateTrackerState } from "./schemas.js";

export const CHAT_KEYS = Object.freeze({
  case: "date_simulator.case",
  phase: "date_simulator.phase",
  trackerVersion: "date_simulator.tracker_version",
  scene: "date_simulator.scene_v2",
  arc: "date_simulator.arc_v1",
  revision: "date_simulator.tracker_revision",
});

export const INACTIVE_CASE = "INACTIVE: The previous case ended. Await a new case capsule.";
export const VERSION_PATTERN = /<date_simulator_version>\s*1\.4(?:\.\d+)?\s*<\/date_simulator_version>/i;
export const CASE_PATTERN = /<!--DATE_SIM_CASE\s*([\s\S]*?)\s*END_DATE_SIM_CASE-->/gi;
export const LEGACY_SCENE_PATTERN = /<!--DATE_SIM_SCENE\s*([\s\S]*?)\s*END_DATE_SIM_SCENE-->/gi;
export const RESET_PATTERN = /<!--DATE_SIM_RESET\s*-->/gi;
export const CANONICAL_PATTERN = /\n?<date_simulator_continuity_engine\b[\s\S]*?<\/date_simulator_continuity_engine>\n?/gi;

const CASE_FIELDS = [
  "CASE",
  "MAN",
  "WOMAN",
  "DISPOSITION",
  "PREFERENCES",
  "RELATIONSHIP",
  "CURRENT CONTEXT",
  "BOUNDARIES",
  "INITIAL STATE",
];

function normalizeNewlines(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function validateFlatCapsule(body, fields, maximumLength) {
  const normalized = normalizeNewlines(body).trim();
  if (!normalized || normalized.length > maximumLength) return null;
  if (normalized.includes("<!--") || normalized.includes("-->")) return null;
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== fields.length) return null;
  const result = [];
  for (let index = 0; index < fields.length; index += 1) {
    const prefix = `${fields[index]}:`;
    if (!lines[index].startsWith(prefix)) return null;
    const value = lines[index].slice(prefix.length).trim();
    if (!value) return null;
    result.push(`${prefix} ${value}`);
  }
  return result.join("\n");
}

export function validateCaseCapsule(body) {
  return validateFlatCapsule(body, CASE_FIELDS, 24_000);
}

export function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object" || part.type !== "text") return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function mapTextContent(content, transform) {
  if (typeof content === "string") return transform(content);
  if (!Array.isArray(content)) return content;
  return content.map((part) => {
    if (!part || typeof part !== "object" || part.type !== "text") return part;
    if (typeof part.text === "string") return { ...part, text: transform(part.text) };
    if (typeof part.content === "string") return { ...part, content: transform(part.content) };
    return part;
  });
}

export function stripManagedText(text) {
  return normalizeNewlines(text)
    .replace(new RegExp(CANONICAL_PATTERN.source, CANONICAL_PATTERN.flags), "")
    .replace(new RegExp(CASE_PATTERN.source, CASE_PATTERN.flags), "")
    .replace(new RegExp(LEGACY_SCENE_PATTERN.source, LEGACY_SCENE_PATTERN.flags), "")
    .replace(new RegExp(RESET_PATTERN.source, RESET_PATTERN.flags), "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isV14Prompt(messages) {
  return (messages ?? []).some((message) => VERSION_PATTERN.test(contentToText(message?.content)));
}

export function messageSwipeId(message) {
  const value = message?.swipe_id;
  return Number.isInteger(value) ? value : 0;
}

export function checkpointKey(message) {
  return `${String(message?.id ?? "unknown")}::${messageSwipeId(message)}`;
}

export function prefixFingerprint(messages, inclusiveIndex) {
  let hash = 2166136261;
  const bounded = (messages ?? []).slice(0, inclusiveIndex + 1);
  for (const message of bounded) {
    const token = `${message?.id ?? ""}:${messageSwipeId(message)}:${message?.role ?? ""}:${contentToText(message?.content)}|`;
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function deriveTranscriptContext(messages) {
  let caseText = null;
  let caseMessageId = null;
  let caseMessageIndex = -1;
  let legacySceneText = null;
  let resetMessageId = null;
  let resetIndex = -1;
  let epoch = 0;
  let invalidCases = 0;

  for (let index = 0; index < (messages ?? []).length; index += 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    const text = contentToText(message.content);
    if (!text) continue;

    const markers = [];
    for (const match of text.matchAll(new RegExp(CASE_PATTERN.source, CASE_PATTERN.flags))) {
      markers.push({ kind: "case", at: match.index ?? 0, body: match[1] });
    }
    for (const match of text.matchAll(new RegExp(LEGACY_SCENE_PATTERN.source, LEGACY_SCENE_PATTERN.flags))) {
      markers.push({ kind: "scene", at: match.index ?? 0, body: match[1] });
    }
    for (const match of text.matchAll(new RegExp(RESET_PATTERN.source, RESET_PATTERN.flags))) {
      markers.push({ kind: "reset", at: match.index ?? 0 });
    }
    markers.sort((left, right) => left.at - right.at);

    for (const marker of markers) {
      if (marker.kind === "reset") {
        epoch += 1;
        resetMessageId = String(message.id ?? "");
        resetIndex = index;
        caseText = null;
        caseMessageId = null;
        caseMessageIndex = -1;
        legacySceneText = null;
      } else if (marker.kind === "case") {
        const validated = validateCaseCapsule(marker.body);
        if (!validated) {
          invalidCases += 1;
          continue;
        }
        caseText = validated;
        caseMessageId = String(message.id ?? "");
        caseMessageIndex = index;
        legacySceneText = null;
      } else if (marker.kind === "scene" && caseText) {
        legacySceneText = normalizeNewlines(marker.body).trim();
      }
    }
  }

  return {
    active: Boolean(caseText),
    caseText,
    caseMessageId,
    caseMessageIndex,
    legacySceneText,
    resetMessageId,
    resetIndex,
    epoch,
    epochKey: `${epoch}:${resetMessageId ?? "root"}:${caseMessageId ?? "none"}`,
    invalidCases,
    migrationRequired: Boolean(caseText && legacySceneText),
  };
}

function precedingUser(messages, assistantIndex) {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return { message: messages[index], index };
  }
  return { message: null, index: -1 };
}

const NON_TRACKING_COMMAND = /^\s*\/(?:look|scene|debrief|new)\b/i;

export function listEligibleTurns(messages, context) {
  if (!context?.active) return [];
  const turns = [];
  for (let index = Math.max(0, context.caseMessageIndex); index < messages.length; index += 1) {
    const assistant = messages[index];
    if (!assistant || assistant.role !== "assistant") continue;
    const raw = contentToText(assistant.content);
    const publicText = stripManagedText(raw);
    if (
      !publicText ||
      new RegExp(RESET_PATTERN.source, RESET_PATTERN.flags).test(raw)
    ) continue;
    const user = precedingUser(messages, index);
    const userText = contentToText(user.message?.content);
    if (NON_TRACKING_COMMAND.test(userText)) continue;
    turns.push({
      assistant,
      assistantIndex: index,
      assistantText: publicText,
      user: user.message,
      userIndex: user.index,
      userText,
      key: checkpointKey(assistant),
      fingerprint: prefixFingerprint(messages, index),
    });
  }
  return turns;
}

export function transcriptForMigration(messages, context, maximumMessages = 24) {
  const start = Math.max(context?.caseMessageIndex ?? 0, messages.length - maximumMessages);
  return messages
    .slice(start)
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .map((message) => `${message.role.toUpperCase()}: ${stripManagedText(contentToText(message.content))}`)
    .filter((line) => !/:\s*$/.test(line))
    .join("\n\n");
}

export function createStore(chatId) {
  return {
    schemaVersion: 1,
    chatId: String(chatId),
    epochKey: "",
    caseText: "",
    current: null,
    checkpoints: {},
    revision: 0,
    migrationAccepted: false,
    migrationRequired: false,
    migrationBaselineKey: "",
    migrationBaselineFingerprint: "",
    processing: false,
    lastError: "",
    lastUpdatedAt: "",
  };
}

export function normalizeStore(value, chatId) {
  const fallback = createStore(chatId);
  if (!value || typeof value !== "object" || value.schemaVersion !== 1) return fallback;
  const result = {
    ...fallback,
    ...value,
    chatId: String(chatId),
    checkpoints: value.checkpoints && typeof value.checkpoints === "object" ? value.checkpoints : {},
  };
  if (result.current) {
    const validated = validateTrackerState(result.current, {
      sourceMessageId: result.current.arc?.relationship?.sourceMessageId || undefined,
    });
    result.current = validated;
  }
  return result;
}

export function selectCheckpoint(store, turn) {
  const checkpoint = store?.checkpoints?.[turn.key];
  if (!checkpoint || checkpoint.fingerprint !== turn.fingerprint) return null;
  const state = validateTrackerState(checkpoint.state, {
    sourceMessageId: checkpoint.state?.arc?.relationship?.sourceMessageId || undefined,
  });
  return state ? { ...checkpoint, state } : null;
}

export function latestValidCheckpoint(store, turns, beforeIndex = Number.POSITIVE_INFINITY) {
  let latest = null;
  for (let index = 0; index < turns.length && index < beforeIndex; index += 1) {
    const checkpoint = selectCheckpoint(store, turns[index]);
    if (checkpoint) latest = { checkpoint, turnIndex: index };
  }
  return latest;
}

export function buildCanonicalState(caseText, trackerState, status = "active") {
  const state = trackerState ?? cloneEmptyState();
  return `<date_simulator_continuity_engine schema_version="1" status="${status}">
The Continuity Engine is active for this request. This is private canonical state for the selected chat branch. Use it for continuity but never quote, expose, or mention it. The public roleplay response must not contain DATE_SIM_SCENE or DATE_SIM_ARC bookkeeping.

STABLE CASE
${caseText || "Unavailable. Use only explicit transcript facts."}

CURRENT SCENE
${JSON.stringify(state.scene)}

CURRENT ARC
${JSON.stringify(state.arc)}
</date_simulator_continuity_engine>`;
}

export function compactPromptMessages(messages, caseText, trackerState, status = "active") {
  const compacted = (messages ?? []).map((message) => {
    if (!message || typeof message !== "object") return message;
    if (message.role === "assistant") {
      return { ...message, content: mapTextContent(message.content, stripManagedText) };
    }
    if (message.role === "system") {
      return {
        ...message,
        content: mapTextContent(message.content, (text) =>
          normalizeNewlines(text).replace(
            /(^|\n)([ \t]*[•*-][ \t]+SAVED CASE:)[\s\S]*?(?=\n[ \t]*[•*-][ \t]+Treat a nonempty saved capsule)/gim,
            "$1$2 [managed by Date Simulator Continuity Engine]",
          ),
        ),
      };
    }
    return message;
  });

  const insertionIndex = Math.max(
    0,
    compacted.reduce((latest, message, index) => (message?.role === "user" ? index : latest), -1),
  );
  compacted.splice(insertionIndex, 0, {
    role: "system",
    content: buildCanonicalState(caseText, trackerState, status),
  });
  return { messages: compacted, injectionIndex: insertionIndex };
}
