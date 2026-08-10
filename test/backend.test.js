import assert from "node:assert/strict";
import test from "node:test";

import { cloneEmptyState } from "../src/schemas.js";

const CASE = `CASE: DS-V14-BACKEND; Date Simulator v1.4; Adult Mode; cafe.
MAN: Adult; appearance Unknown.
WOMAN: Amara Okafor; 30; Nigerian American; architect.
DISPOSITION: Direct and observant.
PREFERENCES: Values patience.
RELATIONSHIP: Single and open to dating.
CURRENT CONTEXT: At a cafe; sober.
BOUNDARIES: No assumed touch.
INITIAL STATE: Neutral curiosity.`;

test("background reconciliation saves state and the interceptor injects one branch state", async () => {
  const events = new Map();
  const files = new Map();
  const variables = new Map();
  const frontendMessages = [];
  const messages = [
    { id: "u0", role: "user", content: "Surprise me" },
    {
      id: "a0",
      role: "assistant",
      swipe_id: 0,
      content: `She looks up from her coffee.\n<!--DATE_SIM_CASE\n${CASE}\nEND_DATE_SIM_CASE-->`,
    },
  ];
  let interceptor;
  let interceptorPriority;
  let frontendHandler;
  const connectionListUsers = [];
  const generatedUsers = [];

  globalThis.spindle = {
    permissions: {
      has: (permission) => ["generation", "interceptor", "chat_mutation"].includes(permission),
      onChanged: () => () => undefined,
    },
    storage: {
      getJson: async (name, options) => structuredClone(files.get(name) ?? options?.fallback),
      setJson: async (name, value) => files.set(name, structuredClone(value)),
    },
    variables: {
      chat: {
        get: async (chatId, key) => variables.get(`${chatId}:${key}`) ?? "",
        set: async (chatId, key, value) => variables.set(`${chatId}:${key}`, value),
      },
    },
    chat: { getMessages: async () => structuredClone(messages) },
    connections: {
      list: async (userId) => {
        connectionListUsers.push(userId);
        return [{ id: "openai", name: "Tracker", provider: "openai", model: "small", is_default: true }];
      },
      get: async () => ({ id: "openai", provider: "openai", model: "small", is_default: true }),
    },
    generate: {
      quiet: async (input) => {
        generatedUsers.push(input.userId);
        return { content: JSON.stringify(cloneEmptyState()) };
      },
    },
    registerInterceptor: (handler, priority) => {
      interceptor = handler;
      interceptorPriority = priority;
    },
    on: (name, handler) => {
      events.set(name, handler);
      return () => events.delete(name);
    },
    onFrontendMessage: (handler) => {
      frontendHandler = handler;
      return () => { frontendHandler = undefined; };
    },
    sendToFrontend: (payload) => frontendMessages.push(payload),
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
  };

  const { backendTest } = await import(`../src/backend.js?backend-test=${Date.now()}`);
  assert.equal(typeof interceptor, "function");
  assert.equal(interceptorPriority, 250);
  assert.ok(events.has("MESSAGE_SWIPED"));
  assert.equal(typeof frontendHandler, "function");
  assert.equal(backendTest.normalizeConfig({}).maxTokens, 2_000);
  assert.equal(backendTest.normalizeConfig({ timeoutMs: 300_000 }).timeoutMs, 300_000);
  assert.equal(backendTest.normalizeConfig({ timeoutMs: 900_000 }).timeoutMs, 300_000);

  const setupPrompt = [
    { role: "system", content: "<date_simulator_version>1.4</date_simulator_version>" },
    { role: "user", content: "Surprise me" },
  ];
  assert.equal(await interceptor(setupPrompt, { chatId: "chat-1" }), setupPrompt);

  await frontendHandler({ type: "continuity_get_status", chatId: "chat-1" }, "user-1");
  assert.ok(frontendMessages.some((payload) => payload.chatId === "chat-1"));
  await frontendHandler({ type: "continuity_get_connections" }, "user-1");
  assert.ok(connectionListUsers.includes("user-1"));
  assert.ok(connectionListUsers.every((userId) => userId === "user-1"));
  assert.ok(frontendMessages.some(
    (payload) => payload.type === "continuity_connections" && payload.connections[0]?.id === "openai",
  ));

  await events.get("MESSAGE_SENT")({ chatId: "chat-1", message: messages[1] }, "user-1");

  assert.equal(variables.get("chat-1:date_simulator.phase"), "active");
  assert.equal(variables.get("chat-1:date_simulator.tracker_version"), "1");
  assert.match(variables.get("chat-1:date_simulator.case"), /DS-V14-BACKEND/);
  assert.equal(JSON.parse(variables.get("chat-1:date_simulator.scene_v2")).date, "Unknown");
  assert.equal(files.get("chats/chat-1.json").revision, 1);
  assert.ok(frontendMessages.some((payload) => payload.level === "green"));
  assert.ok(generatedUsers.length > 0);
  assert.ok(generatedUsers.every((userId) => userId === "user-1"));

  const assembled = [
    { role: "system", content: "<date_simulator_version>1.4</date_simulator_version>" },
    messages[1],
    { id: "u1", role: "user", content: "Hello." },
  ];
  const result = await interceptor(assembled, { chatId: "chat-1" });
  assert.equal(result.breakdown[0].name, "Date Simulator Continuity Engine");
  const output = result.messages.map((message) => String(message.content)).join("\n");
  assert.equal((output.match(/<date_simulator_continuity_engine/g) ?? []).length, 1);
  assert.doesNotMatch(output, /<!--DATE_SIM_CASE/);
  assert.match(output, /DS-V14-BACKEND/);

  delete globalThis.spindle;
});
