import assert from "node:assert/strict";
import test from "node:test";

import {
  TRACKER_JSON_SCHEMA,
  TRACKER_OUTPUT_JSON_SCHEMA,
  cloneEmptyState,
  recoverTrackerOutputDetailed,
  recoverTrackerStateDetailed,
  trackerStateForLlm,
  upgradeTrackerState,
  validateTrackerState,
  validateTrackerStateDetailed,
} from "../src/schemas.js";

test("accepts the documented minimal scene and arc schema", () => {
  const state = cloneEmptyState();
  state.scene.date = "Saturday, August 9, 2026";
  state.scene.manVisible.dressAndLayers = "User-established navy jacket.";
  state.scene.manVisible.physicalState = "No injury established.";
  state.arc.relationship.latestChange = "She agreed to another date.";
  state.arc.relationship.sourceMessageId = "assistant-1";
  state.arc.response.personalInterest = "Growing from neutral to mild interest.";
  state.arc.response.latestChange = "Personal interest increased after reciprocal conversation.";
  state.arc.response.sourceMessageId = "assistant-1";
  state.arc.objectives.push({
    owner: "Elena",
    objective: "Confirm the restaurant for Friday.",
    status: "active",
    timing: "Before Friday evening.",
    sourceMessageId: "assistant-1",
  });
  assert.deepEqual(
    validateTrackerState(state, { sourceMessageId: "assistant-1" }),
    state,
  );
  assert.equal(Object.hasOwn(state.scene, "manVisible"), true);
  assert.equal(Object.hasOwn(state.scene, "womanStable"), true);
});

test("rejects extra fields, oversized objectives, and forged source ids", () => {
  const extra = cloneEmptyState();
  extra.scene.unexpected = "unsafe";
  assert.equal(validateTrackerState(extra), null);
  assert.match(validateTrackerStateDetailed(extra).error, /scene has unexpected field: unexpected/);

  const tooMany = cloneEmptyState();
  tooMany.arc.objectives = Array.from({ length: 4 }, (_, index) => ({
    owner: "Elena",
    objective: `Task ${index}`,
    status: "active",
    timing: "Unknown",
    sourceMessageId: "",
  }));
  assert.equal(validateTrackerState(tooMany), null);

  const forged = cloneEmptyState();
  forged.arc.relationship.latestChange = "Changed";
  forged.arc.relationship.sourceMessageId = "wrong";
  assert.equal(validateTrackerState(forged, { sourceMessageId: "right" }), null);

  const forgedResponse = cloneEmptyState();
  forgedResponse.arc.response.latestChange = "Attraction increased.";
  forgedResponse.arc.response.sourceMessageId = "wrong";
  assert.equal(validateTrackerState(forgedResponse, { sourceMessageId: "right" }), null);

  const forgedLifecycle = cloneEmptyState();
  forgedLifecycle.scene.lifecycle.reason = "The scene ended.";
  forgedLifecycle.scene.lifecycle.sourceMessageId = "wrong";
  assert.equal(validateTrackerState(forgedLifecycle, { sourceMessageId: "right" }), null);

  const forgedNpc = cloneEmptyState();
  forgedNpc.arc.npcs.push({
    name: "Nia",
    role: "Friend",
    relationship: "Woman's friend",
    currentStatus: "At the cafe",
    immediateObjective: "Finish lunch",
    sourceMessageId: "wrong",
  });
  assert.equal(validateTrackerState(forgedNpc, { sourceMessageId: "right" }), null);
});

test("recovers harmless leaf and objective failures without discarding valid sections", () => {
  const previous = cloneEmptyState();
  previous.scene.weather = "Clear and cool.";
  previous.arc.objectives = [{
    owner: "Elena",
    objective: "Confirm Friday dinner.",
    status: "active",
    timing: "Before Friday evening.",
    sourceMessageId: "",
  }];

  const candidate = structuredClone(previous);
  candidate.scene.date = "Sunday, August 10, 2026";
  candidate.scene.weather = "";
  candidate.scene.extraNarration = "ignored";
  candidate.arc.objectives = [{
    owner: "Elena",
    objective: "Choose a restaurant.",
    status: "",
    timing: "Before Friday evening.",
    sourceMessageId: "",
  }];

  const recovered = recoverTrackerStateDetailed(candidate, { previousState: previous });
  assert.ok(recovered.state);
  assert.equal(recovered.state.scene.date, "Sunday, August 10, 2026");
  assert.equal(recovered.state.scene.weather, "Clear and cool.");
  assert.deepEqual(recovered.state.arc.objectives, previous.arc.objectives);
  assert.equal(Object.hasOwn(recovered.state.scene, "extraNarration"), false);
  assert.match(recovered.warnings.join("; "), /scene\.weather was invalid/);
  assert.match(recovered.warnings.join("; "), /arc\.objectives\[0\]\.status must not be empty/);
});

