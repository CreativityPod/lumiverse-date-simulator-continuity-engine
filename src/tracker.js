import {
  TRACKER_JSON_SCHEMA,
  TRACKER_SCHEMA_VERSION,
  cloneEmptyState,
  recoverTrackerStateDetailed,
  trackerSourceMessageIds,
} from "./schemas.js";

export const DEFAULT_TRACKER_TIMEOUT_MS = 30_000;
export const MIN_TRACKER_TIMEOUT_MS = 5_000;
export const MAX_TRACKER_TIMEOUT_MS = 120_000;
export const DEFAULT_TRACKER_MAX_TOKENS = 2_000;
export const MIN_TRACKER_MAX_TOKENS = 400;
export const MAX_TRACKER_MAX_TOKENS = 2_000;
export const DEFAULT_TRACKER_OUTPUT_MODE = "auto";
export const TRACKER_OUTPUT_MODES = Object.freeze(["auto", "openai", "anthropic", "plain"]);

function normalizeTrackerTimeoutMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TRACKER_TIMEOUT_MS;
  return Math.max(MIN_TRACKER_TIMEOUT_MS, Math.min(MAX_TRACKER_TIMEOUT_MS, Math.round(parsed)));
}

const TRACKER_SYSTEM_PROMPT = `You are the private continuity recorder for Date Simulator. Update a compact current-state ledger from canonical prior state and one newly completed public roleplay turn.

Hard rules:
- Record consequences of the supplied turn; never create new dialogue, actions, events, NPC activity, promises, consent, or public story developments.
- Preserve an established value unless the new turn directly changes or corrects it. Use "Unknown" instead of guessing.
- scene.date and scene.time are the fictional narrative clock, never wall-clock time. Ignore message timestamps, response delay, generation latency, and how long the user waited in real life. Advance narrative time by the duration explicitly stated or conservatively implied by completed public dialogue and action, including a small plausible advance for exchanges that clearly consume time. Narratively implied passage counts as a supported direct change to date/time even when nobody states a clock value. Preserve approximate wording when exact precision is unavailable, do not advance for a purely observational or analytical command, and update the date when narrated time crosses midnight.
- scene.lifecycle records only whether the current scene is active or ended. arc.lifecycle separately records whether the larger relationship arc is active or ended. A scene may end while its arc remains active because a future meeting or continuing connection is established. Preserve each lifecycle reason and sourceMessageId unless that lifecycle changes; on change, use only the supplied assistant message id. Starting a later scene replaces the prior current scene and sets scene.lifecycle to active without creating scene history.
- The user controls the man. Never invent his thoughts, feelings, motives, attraction, consent, body, outfit, position, or voluntary action. You may record only facts the user explicitly established or direct physical consequences already narrated.
- womanStable contains stable observable appearance copied conservatively from the stable case and public opening: face structure and enduring facial features; visible eye color, shape, and other enduring eye traits; visible skin tone, complexion, and enduring marks; and nonsexualized body type, frame, and proportions. Preserve these fields unless the transcript explicitly corrects them or establishes a plausible lasting change. Never infer a trait from ethnicity, ancestry, nationality, culture, personality, clothing, or attraction; use "Unknown" for anything the case and public scene do not establish.
- womanCurrent contains only temporary hair/grooming, dress/layer state, physical condition, and current mental state or immediate intent. Expressions, makeup, temporary skin changes, posture, weight change, and other current or changing presentation belong here or in spatial when supported; do not overwrite womanStable with them.
- manVisible separates currently relevant visible appearance, clothing/layer state, and temporary physical condition explicitly established by the user or directly caused by canonical events. Preserve established facts until changed, use "Unknown" for anything unset, and never infer a body detail, outfit, condition, position, or voluntary action.
- spatial separately preserves the woman's position, the man's explicitly established position, proximity/contact, and important held or carried items. Never invent the man's movement or position. Nothing moves, appears, disappears, opens, closes, transfers, or changes contact without a canonical cause.
- Mental state is temporary mood or immediate intent. ARC RESPONSE separately preserves the woman's qualitative private response to this man: attention, comfort/safety, rapport/trust, physical attraction, personal interest, romantic interest, adult sexual interest, willingness to continue, contact-exchange interest, desire to leave, and active uncertainty.
- Update private response only when the stable profile plus canonical observable interaction directly supports a conservative change. Change only affected dimensions, normally by one qualitative step; use mixed or uncertain language when evidence conflicts. This records private continuity and does not create a public event.
- Consent is action-specific and is never a response field or an inference from attraction, comfort, prior willingness, clothing, physiology, or silence. Teen Mode sexualInterest must be "Not applicable in Teen Mode."
- Never use numbers, points, percentages, scores, or game meters in private response fields. Never convert private response into visible behavior unless the public turn independently established that behavior.
- NPCS includes named or plausibly recurring NPCs only. Preserve active recurring NPCs. Do not add incidental staff or passersby. When an NPC is added or materially updated, use the supplied assistant message id; otherwise preserve sourceMessageId.
- OBJECTIVES contains at most three immediate plans, commitments, pressures, or intended next steps. timing records an established deadline, planned date, or practical window, otherwise "Unknown". Never infer an objective for the man unless he stated it. When an objective is added or materially updated, use the supplied assistant message id; otherwise preserve sourceMessageId.
- If no relationship change occurred, preserve relationship.latestChange and its sourceMessageId exactly. If one occurred, write one concise change and use the supplied assistant message id.
- If no private-response dimension changed, preserve response.latestChange and its sourceMessageId exactly. If supported response changed, summarize only the changed dimensions and use the supplied assistant message id.
- Return only the JSON object required by the schema. No markdown or commentary.

Required JSON shape (every shown property is required; npcs and objectives may be empty arrays):
{"schemaVersion":4,"scene":{"date":"string","time":"string","weather":"string","location":"string","immediateContext":"string","lifecycle":{"status":"active or ended","reason":"string or empty","sourceMessageId":"matching id or empty"},"womanStable":{"face":"string","eyes":"string","skin":"string","bodyTypeAndProportions":"string"},"womanCurrent":{"hairAndGrooming":"string","dress":"string","physicalState":"string","mentalState":"string"},"manVisible":{"appearance":"string","dressAndLayers":"string","physicalState":"string"},"spatial":{"womanPosition":"string","manPosition":"string","proximityAndContact":"string","importantItems":"string"}},"arc":{"lifecycle":{"status":"active or ended","reason":"string or empty","sourceMessageId":"matching id or empty"},"npcs":[{"name":"string","role":"string","relationship":"string","currentStatus":"string","immediateObjective":"string","sourceMessageId":"matching id or empty"}],"relationship":{"establishedStatus":"string","womanPosture":"string","activeBoundaryOrConcern":"string","latestChange":"string or empty","sourceMessageId":"matching id or empty"},"response":{"availableAttention":"string","comfortAndSafety":"string","rapportAndTrust":"string","physicalAttraction":"string","personalInterest":"string","romanticInterest":"string","sexualInterest":"string","willingnessToContinue":"string","contactExchangeInterest":"string","desireToLeave":"string","activeUncertainty":"string","latestChange":"string or empty","sourceMessageId":"matching id or empty"},"objectives":[{"owner":"string","objective":"string","status":"string","timing":"string","sourceMessageId":"matching id or empty"}]}}`;

