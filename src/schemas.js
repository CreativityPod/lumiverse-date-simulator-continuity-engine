export const TRACKER_SCHEMA_VERSION = 1;

export const EMPTY_SCENE = Object.freeze({
  date: "Unknown",
  time: "Unknown",
  weather: "Unknown",
  location: "Unknown",
  immediateContext: "Unknown",
  womanCurrent: Object.freeze({
    hairAndGrooming: "Unknown",
    dress: "Unknown",
    physicalState: "Unknown",
    mentalState: "Unknown",
  }),
  manVisible: "Unknown",
  spatial: "Unknown",
});

export const EMPTY_ARC = Object.freeze({
  npcs: Object.freeze([]),
  relationship: Object.freeze({
    establishedStatus: "No relationship status established.",
    womanPosture: "Unknown",
    activeBoundaryOrConcern: "None established.",
    latestChange: "",
    sourceMessageId: "",
  }),
  objectives: Object.freeze([]),
});

const ROOT_KEYS = ["schemaVersion", "scene", "arc"];
const SCENE_KEYS = [
  "date",
  "time",
  "weather",
  "location",
  "immediateContext",
  "womanCurrent",
  "manVisible",
  "spatial",
];
const WOMAN_KEYS = ["hairAndGrooming", "dress", "physicalState", "mentalState"];
const ARC_KEYS = ["npcs", "relationship", "objectives"];
const NPC_KEYS = ["name", "role", "relationship", "currentStatus", "immediateObjective"];
const RELATIONSHIP_KEYS = [
  "establishedStatus",
  "womanPosture",
  "activeBoundaryOrConcern",
  "latestChange",
  "sourceMessageId",
];
const OBJECTIVE_KEYS = ["owner", "objective", "status"];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function cleanText(value, maximumLength, { allowEmpty = false } = {}) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").trim();
  if ((!allowEmpty && !cleaned) || cleaned.length > maximumLength) return null;
  if (
    cleaned.includes("<!--") ||
    cleaned.includes("-->") ||
    /<\/?date_simulator_/i.test(cleaned)
  ) {
    return null;
  }
  return cleaned;
}

function normalizeNpc(value) {
  if (!hasExactKeys(value, NPC_KEYS)) return null;
  const normalized = {};
  for (const key of NPC_KEYS) {
    const cleaned = cleanText(value[key], key === "name" ? 120 : 500);
    if (cleaned === null) return null;
    normalized[key] = cleaned;
  }
  return normalized;
}

function normalizeObjective(value) {
  if (!hasExactKeys(value, OBJECTIVE_KEYS)) return null;
  const normalized = {};
  for (const key of OBJECTIVE_KEYS) {
    const cleaned = cleanText(value[key], 500);
    if (cleaned === null) return null;
    normalized[key] = cleaned;
  }
  return normalized;
}

export function cloneEmptyState() {
  return {
    schemaVersion: TRACKER_SCHEMA_VERSION,
    scene: {
      ...EMPTY_SCENE,
      womanCurrent: { ...EMPTY_SCENE.womanCurrent },
    },
    arc: {
      npcs: [],
      relationship: { ...EMPTY_ARC.relationship },
      objectives: [],
    },
  };
}