test("preserves the prior relationship when source linkage is unsupported", () => {
  const previous = cloneEmptyState();
  previous.arc.relationship.latestChange = "She accepted another date.";
  previous.arc.relationship.sourceMessageId = "a-prior";
  const candidate = structuredClone(previous);
  candidate.arc.relationship.latestChange = "She agreed to move in.";
  candidate.arc.relationship.sourceMessageId = "forged";

  const recovered = recoverTrackerStateDetailed(candidate, {
    previousState: previous,
    allowedSourceMessageIds: ["a-current", "a-prior"],
  });
  assert.deepEqual(recovered.state.arc.relationship, previous.arc.relationship);
  assert.match(recovered.warnings.join("; "), /source linkage was invalid/);
});

test("preserves prior private response when source linkage is unsupported", () => {
  const previous = cloneEmptyState();
  previous.arc.response.personalInterest = "Mild and uncertain.";
  previous.arc.response.latestChange = "Personal interest increased slightly.";
  previous.arc.response.sourceMessageId = "a-prior";
  const candidate = structuredClone(previous);
  candidate.arc.response.romanticInterest = "Strong.";
  candidate.arc.response.latestChange = "Romantic interest jumped.";
  candidate.arc.response.sourceMessageId = "forged";

  const recovered = recoverTrackerStateDetailed(candidate, {
    previousState: previous,
    allowedSourceMessageIds: ["a-current", "a-prior"],
  });
  assert.deepEqual(recovered.state.arc.response, previous.arc.response);
  assert.match(recovered.warnings.join("; "), /response source linkage was invalid/);
});

test("upgrades schema-v1 checkpoints with conservative unknown response and stable appearance", () => {
  const legacy = cloneEmptyState();
  legacy.schemaVersion = 1;
  delete legacy.arc.response;
  legacy.scene.location = "Cafe";
  const upgraded = upgradeTrackerState(legacy);
  assert.equal(upgraded.schemaVersion, 4);
  assert.equal(upgraded.scene.location, "Cafe");
  assert.equal(upgraded.arc.response.physicalAttraction, "Unknown");
  assert.equal(upgraded.arc.response.sourceMessageId, "");
  assert.equal(upgraded.scene.womanStable.face, "Unknown");
});

test("upgrades schema-v2 checkpoints with conservative unknown stable appearance", () => {
  const legacy = cloneEmptyState();
  legacy.schemaVersion = 2;
  delete legacy.scene.womanStable;
  legacy.scene.location = "Train platform";
  legacy.arc.response.rapportAndTrust = "Early rapport established.";
  const upgraded = upgradeTrackerState(legacy);
  assert.equal(upgraded.schemaVersion, 4);
  assert.equal(upgraded.scene.location, "Train platform");
  assert.equal(upgraded.scene.womanStable.eyes, "Unknown");
  assert.equal(upgraded.arc.response.rapportAndTrust, "Early rapport established.");
});

test("upgrades schema-v3 combined physical fields and lifecycle conservatively", () => {
  const legacy = cloneEmptyState();
  legacy.schemaVersion = 3;
  delete legacy.scene.lifecycle;
  legacy.scene.manVisible = "Navy jacket; standing by the table; no injury established.";
  legacy.scene.spatial = "She is seated; he is standing opposite; her phone is on the table.";
  delete legacy.arc.lifecycle;
  legacy.arc.npcs = [{
    name: "Nia",
    role: "Friend",
    relationship: "Woman's friend",
    currentStatus: "At the cafe",
    immediateObjective: "Finish lunch",
  }];
  legacy.arc.objectives = [{ owner: "Nia", objective: "Finish lunch", status: "active" }];

  const upgraded = upgradeTrackerState(legacy);
  assert.equal(upgraded.schemaVersion, 4);
  assert.equal(upgraded.scene.lifecycle.status, "active");
  assert.match(upgraded.scene.manVisible.appearance, /Navy jacket/);
  assert.match(upgraded.scene.spatial.proximityAndContact, /standing opposite/);
  assert.equal(upgraded.arc.npcs[0].sourceMessageId, "");
  assert.equal(upgraded.arc.objectives[0].timing, "Unknown");
});

test("validates sourced scene and arc lifecycle endings", () => {
  const state = cloneEmptyState();
  state.scene.lifecycle = {
    status: "ended",
    reason: "Dinner concluded after they made a later plan.",
    sourceMessageId: "assistant-end",
  };
  state.arc.lifecycle = {
    status: "active",
    reason: "A second date remains established.",
    sourceMessageId: "assistant-end",
  };
  assert.ok(validateTrackerState(state, { sourceMessageId: "assistant-end" }));

  state.arc.lifecycle.status = "ended";
  state.arc.lifecycle.reason = "";
  assert.match(
    validateTrackerStateDetailed(state, { sourceMessageId: "assistant-end" }).error,
    /reason must explain an ended state/,
  );
});