function trackerUserPrompt({ caseText, previousState, userText, assistantText, sourceMessageId }) {
  return `ASSISTANT MESSAGE ID
${sourceMessageId}

STABLE PRIVATE CASE
${caseText}

PREVIOUS TRACKER STATE
${JSON.stringify(previousState ?? cloneEmptyState())}

NEW USER TURN
${userText || "[No preceding user turn; this is the generated opening.]"}

NEW PUBLIC ASSISTANT TURN
${assistantText}

Produce schemaVersion ${TRACKER_SCHEMA_VERSION} state now.`;
}

function migrationUserPrompt({ caseText, legacySceneText, transcript, sourceMessageId }) {
  return `This is an explicit migration from Date Simulator v1.3.1. Build one conservative current tracker state from the saved case, latest legacy scene, and selected recent transcript. Do not add facts that are absent or resolve ambiguous relationship or private-response state.

ASSISTANT MESSAGE ID
${sourceMessageId}

STABLE PRIVATE CASE
${caseText}

LATEST LEGACY SCENE
${legacySceneText || "Unavailable"}

RECENT SELECTED TRANSCRIPT
${transcript || "Unavailable"}

Produce schemaVersion ${TRACKER_SCHEMA_VERSION} state now.`;
}

function extractJson(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next bounded representation.
    }
  }
  return null;
}

function resolveOutputMode(connection, requestedMode = DEFAULT_TRACKER_OUTPUT_MODE) {
  if (TRACKER_OUTPUT_MODES.includes(requestedMode) && requestedMode !== "auto") return requestedMode;
  const provider = [
    connection?.provider,
    connection?.type,
    connection?.kind,
    connection?.protocol,
    connection?.apiType,
    connection?.format,
  ].map((value) => String(value ?? "")).join(" ").toLowerCase();
  if (provider.includes("google") || provider.includes("gemini")) return "google";
  if (provider.includes("anthropic") || provider.includes("claude")) return "anthropic";
  if (
    provider.includes("openai") ||
    provider.includes("openrouter") ||
    provider.includes("nanogpt") ||
    provider.includes("deepseek")
  ) return "openai";
  return "plain";
}

function generationParameters(connection, outputMode = DEFAULT_TRACKER_OUTPUT_MODE) {
  const base = { temperature: 0, top_p: 0.1, max_tokens: DEFAULT_TRACKER_MAX_TOKENS };
  const mode = resolveOutputMode(connection, outputMode);
  if (mode === "google") {
    return { ...base, responseMimeType: "application/json", responseSchema: TRACKER_JSON_SCHEMA };
  }
  if (mode === "openai") {
    return {
      ...base,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "date_simulator_continuity_state",
          strict: true,
          schema: TRACKER_JSON_SCHEMA,
        },
      },
    };
  }
  if (mode === "anthropic") {
    return {
      ...base,
      tool_choice: { type: "tool", name: "record_date_simulator_state" },
    };
  }
  return base;
}

