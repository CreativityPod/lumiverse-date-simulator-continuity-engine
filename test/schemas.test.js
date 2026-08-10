import assert from "node:assert/strict";
import test from "node:test";

import {
  TRACKER_JSON_SCHEMA,
  cloneEmptyState,
  recoverTrackerStateDetailed,
  validateTrackerState,
  validateTrackerStateDetailed,
} from "../src/schemas.js";

test("accepts the documented minimal scene and arc schema", () => {
  const state = cloneEmptyState();
  state.scene.date = "Saturday, August 9, 2026";
  state.scene.manVisible = "User-established navy jacket; no injury established.";
  state.arc.relationship.latestChange = "She agreed to another date.";
  state.arc.relationship.sourceMessageId = "assistant-1";
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