test("enforces the nonsexual private-response value in Teen Mode", () => {
  const candidate = cloneEmptyState();
  candidate.arc.response.sexualInterest = "Mild";
  assert.equal(validateTrackerState(candidate, { teenMode: true }), null);
  assert.match(
    validateTrackerStateDetailed(candidate, { teenMode: true }).error,
    /Not applicable in Teen Mode/,
  );
  const recovered = recoverTrackerStateDetailed(candidate, { teenMode: true });
  assert.equal(recovered.state.arc.response.sexualInterest, "Not applicable in Teen Mode.");
  assert.match(recovered.warnings.join("; "), /Teen Mode nonsexual value/);
});

test("canonical and provider schemas avoid regex and bounded-repetition grammar traps", () => {
  const objective = TRACKER_JSON_SCHEMA.properties.arc.properties.objectives.items.properties;
  assert.deepEqual(objective.owner, { type: "string" });
  assert.deepEqual(objective.objective, { type: "string" });
  assert.deepEqual(objective.status, { type: "string" });
  assert.deepEqual(objective.timing, { type: "string" });
  assert.deepEqual(objective.sourceMessageId, { type: "string" });
  const encoded = JSON.stringify(TRACKER_JSON_SCHEMA);
  assert.doesNotMatch(encoded, /"pattern"|"minLength"|"maxLength"/);
  assert.doesNotMatch(
    JSON.stringify(TRACKER_OUTPUT_JSON_SCHEMA),
    /"pattern"|"minLength"|"maxLength"/,
  );
});

test("LLM-facing schema preserves paths while replacing provenance ids with actions", () => {
  const sceneLifecycle = TRACKER_OUTPUT_JSON_SCHEMA.properties.scene.properties.lifecycle.properties;
  const arc = TRACKER_OUTPUT_JSON_SCHEMA.properties.arc.properties;
  assert.deepEqual(sceneLifecycle.action, { type: "string", enum: ["preserve", "update"] });
  assert.equal(sceneLifecycle.sourceMessageId, undefined);
  assert.ok(arc.lifecycle.properties.action);
  assert.ok(arc.npcs.items.properties.action);
  assert.ok(arc.relationship.properties.action);
  assert.ok(arc.response.properties.action);
  assert.ok(arc.objectives.items.properties.action);
  assert.doesNotMatch(JSON.stringify(TRACKER_OUTPUT_JSON_SCHEMA), /sourceMessageId|previousIndex/);
});

test("provider previous state removes every source id without changing schema paths", () => {
  const previous = cloneEmptyState();
  previous.scene.lifecycle.sourceMessageId = "scene-source";
  previous.arc.lifecycle.sourceMessageId = "arc-source";
  previous.arc.relationship.latestChange = "Relationship changed.";
  previous.arc.relationship.sourceMessageId = "relationship-source";
  previous.arc.response.latestChange = "Response changed.";
  previous.arc.response.sourceMessageId = "response-source";
  previous.arc.npcs.push({
    name: "Nia",
    role: "Friend",
    relationship: "Woman's friend",
    currentStatus: "At the cafe",
    immediateObjective: "Finish lunch",
    sourceMessageId: "npc-source",
  });
  previous.arc.objectives.push({
    owner: "Nia",
    objective: "Finish lunch",
    status: "active",
    timing: "Before closing",
    sourceMessageId: "objective-source",
  });
  const output = trackerStateForLlm(previous);
  assert.equal(output.scene.lifecycle.action, "preserve");
  assert.equal(output.arc.npcs[0].action, "preserve");
  assert.equal(output.arc.objectives[0].action, "preserve");
  assert.doesNotMatch(JSON.stringify(output), /sourceMessageId|scene-source|npc-source/);
  assert.deepEqual(Object.keys(output.scene), Object.keys(previous.scene));
  assert.deepEqual(Object.keys(output.arc), Object.keys(previous.arc));
});

