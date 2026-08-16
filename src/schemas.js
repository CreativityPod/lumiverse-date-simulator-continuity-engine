export const TRACKER_SCHEMA_VERSION = 3;

export const EMPTY_SCENE = Object.freeze({
  date: "Unknown",
  time: "Unknown",
  weather: "Unknown",
  location: "Unknown",
  immediateContext: "Unknown",
  womanStable: Object.freeze({
    face: "Unknown",
    eyes: "Unknown",
    skin: "Unknown",
    bodyTypeAndProportions: "Unknown",
  }),
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
  response: Object.freeze({
    availableAttention: "Unknown",
    comfortAndSafety: "Unknown",
    rapportAndTrust: "Unknown",
    physicalAttraction: "Unknown",
    personalInterest: "Unknown",
    romanticInterest: "Unknown",
    sexualInterest: "Unknown or not applicable",
    willingnessToContinue: "Unknown",
    contactExchangeInterest: "Unknown",
    desireToLeave: "Unknown",
    activeUncertainty: "None established.",
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
  "womanStable",
  "womanCurrent",
  "manVisible",
  "spatial",
];
const WOMAN_STABLE_KEYS = ["face", "eyes", "skin", "bodyTypeAndProportions"];
const WOMAN_KEYS = ["hairAndGrooming", "dress", "physicalState", "mentalState"];
const ARC_KEYS = ["npcs", "relationship", "response", "objectives"];
const NPC_KEYS = ["name", "role", "relationship", "currentStatus", "immediateObjective"];
const RELATIONSHIP_KEYS = [
  "establishedStatus",
  "womanPosture",
  "activeBoundaryOrConcern",
  "latestChange",
  "sourceMessageId",
];
const RESPONSE_KEYS = [
  "availableAttention",
  "comfortAndSafety",
  "rapportAndTrust",
  "physicalAttraction",
  "personalInterest",
  "romanticInterest",
  "sexualInterest",
  "willingnessToContinue",
  "contactExchangeInterest",
  "desireToLeave",
  "activeUncertainty",
  "latestChange",
  "sourceMessageId",
];
const OBJECTIVE_KEYS = ["owner", "objective", "status"];

function providerStringSchema() {
  // Keep the provider grammar deliberately structural. llama.cpp's
  // JSON-schema converter cannot parse PCRE shorthands such as \s, and large
  // bounded repetitions can also exceed its grammar limits. Exact lengths,
  // emptiness, and managed-markup rules are enforced locally before commit.
  return { type: "string" };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function keyValidationError(value, keys, path) {
  if (!isPlainObject(value)) return `${path} must be an object`;
  const actual = Object.keys(value);
  const missing = keys.filter((key) => !actual.includes(key));
  const extra = actual.filter((key) => !keys.includes(key));
  if (missing.length) return `${path} is missing field${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`;
  if (extra.length) return `${path} has unexpected field${extra.length === 1 ? "" : "s"}: ${extra.join(", ")}`;
  return "";
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

function textValidationError(value, maximumLength, path, { allowEmpty = false } = {}) {
  if (typeof value !== "string") return `${path} must be a string`;
  const cleaned = value.replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").trim();
  if (!allowEmpty && !cleaned) return `${path} must not be empty`;
  if (cleaned.length > maximumLength) {
    return `${path} is ${cleaned.length} characters; maximum is ${maximumLength}`;
  }
  if (cleaned.includes("<!--") || cleaned.includes("-->") || /<\/?date_simulator_/i.test(cleaned)) {
    return `${path} contains managed markup`;
  }
  return "";
}

function recoverText(value, maximumLength, { allowEmpty = false } = {}) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").trim();
  if ((!allowEmpty && !cleaned) || cleaned.includes("<!--") || cleaned.includes("-->") || /<\/?date_simulator_/i.test(cleaned)) {
    return null;
  }
  return cleaned.slice(0, maximumLength);
}

function normalizeNpcDetailed(value, path = "arc.npcs[]") {
  const keyError = keyValidationError(value, NPC_KEYS, path);
  if (keyError) return { value: null, error: keyError };
  const normalized = {};
  for (const key of NPC_KEYS) {
    const maximumLength = key === "name" ? 120 : 500;
    const error = textValidationError(value[key], maximumLength, `${path}.${key}`);
    if (error) return { value: null, error };
    const cleaned = cleanText(value[key], maximumLength);
    normalized[key] = cleaned;
  }
  return { value: normalized, error: "" };
}

function normalizeObjectiveDetailed(value, path = "arc.objectives[]") {
  const keyError = keyValidationError(value, OBJECTIVE_KEYS, path);
  if (keyError) return { value: null, error: keyError };
  const normalized = {};
  for (const key of OBJECTIVE_KEYS) {
    const error = textValidationError(value[key], 500, `${path}.${key}`);
    if (error) return { value: null, error };
    const cleaned = cleanText(value[key], 500);
    normalized[key] = cleaned;
  }
  return { value: normalized, error: "" };
}

export function cloneEmptyState() {
  return {
    schemaVersion: TRACKER_SCHEMA_VERSION,
    scene: {
      ...EMPTY_SCENE,
      womanStable: { ...EMPTY_SCENE.womanStable },
      womanCurrent: { ...EMPTY_SCENE.womanCurrent },
    },
    arc: {
      npcs: [],
      relationship: { ...EMPTY_ARC.relationship },
      response: { ...EMPTY_ARC.response },
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
  const rootKeyError = keyValidationError(candidate, ROOT_KEYS, "root");
  if (rootKeyError) return fail(rootKeyError);
  if (candidate.schemaVersion !== TRACKER_SCHEMA_VERSION) {
    return fail(`schemaVersion must be the number ${TRACKER_SCHEMA_VERSION}`);
  }
  const sceneKeyError = keyValidationError(candidate.scene, SCENE_KEYS, "scene");
  if (sceneKeyError) return fail(sceneKeyError);
  const womanStableKeyError = keyValidationError(candidate.scene.womanStable, WOMAN_STABLE_KEYS, "scene.womanStable");
  if (womanStableKeyError) return fail(womanStableKeyError);
  const womanKeyError = keyValidationError(candidate.scene.womanCurrent, WOMAN_KEYS, "scene.womanCurrent");
  if (womanKeyError) return fail(womanKeyError);
  const arcKeyError = keyValidationError(candidate.arc, ARC_KEYS, "arc");
  if (arcKeyError) return fail(arcKeyError);
  const relationshipKeyError = keyValidationError(candidate.arc.relationship, RELATIONSHIP_KEYS, "arc.relationship");
  if (relationshipKeyError) return fail(relationshipKeyError);
  const responseKeyError = keyValidationError(candidate.arc.response, RESPONSE_KEYS, "arc.response");
  if (responseKeyError) return fail(responseKeyError);

  const normalized = cloneEmptyState();
  for (const key of SCENE_KEYS.filter((key) => key !== "womanStable" && key !== "womanCurrent")) {
    const maximumLength = key === "spatial" ? 1_200 : key === "manVisible" ? 1_000 : 700;
    const error = textValidationError(candidate.scene[key], maximumLength, `scene.${key}`);
    if (error) return fail(error);
    const cleaned = cleanText(candidate.scene[key], maximumLength);
    normalized.scene[key] = cleaned;
  }
  for (const key of WOMAN_STABLE_KEYS) {
    const error = textValidationError(candidate.scene.womanStable[key], 1_000, `scene.womanStable.${key}`);
    if (error) return fail(error);
    const cleaned = cleanText(candidate.scene.womanStable[key], 1_000);
    normalized.scene.womanStable[key] = cleaned;
  }
  for (const key of WOMAN_KEYS) {
    const error = textValidationError(candidate.scene.womanCurrent[key], 1_000, `scene.womanCurrent.${key}`);
    if (error) return fail(error);
    const cleaned = cleanText(candidate.scene.womanCurrent[key], 1_000);
    normalized.scene.womanCurrent[key] = cleaned;
  }

  if (!Array.isArray(candidate.arc.npcs) || candidate.arc.npcs.length > 24) {
    return fail("arc.npcs must be an array containing at most 24 entries");
  }
  for (let index = 0; index < candidate.arc.npcs.length; index += 1) {
    const npc = candidate.arc.npcs[index];
    const result = normalizeNpcDetailed(npc, `arc.npcs[${index}]`);
    if (!result.value) return fail(result.error);
    normalized.arc.npcs.push(result.value);
  }

  for (const key of RELATIONSHIP_KEYS) {
    const allowEmpty = key === "latestChange" || key === "sourceMessageId";
    const error = textValidationError(candidate.arc.relationship[key], 1_000, `arc.relationship.${key}`, { allowEmpty });
    if (error) return fail(error);
    const cleaned = cleanText(candidate.arc.relationship[key], 1_000, { allowEmpty });
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

  for (const key of RESPONSE_KEYS) {
    const allowEmpty = key === "latestChange" || key === "sourceMessageId";
    const error = textValidationError(candidate.arc.response[key], 700, `arc.response.${key}`, { allowEmpty });
    if (error) return fail(error);
    const cleaned = cleanText(candidate.arc.response[key], 700, { allowEmpty });
    normalized.arc.response[key] = cleaned;
  }
  if (
    options.teenMode &&
    normalized.arc.response.sexualInterest !== "Not applicable in Teen Mode."
  ) {
    return fail("arc.response.sexualInterest must be Not applicable in Teen Mode.");
  }
  const responseLatestChange = normalized.arc.response.latestChange;
  const responseSourceMessageId = normalized.arc.response.sourceMessageId;
  if (
    responseLatestChange &&
    allowedSourceMessageIds.size > 0 &&
    !allowedSourceMessageIds.has(responseSourceMessageId)
  ) {
    return fail("arc.response.sourceMessageId does not match the current or prior change source");
  }
  if (!responseLatestChange && responseSourceMessageId) {
    return fail("arc.response.sourceMessageId must be empty when latestChange is empty");
  }

  if (!Array.isArray(candidate.arc.objectives) || candidate.arc.objectives.length > 3) {
    return fail("arc.objectives must be an array containing at most 3 entries");
  }
  for (let index = 0; index < candidate.arc.objectives.length; index += 1) {
    const objective = candidate.arc.objectives[index];
    const result = normalizeObjectiveDetailed(objective, `arc.objectives[${index}]`);
    if (!result.value) return fail(result.error);
    normalized.arc.objectives.push(result.value);
  }

  const encoded = JSON.stringify(normalized);
  if (encoded.length > 24_000) return fail("encoded tracker state exceeds 24,000 characters");
  return { state: normalized, error: "" };
}

export function validateTrackerState(candidate, options = {}) {
  return validateTrackerStateDetailed(candidate, options).state;
}

export function upgradeTrackerState(candidate, options = {}) {
  if (!isPlainObject(candidate)) return null;
  if (candidate.schemaVersion === TRACKER_SCHEMA_VERSION) {
    return validateTrackerState(candidate, options);
  }
  if (![1, 2].includes(candidate.schemaVersion) || !isPlainObject(candidate.arc)) return null;
  const upgraded = {
    ...candidate,
    schemaVersion: TRACKER_SCHEMA_VERSION,
    scene: {
      ...candidate.scene,
      womanStable: { ...EMPTY_SCENE.womanStable },
    },
    arc: {
      ...candidate.arc,
      response: candidate.schemaVersion === 1
        ? { ...EMPTY_ARC.response }
        : candidate.arc.response,
    },
  };
  return validateTrackerState(upgraded, options);
}

function extraKeys(value, keys) {
  return isPlainObject(value) ? Object.keys(value).filter((key) => !keys.includes(key)) : [];
}

function previousOrEmpty(previousState) {
  if (!previousState) return cloneEmptyState();
  return upgradeTrackerState(previousState, {
    sourceMessageId: previousState.arc?.relationship?.sourceMessageId || undefined,
    allowedSourceMessageIds: [
      previousState.arc?.relationship?.sourceMessageId,
      previousState.arc?.response?.sourceMessageId,
    ].filter(Boolean),
  }) ?? cloneEmptyState();
}

export function recoverTrackerStateDetailed(candidate, options = {}) {
  const fail = (error) => ({ state: null, error, warnings: [] });
  if (!isPlainObject(candidate)) return fail("response did not contain a JSON object");
  if (candidate.schemaVersion !== TRACKER_SCHEMA_VERSION) {
    return fail(`schemaVersion must be the number ${TRACKER_SCHEMA_VERSION}`);
  }
  if (!isPlainObject(candidate.scene)) return fail("scene must be an object");
  if (!isPlainObject(candidate.arc)) return fail("arc must be an object");

  const baseline = previousOrEmpty(options.previousState);
  const normalized = structuredClone(baseline);
  normalized.schemaVersion = TRACKER_SCHEMA_VERSION;
  const warnings = [];
  let usableParts = 0;
  const noteExtras = (value, keys, path) => {
    const extras = extraKeys(value, keys);
    if (extras.length) warnings.push(`${path} ignored unexpected fields: ${extras.join(", ")}`);
  };
  noteExtras(candidate, ROOT_KEYS, "root");
  noteExtras(candidate.scene, SCENE_KEYS, "scene");
  noteExtras(candidate.arc, ARC_KEYS, "arc");

  for (const key of SCENE_KEYS.filter((key) => key !== "womanStable" && key !== "womanCurrent")) {
    const maximumLength = key === "spatial" ? 1_200 : key === "manVisible" ? 1_000 : 700;
    const recovered = recoverText(candidate.scene[key], maximumLength);
    if (recovered === null) {
      warnings.push(`scene.${key} was invalid; preserved the previous value`);
    } else {
      if (String(candidate.scene[key]).trim().length > maximumLength) {
        warnings.push(`scene.${key} was oversized and was truncated to ${maximumLength} characters`);
      }
      normalized.scene[key] = recovered;
      usableParts += 1;
    }
  }

  if (!isPlainObject(candidate.scene.womanStable)) {
    warnings.push("scene.womanStable was invalid; preserved the previous section");
  } else {
    noteExtras(candidate.scene.womanStable, WOMAN_STABLE_KEYS, "scene.womanStable");
    for (const key of WOMAN_STABLE_KEYS) {
      const recovered = recoverText(candidate.scene.womanStable[key], 1_000);
      if (recovered === null) {
        warnings.push(`scene.womanStable.${key} was invalid; preserved the previous value`);
      } else {
        if (String(candidate.scene.womanStable[key]).trim().length > 1_000) {
          warnings.push(`scene.womanStable.${key} was oversized and was truncated to 1000 characters`);
        }
        normalized.scene.womanStable[key] = recovered;
        usableParts += 1;
      }
    }
  }

  if (!isPlainObject(candidate.scene.womanCurrent)) {
    warnings.push("scene.womanCurrent was invalid; preserved the previous section");
  } else {
    noteExtras(candidate.scene.womanCurrent, WOMAN_KEYS, "scene.womanCurrent");
    for (const key of WOMAN_KEYS) {
      const recovered = recoverText(candidate.scene.womanCurrent[key], 1_000);
      if (recovered === null) {
        warnings.push(`scene.womanCurrent.${key} was invalid; preserved the previous value`);
      } else {
        if (String(candidate.scene.womanCurrent[key]).trim().length > 1_000) {
          warnings.push(`scene.womanCurrent.${key} was oversized and was truncated to 1000 characters`);
        }
        normalized.scene.womanCurrent[key] = recovered;
        usableParts += 1;
      }
    }
  }

  if (!Array.isArray(candidate.arc.npcs)) {
    warnings.push("arc.npcs was invalid; preserved the previous NPC list");
  } else {
    const recoveredNpcs = [];
    let npcError = "";
    for (let index = 0; index < Math.min(candidate.arc.npcs.length, 24); index += 1) {
      const npc = candidate.arc.npcs[index];
      if (!isPlainObject(npc)) {
        npcError = `arc.npcs[${index}] must be an object`;
        break;
      }
      const npcExtras = extraKeys(npc, NPC_KEYS);
      if (npcExtras.length) warnings.push(`arc.npcs[${index}] ignored unexpected fields: ${npcExtras.join(", ")}`);
      const recoveredNpc = {};
      for (const key of NPC_KEYS) {
        const maximumLength = key === "name" ? 120 : 500;
        const value = recoverText(npc[key], maximumLength);
        if (value === null) {
          npcError = textValidationError(npc[key], maximumLength, `arc.npcs[${index}].${key}`);
          break;
        }
        if (String(npc[key]).trim().length > maximumLength) {
          warnings.push(`arc.npcs[${index}].${key} was oversized and was truncated to ${maximumLength} characters`);
        }
        recoveredNpc[key] = value;
      }
      if (npcError) break;
      recoveredNpcs.push(recoveredNpc);
    }
    if (npcError) {
      warnings.push(`${npcError}; preserved the previous NPC list`);
    } else {
      if (candidate.arc.npcs.length > 24) warnings.push("arc.npcs exceeded 24 entries and was truncated");
      normalized.arc.npcs = recoveredNpcs;
      usableParts += 1;
    }
  }

  if (!isPlainObject(candidate.arc.relationship)) {
    warnings.push("arc.relationship was invalid; preserved the previous relationship");
  } else {
    noteExtras(candidate.arc.relationship, RELATIONSHIP_KEYS, "arc.relationship");
    const recoveredRelationship = { ...normalized.arc.relationship };
    for (const key of RELATIONSHIP_KEYS) {
      const allowEmpty = key === "latestChange" || key === "sourceMessageId";
      const recovered = recoverText(candidate.arc.relationship[key], 1_000, { allowEmpty });
      if (recovered === null) {
        warnings.push(`arc.relationship.${key} was invalid; preserved the previous value`);
      } else {
        if (String(candidate.arc.relationship[key]).trim().length > 1_000) {
          warnings.push(`arc.relationship.${key} was oversized and was truncated to 1000 characters`);
        }
        recoveredRelationship[key] = recovered;
      }
    }
    const allowedSourceMessageIds = new Set(
      (options.allowedSourceMessageIds ?? []).map((value) => String(value ?? "")).filter(Boolean),
    );
    if (options.sourceMessageId) allowedSourceMessageIds.add(String(options.sourceMessageId));
    const invalidSource = recoveredRelationship.latestChange
      ? allowedSourceMessageIds.size > 0 && !allowedSourceMessageIds.has(recoveredRelationship.sourceMessageId)
      : Boolean(recoveredRelationship.sourceMessageId);
    if (invalidSource) {
      warnings.push("arc.relationship source linkage was invalid; preserved the previous relationship");
    } else {
      normalized.arc.relationship = recoveredRelationship;
      usableParts += 1;
    }
  }

  if (!isPlainObject(candidate.arc.response)) {
    warnings.push("arc.response was invalid; preserved the previous response state");
  } else {
    noteExtras(candidate.arc.response, RESPONSE_KEYS, "arc.response");
    const recoveredResponse = { ...normalized.arc.response };
    for (const key of RESPONSE_KEYS) {
      const allowEmpty = key === "latestChange" || key === "sourceMessageId";
      const recovered = recoverText(candidate.arc.response[key], 700, { allowEmpty });
      if (recovered === null) {
        warnings.push(`arc.response.${key} was invalid; preserved the previous value`);
      } else {
        if (String(candidate.arc.response[key]).trim().length > 700) {
          warnings.push(`arc.response.${key} was oversized and was truncated to 700 characters`);
        }
        recoveredResponse[key] = recovered;
      }
    }
    if (options.teenMode && recoveredResponse.sexualInterest !== "Not applicable in Teen Mode.") {
      recoveredResponse.sexualInterest = "Not applicable in Teen Mode.";
      warnings.push("arc.response.sexualInterest was replaced with the Teen Mode nonsexual value");
    }
    const allowedSourceMessageIds = new Set(
      (options.allowedSourceMessageIds ?? []).map((value) => String(value ?? "")).filter(Boolean),
    );
    if (options.sourceMessageId) allowedSourceMessageIds.add(String(options.sourceMessageId));
    const invalidSource = recoveredResponse.latestChange
      ? allowedSourceMessageIds.size > 0 && !allowedSourceMessageIds.has(recoveredResponse.sourceMessageId)
      : Boolean(recoveredResponse.sourceMessageId);
    if (invalidSource) {
      warnings.push("arc.response source linkage was invalid; preserved the previous response state");
    } else {
      normalized.arc.response = recoveredResponse;
      usableParts += 1;
    }
  }

  if (!Array.isArray(candidate.arc.objectives)) {
    warnings.push("arc.objectives was invalid; preserved the previous objectives");
  } else {
    const recoveredObjectives = [];
    let objectiveError = "";
    for (let index = 0; index < Math.min(candidate.arc.objectives.length, 3); index += 1) {
      const objective = candidate.arc.objectives[index];
      if (!isPlainObject(objective)) {
        objectiveError = `arc.objectives[${index}] must be an object`;
        break;
      }
      const objectiveExtras = extraKeys(objective, OBJECTIVE_KEYS);
      if (objectiveExtras.length) {
        warnings.push(`arc.objectives[${index}] ignored unexpected fields: ${objectiveExtras.join(", ")}`);
      }
      const recoveredObjective = {};
      for (const key of OBJECTIVE_KEYS) {
        const value = recoverText(objective[key], 500);
        if (value === null) {
          objectiveError = textValidationError(objective[key], 500, `arc.objectives[${index}].${key}`);
          break;
        }
        if (String(objective[key]).trim().length > 500) {
          warnings.push(`arc.objectives[${index}].${key} was oversized and was truncated to 500 characters`);
        }
        recoveredObjective[key] = value;
      }
      if (objectiveError) break;
      recoveredObjectives.push(recoveredObjective);
    }
    if (objectiveError) {
      warnings.push(`${objectiveError}; preserved the previous objectives`);
    } else {
      if (candidate.arc.objectives.length > 3) warnings.push("arc.objectives exceeded 3 entries and was truncated");
      normalized.arc.objectives = recoveredObjectives;
      usableParts += 1;
    }
  }

  if (usableParts === 0) return fail("response contained no usable tracker fields");
  const validated = validateTrackerStateDetailed(normalized, options);
  if (!validated.state) return fail(`recovered state remained invalid: ${validated.error}`);
  return { state: validated.state, error: "", warnings };
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
        date: providerStringSchema(),
        time: providerStringSchema(),
        weather: providerStringSchema(),
        location: providerStringSchema(),
        immediateContext: providerStringSchema(),
        womanStable: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(
            WOMAN_STABLE_KEYS.map((key) => [key, providerStringSchema()]),
          ),
          required: WOMAN_STABLE_KEYS,
        },
        womanCurrent: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(
            WOMAN_KEYS.map((key) => [key, providerStringSchema()]),
          ),
          required: WOMAN_KEYS,
        },
        manVisible: providerStringSchema(),
        spatial: providerStringSchema(),
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
            properties: Object.fromEntries(
              NPC_KEYS.map((key) => [
                key,
                providerStringSchema(),
              ]),
            ),
            required: NPC_KEYS,
          },
        },
        relationship: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(
            RELATIONSHIP_KEYS.map((key) => [
              key,
              providerStringSchema(),
            ]),
          ),
          required: RELATIONSHIP_KEYS,
        },
        response: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(
            RESPONSE_KEYS.map((key) => [
              key,
              providerStringSchema(),
            ]),
          ),
          required: RESPONSE_KEYS,
        },
        objectives: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(
              OBJECTIVE_KEYS.map((key) => [key, providerStringSchema()]),
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
