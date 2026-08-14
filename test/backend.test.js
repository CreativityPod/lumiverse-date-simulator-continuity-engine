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
  ];
  const opening = {
    id: "a0",
    role: "assistant",
    swipe_id: 0,
    content: `She looks up from her coffee.\n<!--DATE_SIM_CASE\n${CASE}\nEND_DATE_SIM_CASE-->`,
  };
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
  assert.equal(backendTest.normalizeConfig({}).outputMode, "auto");
  assert.equal(backendTest.normalizeConfig({ outputMode: "anthropic" }).outputMode, "anthropic");
  assert.equal(backendTest.normalizeConfig({ outputMode: "unsupported" }).outputMode, "auto");
  assert.equal(backendTest.normalizeConfig({ timeoutMs: 120_000 }).timeoutMs, 120_000);
  assert.equal(backendTest.normalizeConfig({ timeoutMs: 300_000 }).timeoutMs, 120_000);

  const privateState = cloneEmptyState();
  privateState.scene.womanCurrent.mentalState = "Privately uncertain";
  privateState.arc.relationship.womanPosture = "Privately guarded";
  privateState.arc.relationship.activeBoundaryOrConcern = "Private boundary";
  privateState.arc.relationship.sourceMessageId = "a-private";
  privateState.arc.response.physicalAttraction = "Privately favorable";
  privateState.arc.response.latestChange = "Private attraction changed";
  privateState.arc.response.sourceMessageId = "a-private";
  privateState.arc.npcs.push({
    name: "Nia",
    role: "Friend",
    relationship: "Woman's friend",
    currentStatus: "At the cafe",
    immediateObjective: "Privately assess the man",
  });
  privateState.arc.objectives.push({ owner: "Woman", objective: "Private objective", status: "Active" });
  const publicState = backendTest.publicTrackerSnapshot(privateState);
  assert.equal(publicState.scene.womanCurrent.mentalState, undefined);
  assert.equal(publicState.arc.relationship.womanPosture, undefined);
  assert.equal(publicState.arc.relationship.activeBoundaryOrConcern, undefined);
  assert.equal(publicState.arc.relationship.sourceMessageId, undefined);
  assert.equal(publicState.arc.response, undefined);
  assert.equal(publicState.arc.npcs[0].immediateObjective, undefined);
  assert.equal(publicState.arc.objectives, undefined);
  assert.equal(publicState.scene.womanCurrent.dress, "Unknown");
  assert.equal(publicState.arc.npcs[0].name, "Nia");

  const setupPrompt = [
    { role: "system", content: "<date_simulator_version>1.5</date_simulator_version>" },
    { role: "user", content: "Surprise me" },
  ];
  const sampledSetup = await interceptor(setupPrompt, { chatId: "chat-1" });
  assert.equal(sampledSetup.breakdown[0].name, "Date Simulator Case Sampler");
  assert.match(sampledSetup.messages[1].content, /date_simulator_case_sampler/);
  assert.equal(sampledSetup.messages[2].content, "Surprise me");
  messages.push(opening);

  await frontendHandler({ type: "continuity_get_status", chatId: "chat-1" }, "user-1");
  assert.ok(frontendMessages.some((payload) => payload.chatId === "chat-1"));
  await frontendHandler({ type: "continuity_get_connections" }, "user-1");
  assert.ok(connectionListUsers.includes("user-1"));
  assert.ok(connectionListUsers.every((userId) => userId === "user-1"));
  assert.ok(frontendMessages.some(
    (payload) => payload.type === "continuity_connections" && payload.connections[0]?.id === "openai",
  ));
  await frontendHandler({
    type: "continuity_save_config",
    chatId: "chat-1",
    config: {
      enabled: true,
      connectionId: "",
      outputMode: "plain",
      maxTokens: 2_000,
      timeoutMs: 120_000,
    },
  }, "user-1");
  assert.equal(files.get("config.json").timeoutMs, 120_000);
  assert.equal(files.get("config.json").outputMode, "plain");
  assert.ok(frontendMessages.some(
    (payload) => payload.type === "continuity_config_saved" && payload.config.timeoutMs === 120_000,
  ));

  await events.get("MESSAGE_SENT")({ chatId: "chat-1", message: opening }, "user-1");

  assert.equal(variables.get("chat-1:date_simulator.phase"), "active");
  assert.equal(variables.get("chat-1:date_simulator.tracker_version"), "2");
  assert.match(variables.get("chat-1:date_simulator.case"), /DS-V14-BACKEND/);
  assert.equal(JSON.parse(variables.get("chat-1:date_simulator.scene_v2")).date, "Unknown");
  assert.equal(JSON.parse(variables.get("chat-1:date_simulator.arc_v2")).response.physicalAttraction, "Unknown");
  assert.equal(files.get("chats/chat-1.json").revision, 1);
  assert.ok(frontendMessages.some((payload) => payload.level === "green"));
  assert.ok(generatedUsers.length > 0);
  assert.ok(generatedUsers.every((userId) => userId === "user-1"));

  await frontendHandler({
    type: "continuity_reprocess",
    chatId: "chat-1",
    includePrivate: true,
  }, "user-1");
  assert.ok(frontendMessages.some(
    (payload) => payload.type === "continuity_action_started" && payload.action === "reprocess",
  ));
  assert.ok(frontendMessages.some(
    (payload) => payload.type === "continuity_action_result" && payload.action === "reprocess" && payload.ok,
  ));

  const assembled = [
    { role: "system", content: "<date_simulator_version>1.4</date_simulator_version>" },
    opening,
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

test("saves the private profile before tracker completion and blocks the next prompt on its checkpoint", async () => {
  const events = new Map();
  const files = new Map();
  const variables = new Map();
  const messages = [
    { id: "u0", role: "user", content: "Surprise me" },
    {
      id: "a0",
      role: "assistant",
      swipe_id: 0,
      content: `She looks up.\n<!--DATE_SIM_CASE\n${CASE}\nEND_DATE_SIM_CASE-->`,
    },
  ];
  let interceptor;
  let releaseGeneration;
  let markGenerationStarted;
  const generationGate = new Promise((resolve) => { releaseGeneration = resolve; });
  const generationStarted = new Promise((resolve) => { markGenerationStarted = resolve; });

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
      list: async () => [{ id: "local", provider: "openai", is_default: true }],
      get: async () => ({ id: "local", provider: "openai", is_default: true }),
    },
    generate: {
      quiet: async () => {
        markGenerationStarted();
        await generationGate;
        return { content: JSON.stringify(cloneEmptyState()), finish_reason: "stop" };
      },
    },
    registerInterceptor: (handler) => { interceptor = handler; },
    on: (name, handler) => { events.set(name, handler); return () => events.delete(name); },
    onFrontendMessage: () => () => undefined,
    sendToFrontend: () => undefined,
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
  };

  await import(`../src/backend.js?barrier-test=${Date.now()}`);
  const tracking = events.get("MESSAGE_SENT")({ chatId: "chat-barrier", message: messages[1] }, "user-1");
  await generationStarted;

  assert.match(files.get("chats/chat-barrier.json").caseText, /DS-V14-BACKEND/);
  assert.equal(variables.get("chat-barrier:date_simulator.phase"), "active");
  assert.match(variables.get("chat-barrier:date_simulator.case"), /DS-V14-BACKEND/);
  assert.equal(files.get("chats/chat-barrier.json").revision, 0);

  const nextPrompt = [
    { role: "system", content: "<date_simulator_version>1.4</date_simulator_version>" },
    messages[1],
    { id: "u1", role: "user", content: "Hello." },
  ];
  let promptFinished = false;
  const intercepted = interceptor(nextPrompt, { chatId: "chat-barrier" }).then((value) => {
    promptFinished = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(promptFinished, false);

  releaseGeneration();
  await tracking;
  const result = await intercepted;
  assert.equal(promptFinished, true);
  assert.equal(files.get("chats/chat-barrier.json").revision, 1);
  assert.match(result.messages.map((message) => String(message.content)).join("\n"), /CURRENT SCENE/);

  delete globalThis.spindle;
});
