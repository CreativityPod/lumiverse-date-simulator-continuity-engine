import {
  TRACKER_JSON_SCHEMA,
  TRACKER_SCHEMA_VERSION,
  cloneEmptyState,
  validateTrackerState,
} from "./schemas.js";

const TRACKER_SYSTEM_PROMPT = `You are the private continuity recorder for Date Simulator. Update a compact current-state ledger from canonical prior state and one newly completed public roleplay turn.

Hard rules:
- Record consequences of the supplied turn; never create new dialogue, actions, events, NPC activity, promises, attraction, consent, or story developments.
- Preserve an established value unless the new turn directly changes or corrects it. Use "Unknown" instead of guessing.
- The user controls the man. Never invent his thoughts, feelings, motives, attraction, consent, body, outfit, position, or voluntary action. You may record only facts the user explicitly established or direct physical consequences already narrated.
- womanCurrent contains only temporary hair/grooming, dress/layer state, physical condition, and current mental state or immediate intent. Permanent traits belong to the stable case and must not be copied there.
- manVisible contains only currently relevant visible facts explicitly established by the user or directly caused by canonical events: visible appearance, clothing/layer state, and temporary physical condition. Preserve established facts until changed, use "Unknown" for anything unset, and never infer a body detail, outfit, condition, position, or voluntary action. Positions, contact, and held or carried items belong in spatial.
- Mental state is qualitative and conservative. Attraction, comfort, trust, availability, willingness, and consent are separate. Do not convert private state into visible behavior.
- NPCS includes named or plausibly recurring NPCs only. Preserve active recurring NPCs. Do not add incidental staff or passersby.
- OBJECTIVES contains at most three immediate plans, commitments, pressures, or intended next steps. Never infer an objective for the man unless he stated it.
- If no relationship change occurred, preserve the prior latestChange and sourceMessageId exactly. If a material relationship change occurred, write one concise change and set sourceMessageId to the supplied assistant message id.
- Return only the JSON object required by the schema. No markdown or commentary.`;

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
  return `This is an explicit migration from Date Simulator v1.3.1. Build one conservative v1.4 tracker state from the saved case, latest legacy scene, and selected recent transcript. Do not add facts that are absent or resolve ambiguous relationship state.

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

function generationParameters(connection) {
  const base = { temperature: 0, top_p: 0.1, max_tokens: 1_200 };
  const provider = String(connection?.provider ?? "").toLowerCase();
  if (provider.includes("google") || provider.includes("gemini")) {
    return { ...base, responseMimeType: "application/json", responseSchema: TRACKER_JSON_SCHEMA };
  }
  if (
    provider.includes("openai") ||
    provider.includes("openrouter") ||
    provider.includes("nanogpt") ||
    provider.includes("deepseek")
  ) {
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
  if (provider.includes("anthropic") || provider.includes("claude")) {
    return {
      ...base,
      tools: [
        {
          name: "record_date_simulator_state",
          description: "Return the complete validated Date Simulator continuity state.",
          input_schema: TRACKER_JSON_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "record_date_simulator_state" },
    };
  }
  return base;
}

async function resolveConnection(spindleApi, connectionId) {
  if (!connectionId) {
    try {
      const connections = await spindleApi.connections.list();
      return connections.find((connection) => connection?.is_default) ?? null;
    } catch {
      return null;
    }
  }
  try {
    return await spindleApi.connections.get(connectionId);
  } catch {
    return null;
  }
}

async function generateCandidate(spindleApi, messages, config, sourceMessageId, previousState) {
  const connection = await resolveConnection(spindleApi, config.connectionId);
  const input = {
    messages,
    parameters: {
      ...generationParameters(connection),
      max_tokens: Math.max(400, Math.min(2_000, Number(config.maxTokens) || 1_200)),
    },
    reasoning: { source: "off" },
    signal: AbortSignal.timeout(Math.max(5_000, Math.min(120_000, Number(config.timeoutMs) || 45_000))),
  };
  if (config.connectionId) input.connection_id = config.connectionId;

  const response = await spindleApi.generate.quiet(input);
  const toolState = response?.tool_calls?.find(
    (call) => call?.name === "record_date_simulator_state",
  )?.args;
  const parsed = toolState && typeof toolState === "object"
    ? toolState
    : extractJson(response?.content);
  const allowedSourceMessageIds = [
    sourceMessageId,
    previousState?.arc?.relationship?.sourceMessageId,
  ].filter(Boolean);
  const validated = validateTrackerState(parsed, { allowedSourceMessageIds });
  if (!validated) throw new Error("Tracker returned malformed or unsupported state.");
  return validated;
}

export async function runTracker(spindleApi, input, config) {
  return generateCandidate(
    spindleApi,
    [
      { role: "system", content: TRACKER_SYSTEM_PROMPT },
      { role: "user", content: trackerUserPrompt(input) },
    ],
    config,
    input.sourceMessageId,
    input.previousState,
  );
}

export async function runMigrationTracker(spindleApi, input, config) {
  return generateCandidate(
    spindleApi,
    [
      { role: "system", content: TRACKER_SYSTEM_PROMPT },
      { role: "user", content: migrationUserPrompt(input) },
    ],
    config,
    input.sourceMessageId,
    null,
  );
}

export const trackerTest = Object.freeze({
  extractJson,
  generationParameters,
  trackerUserPrompt,
  migrationUserPrompt,
});