export function validateTrackerStateDetailed(candidate, options = {}) {
  const fail = (error) => ({ state: null, error });
  const expectedSourceMessageId = String(options.sourceMessageId ?? "");
  const allowedSourceMessageIds = new Set(
    (options.allowedSourceMessageIds ?? [])
      .map((value) => String(value ?? ""))
      .filter(Boolean),
  );
  if (expectedSourceMessageId) allowedSourceMessageIds.add(expectedSourceMessageId);
  if (!isPlainObject(candidate)) return fail("response did not contain a JSON object");
  if (!hasExactKeys(candidate, ROOT_KEYS)) {
    return fail(`root keys must be exactly: ${ROOT_KEYS.join(", ")}`);
  }
  if (candidate.schemaVersion !== TRACKER_SCHEMA_VERSION) {
    return fail(`schemaVersion must be the number ${TRACKER_SCHEMA_VERSION}`);
  }
  if (!hasExactKeys(candidate.scene, SCENE_KEYS)) {
    return fail(`scene keys must be exactly: ${SCENE_KEYS.join(", ")}`);
  }
  if (!hasExactKeys(candidate.scene.womanCurrent, WOMAN_KEYS)) {
    return fail(`scene.womanCurrent keys must be exactly: ${WOMAN_KEYS.join(", ")}`);
  }
  if (!hasExactKeys(candidate.arc, ARC_KEYS)) {
    return fail(`arc keys must be exactly: ${ARC_KEYS.join(", ")}`);
  }
  if (!hasExactKeys(candidate.arc.relationship, RELATIONSHIP_KEYS)) {
    return fail(`arc.relationship keys must be exactly: ${RELATIONSHIP_KEYS.join(", ")}`);
  }

  const normalized = cloneEmptyState();
  for (const key of SCENE_KEYS.filter((key) => key !== "womanCurrent")) {
    const maximumLength = key === "spatial" ? 1_200 : key === "manVisible" ? 1_000 : 700;
    const cleaned = cleanText(candidate.scene[key], maximumLength);
    if (cleaned === null) return fail(`scene.${key} must be a nonempty bounded string`);
    normalized.scene[key] = cleaned;
  }
  for (const key of WOMAN_KEYS) {
    const cleaned = cleanText(candidate.scene.womanCurrent[key], 1_000);
    if (cleaned === null) {
      return fail(`scene.womanCurrent.${key} must be a nonempty bounded string`);
    }
    normalized.scene.womanCurrent[key] = cleaned;
  }

  if (!Array.isArray(candidate.arc.npcs) || candidate.arc.npcs.length > 24) {
    return fail("arc.npcs must be an array containing at most 24 entries");
  }
  for (let index = 0; index < candidate.arc.npcs.length; index += 1) {
    const npc = candidate.arc.npcs[index];
    const normalizedNpc = normalizeNpc(npc);
    if (!normalizedNpc) return fail(`arc.npcs[${index}] has missing, extra, empty, or oversized fields`);
    normalized.arc.npcs.push(normalizedNpc);
  }

  for (const key of RELATIONSHIP_KEYS) {
    const allowEmpty = key === "latestChange" || key === "sourceMessageId";
    const cleaned = cleanText(candidate.arc.relationship[key], 1_000, { allowEmpty });
    if (cleaned === null) {
      return fail(`arc.relationship.${key} must be a bounded string`);
    }
    normalized.arc.relationship[key] = cleaned;
  }
  const latestChange = normalized.arc.relationship.latestChange;
  const sourceMessageId = normalized.arc.relationship.sourceMessageId;
  if (latestChange && allowedSourceMessageIds.size > 0 && !allowedSourceMessageIds.has(sourceMessageId)) {
    return fail("arc.relationship.sourceMessageId does not match the current or prior change source");
  }
  if (!latestChange && sourceMessageId) {
    return fail("arc.relationship.sourceMessageId must be empty when latestChange is empty");
  }

  if (!Array.isArray(candidate.arc.objectives) || candidate.arc.objectives.length > 3) {
    return fail("arc.objectives must be an array containing at most 3 entries");
  }
  for (let index = 0; index < candidate.arc.objectives.length; index += 1) {
    const objective = candidate.arc.objectives[index];
    const normalizedObjective = normalizeObjective(objective);
    if (!normalizedObjective) {
      return fail(`arc.objectives[${index}] has missing, extra, empty, or oversized fields`);
    }
    normalized.arc.objectives.push(normalizedObjective);
  }

  const encoded = JSON.stringify(normalized);
  if (encoded.length > 24_000) return fail("encoded tracker state exceeds 24,000 characters");
  return { state: normalized, error: "" };
}

export function validateTrackerState(candidate, options = {}) {
  return validateTrackerStateDetailed(candidate, options).state;
}

export const TRACKER_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "integer", const: TRACKER_SCHEMA_VERSION },
    scene: {
      type: "object",
      additionalProperties: false,
      properties: {
        date: { type: "string" },
        time: { type: "string" },
        weather: { type: "string" },
        location: { type: "string" },
        immediateContext: { type: "string" },
        womanCurrent: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(WOMAN_KEYS.map((key) => [key, { type: "string" }])),
          required: WOMAN_KEYS,
        },
        manVisible: { type: "string" },
        spatial: { type: "string" },
      },
      required: SCENE_KEYS,
    },
    arc: {
      type: "object",
      additionalProperties: false,
      properties: {
        npcs: {
          type: "array",
          maxItems: 24,
          items: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(NPC_KEYS.map((key) => [key, { type: "string" }])),
            required: NPC_KEYS,
          },
        },
        relationship: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(
            RELATIONSHIP_KEYS.map((key) => [key, { type: "string" }]),
          ),
          required: RELATIONSHIP_KEYS,
        },
        objectives: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(
              OBJECTIVE_KEYS.map((key) => [key, { type: "string" }]),
            ),
            required: OBJECTIVE_KEYS,
          },
        },
      },
      required: ARC_KEYS,
    },
  },
  required: ROOT_KEYS,
});
