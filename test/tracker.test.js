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
});

test("tracker timeout accepts five minutes and clamps larger values", () => {
  assert.equal(trackerTest.normalizeTrackerTimeoutMs(300_000), 300_000);
  assert.equal(trackerTest.normalizeTrackerTimeoutMs(900_000), 300_000);
  assert.equal(trackerTest.normalizeTrackerTimeoutMs("invalid"), 45_000);
});

test("uses native structured output only for recognized providers", () => {
  assert.ok(trackerTest.generationParameters({ provider: "openai" }).response_format);
  assert.ok(trackerTest.generationParameters({ provider: "google_gemini" }).responseSchema);
  assert.equal(
    trackerTest.generationParameters({ provider: "anthropic" }).tool_choice.name,
    "record_date_simulator_state",
  );
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
      quiet: async (input, userId) => {
        generatedUsers.push(userId);
        assert.equal(input.parameters.tool_choice.name, "record_date_simulator_state");
        assert.match(input.messages[0].content, /manVisible contains only/);
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
  assert.deepEqual(result, state);
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
