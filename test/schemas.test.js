import assert from "node:assert/strict";
import test from "node:test";

import {
  TRACKER_JSON_SCHEMA,
  cloneEmptyState,
  recoverTrackerStateDetailed,
  upgradeTrackerState,
  validateTrackerState,
  validateTrackerStateDetailed,
} from "../src/schemas.js";

test("accepts the documented minimal scene and arc schema", () => {
  const state = cloneEmptyState();
  state.scene.date = "Saturday, August 9, 2026";
  state.scene.manVisible = "User-established navy jacket; no injury established.";
  state.arc.relationship.latestChange = "She agreed to another date.";
  state.arc.relationship.sourceMessageId = "assistant-1";
  state.arc.response.personalInterest = "Growing from neutral to mild interest.";
  state.arc.response.latestChange = "Personal interest increased after reciprocal conversation.";
  state.arc.response.sourceMessageId = "assistant-1";
  state.arc.objectives.push({
    owner: "Elena",
    objective: "Confirm the restaurant for Friday.",
    status: "active",
  });
  assert.deepEqual(
    validateTrackerState(state, { sourceMessageId: "assistant-1" }),
    state,
  );
  assert.equal(Object.hasOwn(state.scene, "manVisible"), true);
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
});

test("recovers harmless leaf and objective failures without discarding valid sections", () => {
  const previous = cloneEmptyState();
  previous.scene.weather = "Clear and cool.";
  previous.arc.objectives = [{ owner: "Elena", objective: "Confirm Friday dinner.", status: "active" }];

  const candidate = structuredClone(previous);
  candidate.scene.date = "Sunday, August 10, 2026";
  candidate.scene.weather = "";
  candidate.scene.extraNarration = "ignored";
  candidate.arc.objectives = [{ owner: "Elena", objective: "Choose a restaurant.", status: "" }];

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

test("upgrades schema-v1 checkpoints with conservative unknown response state", () => {
  const legacy = cloneEmptyState();
  legacy.schemaVersion = 1;
  delete legacy.arc.response;
  legacy.scene.location = "Cafe";
  const upgraded = upgradeTrackerState(legacy);
  assert.equal(upgraded.schemaVersion, 2);
  assert.equal(upgraded.scene.location, "Cafe");
  assert.equal(upgraded.arc.response.physicalAttraction, "Unknown");
  assert.equal(upgraded.arc.response.sourceMessageId, "");
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

test("provider schema avoids regex and bounded-repetition grammar traps", () => {
  const objective = TRACKER_JSON_SCHEMA.properties.arc.properties.objectives.items.properties;
  assert.deepEqual(objective.owner, { type: "string" });
  assert.deepEqual(objective.objective, { type: "string" });
  assert.deepEqual(objective.status, { type: "string" });
  const encoded = JSON.stringify(TRACKER_JSON_SCHEMA);
  assert.doesNotMatch(encoded, /"pattern"|"minLength"|"maxLength"/);
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