test("backend assigns the current source for updates at all six sourced locations", () => {
  const previous = cloneEmptyState();
  previous.arc.npcs.push({
    name: "Nia",
    role: "Friend",
    relationship: "Woman's friend",
    currentStatus: "At the cafe",
    immediateObjective: "Finish lunch",
    sourceMessageId: "prior-npc",
  });
  previous.arc.objectives.push({
    owner: "Nia",
    objective: "Finish lunch",
    status: "active",
    timing: "Before closing",
    sourceMessageId: "prior-objective",
  });
  const output = trackerStateForLlm(previous);
  output.scene.lifecycle = {
    status: "ended",
    reason: "The cafe meeting concluded.",
    action: "update",
  };
  output.arc.lifecycle = {
    status: "ended",
    reason: "No continuing connection remains.",
    action: "update",
  };
  output.arc.npcs[0].currentStatus = "Leaving the cafe";
  output.arc.npcs[0].action = "update";
  output.arc.relationship.womanPosture = "More distant";
  output.arc.relationship.latestChange = "Her posture became more distant.";
  output.arc.relationship.action = "update";
  output.arc.response.personalInterest = "Low";
  output.arc.response.latestChange = "Personal interest decreased.";
  output.arc.response.action = "update";
  output.arc.objectives[0].status = "completed";
  output.arc.objectives[0].action = "update";

  const recovered = recoverTrackerOutputDetailed(output, {
    previousState: previous,
    sourceMessageId: "assistant-current",
    allowedSourceMessageIds: ["assistant-current", "prior-npc", "prior-objective"],
  });
  assert.ok(recovered.state);
  assert.equal(recovered.warnings.length, 0);
  assert.equal(recovered.state.scene.lifecycle.sourceMessageId, "assistant-current");
  assert.equal(recovered.state.arc.lifecycle.sourceMessageId, "assistant-current");
  assert.equal(recovered.state.arc.npcs[0].sourceMessageId, "assistant-current");
  assert.equal(recovered.state.arc.relationship.sourceMessageId, "assistant-current");
  assert.equal(recovered.state.arc.response.sourceMessageId, "assistant-current");
  assert.equal(recovered.state.arc.objectives[0].sourceMessageId, "assistant-current");
});

test("preserve actions retain canonical sections and exact list-item provenance", () => {
  const previous = cloneEmptyState();
  previous.scene.lifecycle = {
    status: "ended",
    reason: "The scene ended earlier.",
    sourceMessageId: "prior-scene",
  };
  previous.arc.relationship.latestChange = "She accepted another date.";
  previous.arc.relationship.sourceMessageId = "prior-relationship";
  previous.arc.response.latestChange = "Trust increased.";
  previous.arc.response.sourceMessageId = "prior-response";
  previous.arc.npcs.push({
    name: "Nia",
    role: "Friend",
    relationship: "Woman's friend",
    currentStatus: "At the cafe",
    immediateObjective: "Finish lunch",
    sourceMessageId: "prior-npc",
  });
  const output = trackerStateForLlm(previous);
  output.scene.lifecycle.status = "active";
  output.scene.lifecycle.reason = "";
  output.arc.relationship.latestChange = "";
  output.arc.response.latestChange = "";

  const recovered = recoverTrackerOutputDetailed(output, {
    previousState: previous,
    sourceMessageId: "assistant-current",
    allowedSourceMessageIds: [
      "assistant-current",
      "prior-scene",
      "prior-relationship",
      "prior-response",
      "prior-npc",
    ],
  });
  assert.deepEqual(recovered.state.scene.lifecycle, previous.scene.lifecycle);
  assert.deepEqual(recovered.state.arc.relationship, previous.arc.relationship);
  assert.deepEqual(recovered.state.arc.response, previous.arc.response);
  assert.deepEqual(recovered.state.arc.npcs, previous.arc.npcs);
});

test("empty update summaries and legacy LLM source ids recover without dangling provenance", () => {
  const previous = cloneEmptyState();
  previous.arc.relationship.latestChange = "She exchanged phone numbers.";
  previous.arc.relationship.sourceMessageId = "prior-change";
  previous.arc.response.latestChange = "Interest increased.";
  previous.arc.response.sourceMessageId = "prior-response";
  const output = trackerStateForLlm(previous);
  output.arc.relationship.action = "update";
  output.arc.relationship.latestChange = "";
  output.arc.relationship.sourceMessageId = "prior-change";
  output.arc.response.latestChange = "";
  output.arc.response.sourceMessageId = "prior-response";

  const recovered = recoverTrackerOutputDetailed(output, {
    previousState: previous,
    sourceMessageId: "assistant-current",
    allowedSourceMessageIds: ["assistant-current", "prior-change", "prior-response"],
  });
  assert.deepEqual(recovered.state.arc.relationship, previous.arc.relationship);
  assert.deepEqual(recovered.state.arc.response, previous.arc.response);
  assert.match(recovered.warnings.join("; "), /latestChange must describe an update/);
  assert.match(recovered.warnings.join("; "), /ignored unexpected fields: sourceMessageId/);
  assert.doesNotMatch(recovered.warnings.join("; "), /source linkage was invalid/);
});

test("allows a prior relationship change to persist on a no-change turn", () => {
  const state = cloneEmptyState();
  state.arc.relationship.latestChange = "She accepted his apology.";
  state.arc.relationship.sourceMessageId = "assistant-prior";
  assert.ok(
    validateTrackerState(state, {
      allowedSourceMessageIds: ["assistant-current", "assistant-prior"],
    }),
  );
});
