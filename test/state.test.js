import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanonicalState,
  checkpointKey,
  compactPromptMessages,
  deriveTranscriptContext,
  listEligibleTurns,
  prefixFingerprint,
  stripManagedText,
} from "../src/state.js";
import { cloneEmptyState } from "../src/schemas.js";

const CASE = `CASE: DS-V14-01; Date Simulator v1.4; Adult Mode; cafe.
MAN: Adult; appearance Unknown.
WOMAN: Elena Park; 29; Korean American; planner.
DISPOSITION: Calm and analytical.
PREFERENCES: Values curiosity.
RELATIONSHIP: Single and available.
CURRENT CONTEXT: At a cafe; sober.
BOUNDARIES: No assumed touch.
INITIAL STATE: Neutral curiosity.`;

const LEGACY_SCENE = `SCENE: Evening; cafe.
WOMAN VISUAL: Elena; neat hair.
WOMAN OUTFIT: Blue dress.
WOMAN PHYSICAL: Sober.
MAN VISIBLE: Adult.
SPATIAL: Opposite seats.`;

const caseEnvelope = `<!--DATE_SIM_CASE\n${CASE}\nEND_DATE_SIM_CASE-->`;
const sceneEnvelope = `<!--DATE_SIM_SCENE\n${LEGACY_SCENE}\nEND_DATE_SIM_SCENE-->`;

test("derives a v1.4 case, legacy migration signal, and reset epoch", () => {
  const active = deriveTranscriptContext([
    { id: "a1", role: "assistant", content: `${caseEnvelope}\n${sceneEnvelope}` },
  ]);
  assert.equal(active.active, true);
  assert.equal(active.migrationRequired, true);
  assert.equal(active.caseMessageId, "a1");

  const reset = deriveTranscriptContext([
    { id: "a1", role: "assistant", content: caseEnvelope },
    { id: "a2", role: "assistant", content: "# New Case\n<!--DATE_SIM_RESET-->" },
  ]);
  assert.equal(reset.active, false);
  assert.equal(reset.epoch, 1);
});

test("lists immersive turns but excludes look, debrief, and reset responses", () => {
  const messages = [
    { id: "u0", role: "user", content: "Surprise me" },
    { id: "a0", role: "assistant", content: `Opening.\n${caseEnvelope}` },
    { id: "u1", role: "user", content: "/look" },
    { id: "a1", role: "assistant", content: "She is seated." },
    { id: "u2", role: "user", content: "Hello." },
    { id: "a2", role: "assistant", content: "She looks up. \"Hi.\"" },
  ];
  const turns = listEligibleTurns(messages, deriveTranscriptContext(messages));
  assert.deepEqual(turns.map((turn) => turn.assistant.id), ["a0", "a2"]);
});

test("fingerprints change after content edits and include swipe selection", () => {
  const base = [{ id: "a", role: "assistant", swipe_id: 0, content: "One" }];
  const edited = [{ ...base[0], content: "Two" }];
  const swiped = [{ ...base[0], swipe_id: 1 }];
  assert.notEqual(prefixFingerprint(base, 0), prefixFingerprint(edited, 0));
  assert.notEqual(prefixFingerprint(base, 0), prefixFingerprint(swiped, 0));
  assert.equal(checkpointKey(swiped[0]), "a::1");
});

test("compacts private markers and injects exactly one canonical block", () => {
  const messages = [
    { role: "system", content: "<date_simulator_version>1.4</date_simulator_version>" },
    { id: "a0", role: "assistant", content: `Visible.\n${caseEnvelope}` },
    { id: "u1", role: "user", content: "Continue." },
  ];
  const compacted = compactPromptMessages(messages, CASE, cloneEmptyState());
  assert.equal(compacted.messages[1].content, "Visible.");
  assert.equal(compacted.messages[2].role, "system");
  assert.match(compacted.messages[2].content, /CURRENT SCENE/);
  assert.match(buildCanonicalState(CASE, cloneEmptyState()), /status="active"/);
  assert.equal(stripManagedText(caseEnvelope), "");
});