function generationTools(connection, outputMode = DEFAULT_TRACKER_OUTPUT_MODE) {
  if (resolveOutputMode(connection, outputMode) !== "anthropic") return undefined;
  return [
    {
      name: "record_date_simulator_state",
      description: "Return the complete validated Date Simulator continuity state.",
      parameters: TRACKER_JSON_SCHEMA,
    },
  ];
}

async function resolveConnection(spindleApi, connectionId, userId) {
  if (!connectionId) {
    try {
      const connections = await spindleApi.connections.list(userId);
      return connections.find((connection) => connection?.is_default) ?? null;
    } catch {
      return null;
    }
  }
  try {
    return await spindleApi.connections.get(connectionId, userId);
  } catch {
    return null;
  }
}

async function generateCandidate(spindleApi, messages, config, sourceMessageId, previousState, caseText, userId) {
  const connection = await resolveConnection(spindleApi, config.connectionId, userId);
  const allowedSourceMessageIds = [
    sourceMessageId,
    ...trackerSourceMessageIds(previousState),
  ].filter(Boolean);
  const makeRequest = (attemptMessages) => {
    const input = {
      type: "quiet",
      messages: attemptMessages,
      parameters: {
        ...generationParameters(connection, config.outputMode),
        max_tokens: Math.max(
          MIN_TRACKER_MAX_TOKENS,
          Math.min(
            MAX_TRACKER_MAX_TOKENS,
            Number(config.maxTokens) || DEFAULT_TRACKER_MAX_TOKENS,
          ),
        ),
      },
      reasoning: { source: "off" },
      signal: AbortSignal.timeout(normalizeTrackerTimeoutMs(config.timeoutMs)),
    };
    const tools = generationTools(connection, config.outputMode);
    if (tools) input.tools = tools;
    // Lumiverse scopes direct generation through GenerationRequestDTO.userId.
    // Connection profile methods instead accept userId as a positional argument.
    if (userId) input.userId = userId;
    if (config.connectionId) input.connection_id = config.connectionId;
    return input;
  };
  const validateResponse = (response) => {
    const toolState = response?.tool_calls?.find(
      (call) => call?.name === "record_date_simulator_state",
    )?.args;
    const parsed = toolState && typeof toolState === "object"
      ? toolState
      : extractJson(toolState ?? response?.content);
    return {
      parsed,
      validation: recoverTrackerStateDetailed(parsed, {
        previousState,
        allowedSourceMessageIds,
        teenMode: /\bTeen Mode\b/i.test(String(caseText ?? "")),
      }),
    };
  };

  let response = await spindleApi.generate.quiet(makeRequest(messages));
  let { parsed, validation } = validateResponse(response);
  if (!validation.state) {
    const rejectedText = parsed && typeof parsed === "object"
      ? JSON.stringify(parsed)
      : String(response?.content ?? "").trim();
    const repairPrompt = {
      role: "user",
      content: `Repair the rejected tracker object because: ${validation.error}.

Return one complete replacement object. It must conform to this JSON Schema:
${JSON.stringify(TRACKER_JSON_SCHEMA)}

Preserve canonical facts, use Unknown rather than guessing, and return no prose or markdown.`,
    };
    const rejectedAssistant = {
      role: "assistant",
      content: rejectedText || "[The prior response contained no usable JSON object.]",
    };
    response = await spindleApi.generate.quiet(makeRequest([...messages, rejectedAssistant, repairPrompt]));
    ({ validation } = validateResponse(response));
  }
  if (!validation.state) {
    const finishReason = String(response?.finish_reason ?? "unknown").replace(/[^a-zA-Z0-9_.-]/g, "_");
    const contentLength = String(response?.content ?? "").length;
    const toolCallCount = Array.isArray(response?.tool_calls) ? response.tool_calls.length : 0;
    throw new Error(
      `Tracker state rejected after repair: ${validation.error}; finish=${finishReason}; contentChars=${contentLength}; toolCalls=${toolCallCount}.`,
    );
  }
  return { state: validation.state, warnings: validation.warnings ?? [] };
}

export async function runTracker(spindleApi, input, config, userId) {
  return generateCandidate(
    spindleApi,
    [
      { role: "system", content: TRACKER_SYSTEM_PROMPT },
      { role: "user", content: trackerUserPrompt(input) },
    ],
    config,
    input.sourceMessageId,
    input.previousState,
    input.caseText,
    userId,
  );
}

export async function runMigrationTracker(spindleApi, input, config, userId) {
  return generateCandidate(
    spindleApi,
    [
      { role: "system", content: TRACKER_SYSTEM_PROMPT },
      { role: "user", content: migrationUserPrompt(input) },
    ],
    config,
    input.sourceMessageId,
    null,
    input.caseText,
    userId,
  );
}

export const trackerTest = Object.freeze({
  systemPrompt: TRACKER_SYSTEM_PROMPT,
  extractJson,
  generationParameters,
  generationTools,
  resolveOutputMode,
  trackerUserPrompt,
  migrationUserPrompt,
  normalizeTrackerTimeoutMs,
});
