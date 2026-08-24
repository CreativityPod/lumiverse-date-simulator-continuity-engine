import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanonicalState,
  buildCompactPromptState,
  buildSurpriseMeSample,
  checkpointKey,
  compactPromptMessages,
  deriveTranscriptContext,
  isV14Prompt,
  listEligibleTurns,
  normalizeStore,
  prefixFingerprint,
  stripManagedText,
  stripStartupMenuMarkers,
  validateCaseCapsuleDetailed,
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

test("derives a current case, legacy migration signal, and reset epoch", () => {
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

test("reports the exact malformed private-profile field", () => {
  const malformed = CASE.replace("BOUNDARIES: No assumed touch.", "BOUNDARIES:");
  const validation = validateCaseCapsuleDetailed(malformed);
  assert.equal(validation.value, null);
  assert.match(validation.error, /BOUNDARIES is empty/);
  const context = deriveTranscriptContext([
    { id: "a-invalid", role: "assistant", content: `Opening.\n<!--DATE_SIM_CASE\n${malformed}\nEND_DATE_SIM_CASE-->` },
  ]);
  assert.equal(context.active, false);
  assert.equal(context.invalidCaseMessageId, "a-invalid");
  assert.match(context.caseError, /BOUNDARIES is empty/);
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
    {
      role: "system",
      content: `<date_simulator_version>1.5.5</date_simulator_version>
• SAVED CASE:
<date_simulator_saved_case_fallback>
${CASE}
</date_simulator_saved_case_fallback>
• This neighboring instruction may be freely rewritten.`,
    },
    { id: "a0", role: "assistant", content: `Visible.\n${caseEnvelope}` },
    { id: "u1", role: "user", content: "Continue." },
  ];
  const compacted = compactPromptMessages(messages, CASE, cloneEmptyState());
  const providerText = compacted.messages.map((message) => String(message.content)).join("\n");
  assert.match(compacted.messages[0].content, /SAVED CASE:\s*\n\[managed by Date Simulator Continuity Engine\]/);
  assert.match(compacted.messages[0].content, /neighboring instruction may be freely rewritten/);
  assert.doesNotMatch(compacted.messages[0].content, /date_simulator_saved_case_fallback/);
  assert.equal((providerText.match(/CASE: DS-V14-01/g) ?? []).length, 1);
  assert.equal(compacted.messages[1].content, "Visible.");
  assert.equal(compacted.messages[2].role, "system");
  assert.match(compacted.messages[2].content, /CURRENT SCENE/);
  assert.match(compacted.messages[2].content, /CURRENT ARC/);
  assert.match(compacted.messages[2].content, /omitted CURRENT SCENE or CURRENT ARC field is unknown/);
  assert.doesNotMatch(compacted.messages[2].content, /"sourceMessageId"/);
  assert.doesNotMatch(compacted.messages[2].content, /"Unknown"/);
  assert.match(compacted.messages[2].content, /schema_version="4"/);
  assert.match(buildCanonicalState(CASE, cloneEmptyState()), /status="active"/);
  assert.equal(stripManagedText(caseEnvelope), "");
});

test("does not guess at unmarked saved-case prose", () => {
  const legacySystem = `<date_simulator_version>1.5</date_simulator_version>
• SAVED CASE: ${CASE}
• Treat a nonempty saved capsule as canonical.`;
  const compacted = compactPromptMessages([
    { role: "system", content: legacySystem },
    { role: "user", content: "Continue." },
  ], CASE, cloneEmptyState());
  assert.equal(compacted.messages[0].content, legacySystem);
});

test("projects complete private state into compact prompt text without provenance or defaults", () => {
  const state = cloneEmptyState();
  state.scene.date = "Tuesday, September 22";
  state.scene.time = "6:15 p.m.";
  state.scene.weather = "unknown";
  state.scene.location = "Denver airport terminal gate area";
  state.scene.womanCurrent.mentalState = "work-focused; anxious about deadlines";
  state.scene.manVisible.appearance = "Average height; athletic build";
  state.scene.lifecycle = {
    status: "ended",
    reason: "Boarding began.",
    sourceMessageId: "assistant-scene-source",
  };
  state.arc.relationship.establishedStatus = "unarranged strangers";
  state.arc.relationship.activeBoundaryOrConcern = "Professional boundaries while working";
  state.arc.response.availableAttention = "low due to laptop focus";
  state.arc.response.rapportAndTrust = "none established";
  state.arc.response.physicalAttraction = "undetermined";
  state.arc.response.contactExchangeInterest = "none established";
  state.arc.response.sourceMessageId = "assistant-response-source";
  state.arc.objectives = [{
    owner: "Elena Rodriguez",
    objective: "finish project draft before boarding",
    status: "active",
    timing: "before boarding",
    sourceMessageId: "assistant-objective-source",
  }];

  const projected = buildCompactPromptState(state);
  assert.match(projected, /WHEN: Tuesday, September 22; 6:15 p\.m\./);
  assert.match(projected, /LIFECYCLE: ended; REASON: Boarding began\./);
  assert.match(projected, /MENTAL STATE: work-focused; anxious about deadlines/);
  assert.match(projected, /PRIVATE RESPONSE: AVAILABLE ATTENTION: low due to laptop focus; RAPPORT & TRUST: none established; PHYSICAL ATTRACTION: undetermined; CONTACT-EXCHANGE INTEREST: none established/);
  assert.match(projected, /OBJECTIVE 1: OWNER: Elena Rodriguez; OBJECTIVE: finish project draft before boarding; STATUS: active; TIMING: before boarding/);
  assert.doesNotMatch(projected, /sourceMessageId|assistant-(?:scene|response|objective)-source/);
  assert.doesNotMatch(projected, /WEATHER|Unknown|npcs|\{\}|\[\]/);
});

test("recognizes v1.5 patch prompts without promoting prompt-only examples", () => {
  const messages = [
    { role: "system", content: "<date_simulator_version>1.5.1</date_simulator_version>" },
    { role: "assistant", content: `Example only.\n${caseEnvelope}` },
  ];
  assert.equal(isV14Prompt(messages), true);
  const context = deriveTranscriptContext([]);
  assert.equal(context.active, false);
  const compacted = compactPromptMessages(messages, CASE, cloneEmptyState());
  assert.match(compacted.messages.map((message) => String(message.content)).join("\n"), /schema_version="4"/);
});

test("normalizes schema-v1 stores and checkpoints to tracker schema v4", () => {
  const legacyState = cloneEmptyState();
  legacyState.schemaVersion = 1;
  delete legacyState.arc.response;
  legacyState.scene.location = "Legacy cafe";
  const store = normalizeStore({
    schemaVersion: 1,
    chatId: "old",
    current: legacyState,
    checkpoints: {
      "a1::0": { fingerprint: "abcd", state: legacyState },
    },
  }, "chat-current");
  assert.equal(store.schemaVersion, 2);
  assert.equal(store.chatId, "chat-current");
  assert.equal(store.current.schemaVersion, 4);
  assert.equal(store.current.scene.location, "Legacy cafe");
  assert.equal(store.checkpoints["a1::0"].state.arc.response.rapportAndTrust, "Unknown");
  assert.equal(store.checkpoints["a1::0"].state.scene.womanStable.face, "Unknown");
});

test("builds one deterministic prompt-only Surprise Me casting draw", () => {
  const messages = [
    { role: "system", content: "<date_simulator_version>1.5.1</date_simulator_version>" },
    { id: "u1", role: "user", content: "Surprise Me" },
  ];
  const first = buildSurpriseMeSample(messages, "chat-sample");
  assert.ok(first);
  assert.match(first.message.content, /relationshipSituation:/);
  assert.match(first.message.content, /preferenceAlignment:/);
  assert.match(first.message.content, /Do not preselect attraction, success, rejection/);
  assert.doesNotMatch(first.message.content, /culturalBackground:/);

  const withPriorSampler = [...messages];
  withPriorSampler.splice(first.insertionIndex, 0, first.message);
  const second = buildSurpriseMeSample(withPriorSampler, "chat-sample");
  assert.equal(second.seed, first.seed);
  assert.equal(second.message.content, first.message.content);
  assert.equal(buildSurpriseMeSample([
    { role: "system", content: "<date_simulator_version>1.5</date_simulator_version>" },
    { role: "user", content: "Quick Setup" },
  ], "chat-sample"), null);
  assert.equal(buildSurpriseMeSample([
    { role: "system", content: "<date_simulator_version>1.5.5</date_simulator_version>" },
    { role: "assistant", content: "1. Upload an image\n2. Enter her age\n3. Generate automatically" },
    { role: "user", content: "1" },
  ], "chat-sample"), null);
  assert.equal(buildSurpriseMeSample([
    { role: "system", content: "<date_simulator_version>1.5.5</date_simulator_version>" },
    { role: "user", content: "1" },
  ], "chat-sample"), null);
  const markedNumeric = buildSurpriseMeSample([
    { role: "system", content: "<date_simulator_version>1.5.5</date_simulator_version>" },
    { role: "assistant", content: "1. Surprise Me\n2. Quick Setup\n<!--DATE_SIM_STARTUP_MENU_V1-->" },
    { role: "user", content: "1" },
  ], "chat-sample-numeric");
  assert.ok(markedNumeric);
  assert.doesNotMatch(
    markedNumeric.messages.map((message) => String(message.content)).join("\n"),
    /DATE_SIM_STARTUP_MENU_V1/,
  );
  const strippedNonSample = stripStartupMenuMarkers([
    { role: "assistant", content: "Startup.\n<!--DATE_SIM_STARTUP_MENU_V1-->" },
    { role: "user", content: "2" },
  ]);
  assert.equal(strippedNonSample[0].content, "Startup.");
  assert.equal(buildSurpriseMeSample([
    { role: "system", content: "<date_simulator_version>1.4.1</date_simulator_version>" },
    { role: "user", content: "Surprise Me" },
  ], "chat-sample"), null);
});
