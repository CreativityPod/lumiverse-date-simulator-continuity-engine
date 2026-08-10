import assert from "node:assert/strict";
import test from "node:test";

import { cloneEmptyState, validateTrackerState } from "../src/schemas.js";

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
