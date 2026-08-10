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
  const spindleApi = {
    connections: {
      list: async () => [{ id: "claude", provider: "anthropic", is_default: true }],
      get: async () => null,
    },
    generate: {
      quiet: async (input) => {
        assert.equal(input.parameters.tool_choice.name, "record_date_simulator_state");
        assert.match(input.messages[0].content, /manVisible contains only/);
        return {
          content: "",
          tool_calls: [{ name: "record_date_simulator_state", args: state }],
        };
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
  );
  assert.deepEqual(result, state);
});
