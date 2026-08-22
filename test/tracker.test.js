import assert from "node:assert/strict";
import test from "node:test";

import { cloneEmptyState } from "../src/schemas.js";
import { runTracker, trackerTest } from "../src/tracker.js";

test("extracts raw and fenced JSON conservatively", () => {
  assert.deepEqual(trackerTest.extractJson('{"ok":true}'), { ok: true });
  assert.deepEqual(trackerTest.extractJson('```json\n{"ok":true}\n```'), { ok: true });
  assert.equal(trackerTest.extractJson("not json"), null);
});

test("tracker prompt contains the source id and agency constraints", () => {
  const prompt = trackerTest.trackerUserPrompt({
    caseText: "CASE",
    previousState: cloneEmptyState(),
    userText: "I wave.",
    assistantText: "She waves back.",
    sourceMessageId: "a1",
  });
  assert.match(prompt, /a1/);
  assert.match(prompt, /She waves back/);
  assert.match(trackerTest.systemPrompt, /physicalAttraction/);
  assert.match(trackerTest.systemPrompt, /Consent is action-specific/);
  assert.match(trackerTest.systemPrompt, /womanStable/);
  assert.match(trackerTest.systemPrompt, /Never use numbers, points, percentages/);
  assert.match(trackerTest.systemPrompt, /fictional narrative clock, never wall-clock time/);
  assert.match(trackerTest.systemPrompt, /how long the user waited in real life/);
  assert.match(trackerTest.systemPrompt, /"lifecycle":\{"status":"active or ended"/);
  assert.match(trackerTest.systemPrompt, /"timing":"string","sourceMessageId":"matching id or empty"/);
});

test("tracker timeout fits inside the five-minute interceptor budget", () => {
  assert.equal(trackerTest.normalizeTrackerTimeoutMs(120_000), 120_000);
  assert.equal(trackerTest.normalizeTrackerTimeoutMs(300_000), 120_000);
  assert.equal(trackerTest.normalizeTrackerTimeoutMs("invalid"), 30_000);
});

test("uses native structured output only for recognized providers", () => {
  const openAiParameters = trackerTest.generationParameters({ provider: "openai" });
  assert.equal(openAiParameters.max_tokens, 2_000);
  assert.ok(openAiParameters.response_format);
  assert.ok(trackerTest.generationParameters({ provider: "google_gemini" }).responseSchema);
  assert.equal(
    trackerTest.generationParameters({ provider: "anthropic" }).tool_choice.name,
    "record_date_simulator_state",
  );
  assert.deepEqual(
    trackerTest.generationTools({ provider: "anthropic" })[0].parameters.required,
    ["schemaVersion", "scene", "arc"],
  );
  assert.equal(trackerTest.generationTools({ provider: "openai" }), undefined);
  assert.equal(trackerTest.resolveOutputMode({ provider: "custom" }, "auto"), "plain");
  assert.equal(
    trackerTest.resolveOutputMode({ provider: "custom", type: "openai-compatible" }, "auto"),
    "openai",
  );
  assert.equal(trackerTest.resolveOutputMode({ provider: "custom" }, "openai"), "openai");
  assert.ok(trackerTest.generationParameters({ provider: "custom" }, "openai").response_format);
  assert.equal(trackerTest.generationTools({ provider: "openai" }, "anthropic")[0].name, "record_date_simulator_state");
});

test("retries one rejected tracker response with the validation reason", async () => {
  const state = cloneEmptyState();
  const requests = [];
  const spindleApi = {
    connections: {
      list: async () => [{ id: "custom", provider: "custom", is_default: true }],
      get: async () => null,
    },
    generate: {
      quiet: async (input) => {
        requests.push(input);
        return requests.length === 1
          ? { content: '{"schemaVersion":4}', finish_reason: "stop" }
          : { content: JSON.stringify(state), finish_reason: "stop" };
      },
    },
  };
  const result = await runTracker(
    spindleApi,
    {
      caseText: "CASE",
      previousState: null,
      userText: "Hello.",
      assistantText: "She says hello.",
      sourceMessageId: "a1",
    },
    { connectionId: "", maxTokens: 800, timeoutMs: 5_000 },
    "user-1",
  );
  assert.deepEqual(result, { state, warnings: [] });
  assert.equal(requests.length, 2);
  assert.match(requests[1].messages.at(-1).content, /scene must be an object/);
  assert.equal(requests[1].messages.at(-2).role, "assistant");
  assert.equal(requests[1].messages.at(-2).content, '{"schemaVersion":4}');
});

test("repairs a structurally empty state instead of treating defaults as an update", async () => {
  const state = cloneEmptyState();
  state.scene.location = "Station concourse";
  const requests = [];
  const spindleApi = {
    connections: { list: async () => [{ id: "local", provider: "openai-compatible", is_default: true }] },
    generate: {
      quiet: async (input) => {
        requests.push(input);
        return requests.length === 1
          ? { content: '{"schemaVersion":4,"scene":{},"arc":{}}', finish_reason: "stop" }
          : { content: JSON.stringify(state), finish_reason: "stop" };
      },
    },
  };
  const result = await runTracker(
    spindleApi,
    {
      caseText: "CASE",
      previousState: null,
      userText: "Where are we?",
      assistantText: "The concourse remains crowded.",
      sourceMessageId: "a1",
    },
    { connectionId: "", outputMode: "auto", maxTokens: 2_000, timeoutMs: 5_000 },
    "user-1",
  );
  assert.equal(requests.length, 2);
  assert.deepEqual(result, { state, warnings: [] });
  assert.match(requests[1].messages.at(-1).content, /no usable tracker fields/);
});

test("accepts a conservative objective fallback without a second model call", async () => {
  const previousState = cloneEmptyState();
  previousState.arc.objectives = [{
    owner: "Elena",
    objective: "Confirm dinner.",
    status: "active",
    timing: "Before tonight ends.",
    sourceMessageId: "",
  }];
  const candidate = structuredClone(previousState);
  candidate.scene.time = "8:15 PM";
  candidate.arc.objectives[0].status = "";
  let calls = 0;
  const spindleApi = {
    connections: { list: async () => [{ id: "local", provider: "openai-compatible", is_default: true }] },
    generate: { quiet: async () => { calls += 1; return { content: JSON.stringify(candidate), finish_reason: "stop" }; } },
  };
  const result = await runTracker(
    spindleApi,
    {
      caseText: "CASE",
      previousState,
      userText: "Continue.",
      assistantText: "She checks the time.",
      sourceMessageId: "a2",
    },
    { connectionId: "", outputMode: "auto", maxTokens: 2_000, timeoutMs: 5_000 },
    "user-1",
  );
  assert.equal(calls, 1);
  assert.equal(result.state.scene.time, "8:15 PM");
  assert.deepEqual(result.state.arc.objectives, previousState.arc.objectives);
  assert.match(result.warnings.join("; "), /status must not be empty/);
});

test("normalizes Teen Mode sexual interest locally without a repair call", async () => {
  const candidate = cloneEmptyState();
  candidate.arc.response.sexualInterest = "Mild";
  let calls = 0;
  const spindleApi = {
    connections: { list: async () => [{ id: "local", provider: "openai-compatible", is_default: true }] },
    generate: { quiet: async () => { calls += 1; return { content: JSON.stringify(candidate), finish_reason: "stop" }; } },
  };
  const result = await runTracker(
    spindleApi,
    {
      caseText: "CASE: Teen Mode; both participants 17; nonsexual.",
      previousState: null,
      userText: "Hello.",
      assistantText: "She says hello.",
      sourceMessageId: "a-teen",
    },
    { connectionId: "", outputMode: "auto", maxTokens: 2_000, timeoutMs: 5_000 },
    "user-1",
  );
  assert.equal(calls, 1);
  assert.equal(result.state.arc.response.sexualInterest, "Not applicable in Teen Mode.");
  assert.match(result.warnings.join("; "), /Teen Mode nonsexual value/);
});

test("accepts a forced Anthropic tracker tool call", async () => {
  const state = cloneEmptyState();
  const listedUsers = [];
  const fetchedConnections = [];
  const generatedUsers = [];
  const spindleApi = {
    connections: {
      list: async (userId) => {
        listedUsers.push(userId);
        return [{ id: "claude", provider: "anthropic", is_default: true }];
      },
      get: async (connectionId, userId) => {
        fetchedConnections.push({ connectionId, userId });
        return { id: connectionId, provider: "anthropic", is_default: true };
      },
    },
    generate: {
      quiet: async (input) => {
        generatedUsers.push(input.userId);
        assert.equal(input.type, "quiet");
        assert.equal(input.parameters.tool_choice.name, "record_date_simulator_state");
        assert.equal(input.tools[0].name, "record_date_simulator_state");
        assert.equal(input.tools[0].parameters.type, "object");
        assert.match(input.messages[0].content, /manVisible separates/);
        return {
          content: "",
          tool_calls: [{ name: "record_date_simulator_state", args: state }],
        };
      },
    },
  };
  const trackerInput = {
    caseText: "CASE",
    previousState: null,
    userText: "Hello.",
    assistantText: "She says hello.",
    sourceMessageId: "a1",
  };
  const result = await runTracker(
    spindleApi,
    trackerInput,
    { connectionId: "", maxTokens: 800, timeoutMs: 5_000 },
    "user-1",
  );
  assert.deepEqual(result, { state, warnings: [] });
  await runTracker(
    spindleApi,
    trackerInput,
    { connectionId: "claude", maxTokens: 800, timeoutMs: 5_000 },
    "user-1",
  );
  assert.deepEqual(listedUsers, ["user-1"]);
  assert.deepEqual(fetchedConnections, [{ connectionId: "claude", userId: "user-1" }]);
  assert.deepEqual(generatedUsers, ["user-1", "user-1"]);
});
