import assert from "node:assert/strict";
import test from "node:test";

import { cloneEmptyState, trackerStateForLlm } from "../src/schemas.js";
import { createStore } from "../src/state.js";

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
      read: async (name) => {
        if (!files.has(name)) throw new Error("File not found");
        return JSON.stringify(files.get(name));
      },
      list: async (prefix = "") => [...files.keys()]
        .filter((name) => name.startsWith(prefix))
        .map((name) => name.slice(prefix.length)),
      exists: async (name) => files.has(name),
      delete: async (name) => { files.delete(name); },
      stat: async (name) => ({
        exists: files.has(name),
        isFile: files.has(name),
        isDirectory: false,
        sizeBytes: files.has(name) ? JSON.stringify(files.get(name)).length : 0,
        modifiedAt: new Date(0).toISOString(),
      }),
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
        return { content: JSON.stringify(trackerStateForLlm(null)) };
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
  assert.equal(backendTest.normalizeConfig({}).showStatusWidget, true);
  assert.equal(backendTest.normalizeConfig({ showStatusWidget: false }).showStatusWidget, false);
  assert.equal(backendTest.normalizeConfig({ outputMode: "anthropic" }).outputMode, "anthropic");
  assert.equal(backendTest.normalizeConfig({ outputMode: "unsupported" }).outputMode, "auto");
  assert.equal(backendTest.normalizeConfig({ timeoutMs: 120_000 }).timeoutMs, 120_000);
  assert.equal(backendTest.normalizeConfig({ timeoutMs: 300_000 }).timeoutMs, 120_000);

  const privateState = cloneEmptyState();
  privateState.scene.womanStable.face = "Oval face with a small chin scar.";
  privateState.scene.womanStable.eyes = "Dark brown, almond-shaped eyes.";
  privateState.scene.womanStable.skin = "Medium-brown skin with freckles.";
  privateState.scene.womanStable.bodyTypeAndProportions = "Tall, sturdy build with balanced proportions.";
  privateState.scene.womanCurrent.mentalState = "Privately uncertain";
  privateState.scene.manVisible.dressAndLayers = "User-established navy jacket.";
  privateState.scene.spatial.proximityAndContact = "Across a small table; no contact.";
  privateState.scene.lifecycle.reason = "Private lifecycle explanation.";
  privateState.scene.lifecycle.sourceMessageId = "a-private";
  privateState.arc.lifecycle.reason = "Private arc explanation.";
  privateState.arc.lifecycle.sourceMessageId = "a-private";
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
    sourceMessageId: "a-private",
  });
  privateState.arc.objectives.push({
    owner: "Woman",
    objective: "Private objective",
    status: "Active",
    timing: "Before closing.",
    sourceMessageId: "a-private",
  });
  const publicState = backendTest.publicTrackerSnapshot(privateState);
  assert.equal(publicState.scene.womanCurrent.mentalState, undefined);
  assert.equal(publicState.arc.relationship.womanPosture, undefined);
  assert.equal(publicState.arc.relationship.activeBoundaryOrConcern, undefined);
  assert.equal(publicState.arc.relationship.sourceMessageId, undefined);
  assert.equal(publicState.arc.response, undefined);
  assert.equal(publicState.arc.npcs[0].immediateObjective, undefined);
  assert.equal(publicState.arc.npcs[0].sourceMessageId, undefined);
  assert.equal(publicState.arc.objectives, undefined);
  assert.equal(publicState.scene.womanCurrent.dress, "Unknown");
  assert.equal(publicState.scene.womanStable.face, "Oval face with a small chin scar.");
  assert.equal(publicState.scene.womanStable.eyes, "Dark brown, almond-shaped eyes.");
  assert.equal(publicState.scene.womanStable.skin, "Medium-brown skin with freckles.");
  assert.equal(
    publicState.scene.womanStable.bodyTypeAndProportions,
    "Tall, sturdy build with balanced proportions.",
  );
  assert.equal(publicState.arc.npcs[0].name, "Nia");
  assert.equal(publicState.scene.manVisible.dressAndLayers, "User-established navy jacket.");
  assert.equal(publicState.scene.spatial.proximityAndContact, "Across a small table; no contact.");
  assert.equal(publicState.scene.lifecycle.status, "active");
  assert.equal(publicState.scene.lifecycle.reason, undefined);
  assert.equal(publicState.scene.lifecycle.sourceMessageId, undefined);
  assert.equal(publicState.arc.lifecycle.status, "active");
  assert.equal(publicState.arc.lifecycle.reason, undefined);
  assert.equal(publicState.arc.lifecycle.sourceMessageId, undefined);

  const setupPrompt = [
    { role: "system", content: "<date_simulator_version>1.5.1</date_simulator_version>" },
    { role: "user", content: "Surprise me" },
  ];
  const sampledSetup = await interceptor(setupPrompt, { chatId: "chat-1" });
  assert.equal(sampledSetup.breakdown[0].name, "Date Simulator Case Sampler");
  assert.match(sampledSetup.messages[1].content, /date_simulator_case_sampler/);
  assert.equal(sampledSetup.messages[2].content, "Surprise me");

  const numericSetup = await interceptor([
    { role: "system", content: "<date_simulator_version>1.5.5</date_simulator_version>" },
    { role: "assistant", content: "1. Surprise Me\n2. Quick Setup\n<!--DATE_SIM_STARTUP_MENU_V1-->" },
    { role: "user", content: "1" },
  ], { chatId: "chat-1" });
  assert.equal(numericSetup.breakdown[0].name, "Date Simulator Case Sampler");
  assert.doesNotMatch(
    numericSetup.messages.map((message) => String(message.content)).join("\n"),
    /DATE_SIM_STARTUP_MENU_V1/,
  );

  const guidedNumeric = await interceptor([
    { role: "system", content: "<date_simulator_version>1.5.5</date_simulator_version>" },
    { role: "assistant", content: "1. Upload an image\n2. Enter her age\n3. Generate automatically" },
    { role: "user", content: "1" },
  ], { chatId: "chat-1" });
  assert.ok(Array.isArray(guidedNumeric));
  assert.doesNotMatch(
    guidedNumeric.map((message) => String(message.content)).join("\n"),
    /date_simulator_case_sampler/,
  );
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
      showStatusWidget: false,
      connectionId: "",
      outputMode: "plain",
      maxTokens: 2_000,
      timeoutMs: 120_000,
    },
  }, "user-1");
  assert.equal(files.get("config.json").timeoutMs, 120_000);
  assert.equal(files.get("config.json").outputMode, "plain");
  assert.equal(files.get("config.json").showStatusWidget, false);
  assert.ok(frontendMessages.some(
    (payload) => payload.type === "continuity_config_saved" && payload.config.timeoutMs === 120_000,
  ));
  await frontendHandler({
    type: "continuity_set_widget_visibility",
    chatId: "chat-1",
    showStatusWidget: true,
  }, "user-1");
  assert.equal(files.get("config.json").showStatusWidget, true);
  assert.equal(files.get("config.json").outputMode, "plain");
  await frontendHandler({
    type: "continuity_set_widget_visibility",
    chatId: "chat-1",
    showStatusWidget: false,
  }, "user-1");
  assert.equal(files.get("config.json").showStatusWidget, false);
  assert.equal(files.get("config.json").outputMode, "plain");
  await frontendHandler({ type: "continuity_get_status", chatId: "chat-1" }, "user-1");
  assert.equal(frontendMessages.at(-1).config.showStatusWidget, false);

  await events.get("MESSAGE_SENT")({ chatId: "chat-1", message: opening }, "user-1");

  assert.equal(variables.get("chat-1:date_simulator.phase"), "active");
  assert.equal(variables.get("chat-1:date_simulator.tracker_version"), "4");
  assert.match(variables.get("chat-1:date_simulator.case"), /DS-V14-BACKEND/);
  assert.equal(JSON.parse(variables.get("chat-1:date_simulator.scene_v2")).date, "Unknown");
  assert.equal(JSON.parse(variables.get("chat-1:date_simulator.scene_v2")).womanStable.face, "Unknown");
  assert.equal(JSON.parse(variables.get("chat-1:date_simulator.arc_v2")).response.physicalAttraction, "Unknown");
  const firstRevisionStore = files.get("chats/chat-1.json");
  const firstCheckpoint = Object.values(firstRevisionStore.checkpoints)[0];
  assert.equal(firstRevisionStore.revision, 1);
  assert.ok(firstRevisionStore.lastRevisionAt);
  assert.equal(firstRevisionStore.lastRevisionAt, firstCheckpoint.createdAt);
  assert.ok(frontendMessages.some((payload) => payload.level === "green"));
  assert.ok(generatedUsers.length > 0);
  assert.ok(generatedUsers.every((userId) => userId === "user-1"));

  // A page reload/status request schedules a verification pass. Drain that pass
  // through the per-chat queue and confirm it did not create a revision.
  await frontendHandler({ type: "continuity_get_status", chatId: "chat-1" }, "user-1");
  await events.get("MESSAGE_SENT")({ chatId: "chat-1", message: opening }, "user-1");
  assert.equal(files.get("chats/chat-1.json").revision, 1);
  assert.equal(files.get("chats/chat-1.json").lastRevisionAt, firstRevisionStore.lastRevisionAt);
  assert.ok(frontendMessages.some(
    (payload) => payload.revision === 1 && payload.lastRevisionAt === firstRevisionStore.lastRevisionAt,
  ));

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
      read: async (name) => {
        if (!files.has(name)) throw new Error("File not found");
        return JSON.stringify(files.get(name));
      },
      list: async (prefix = "") => [...files.keys()]
        .filter((name) => name.startsWith(prefix))
        .map((name) => name.slice(prefix.length)),
      exists: async (name) => files.has(name),
      delete: async (name) => { files.delete(name); },
      stat: async (name) => ({
        exists: files.has(name),
        isFile: files.has(name),
        isDirectory: false,
        sizeBytes: files.has(name) ? JSON.stringify(files.get(name)).length : 0,
        modifiedAt: new Date(0).toISOString(),
      }),
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
        return { content: JSON.stringify(trackerStateForLlm(null)), finish_reason: "stop" };
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
  assert.equal(files.get("chats/chat-barrier.json").lastRevisionAt, "");

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
  assert.ok(files.get("chats/chat-barrier.json").lastRevisionAt);
  assert.match(result.messages.map((message) => String(message.content)).join("\n"), /CURRENT SCENE/);

  delete globalThis.spindle;
});

test("does not create inert sidecars and safely cleans deleted, orphaned, and never-used stores", async () => {
  const events = new Map();
  const files = new Map();
  const frontendMessages = [];
  let frontendHandler;

  const trackedStore = (chatId) => {
    const store = createStore(chatId);
    store.caseText = CASE;
    store.current = cloneEmptyState();
    store.revision = 1;
    store.lastRevisionAt = "2026-08-27T12:00:00.000Z";
    return store;
  };

  files.set("config.json", { enabled: true });
  files.set("chats/live-tracked.json", trackedStore("live-tracked"));
  files.set("chats/live-inert.json", createStore("live-inert"));
  files.set("chats/orphan-tracked.json", trackedStore("orphan-tracked"));
  files.set("chats/auto-deleted.json", trackedStore("auto-deleted"));
  files.set("chats/mismatched.json", createStore("different-chat"));
  files.set("chats/malformed.json", "not a store envelope");
  files.set("chats/nested/ignored.json", createStore("nested-ignored"));

  const storage = {
    getJson: async (name, options) => structuredClone(files.get(name) ?? options?.fallback),
    setJson: async (name, value) => files.set(name, structuredClone(value)),
    read: async (name) => {
      if (!files.has(name)) throw new Error("File not found");
      return JSON.stringify(files.get(name));
    },
    list: async (prefix = "") => [...files.keys()]
      .filter((name) => name.startsWith(prefix))
      .map((name) => name.slice(prefix.length)),
    exists: async (name) => files.has(name),
    delete: async (name) => { files.delete(name); },
    stat: async (name) => ({
      exists: files.has(name),
      isFile: files.has(name),
      isDirectory: false,
      sizeBytes: files.has(name) ? JSON.stringify(files.get(name)).length : 0,
      modifiedAt: new Date(0).toISOString(),
    }),
  };

  globalThis.spindle = {
    permissions: {
      has: (permission) => ["generation", "interceptor", "chat_mutation"].includes(permission),
      onChanged: () => () => undefined,
    },
    storage,
    variables: {
      chat: {
        get: async () => "",
        set: async () => undefined,
      },
    },
    chat: {
      getMessages: async (chatId) => {
        if (chatId === "orphan-tracked") throw new Error("Chat not found");
        return [{ id: "ordinary", role: "user", content: "An ordinary non-Date-Simulator chat." }];
      },
    },
    connections: {
      list: async () => [],
      get: async () => ({ id: "local", provider: "openai", is_default: true }),
    },
    generate: { quiet: async () => ({ content: JSON.stringify(trackerStateForLlm(null)) }) },
    registerInterceptor: () => undefined,
    on: (name, handler) => { events.set(name, handler); return () => events.delete(name); },
    onFrontendMessage: (handler) => { frontendHandler = handler; return () => undefined; },
    sendToFrontend: (payload) => frontendMessages.push(payload),
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
  };

  const { backendTest } = await import(`../src/backend.js?cleanup-test=${Date.now()}`);
  assert.equal(backendTest.isInertStore(createStore("inert")), true);
  assert.equal(backendTest.isInertStore(trackedStore("tracked")), false);
  assert.equal(typeof events.get("CHAT_DELETED"), "function");

  await events.get("MESSAGE_SENT")({ chatId: "inactive-new", message: {} }, "user-1");
  assert.equal(files.has("chats/inactive-new.json"), false);

  await events.get("CHAT_DELETED")({ id: "auto-deleted" }, "user-1");
  assert.equal(files.has("chats/auto-deleted.json"), false);

  await frontendHandler({ type: "continuity_scan_cleanup" }, "user-1");
  const scan = frontendMessages.findLast((payload) => payload.type === "continuity_cleanup_scan_result");
  assert.equal(scan.count, 2);
  assert.equal(scan.inert, 1);
  assert.equal(scan.orphan, 1);
  assert.ok(scan.token);
  assert.match(scan.message, /Click Delete to confirm/);
  assert.equal(files.has("chats/live-inert.json"), true);
  assert.equal(files.has("chats/orphan-tracked.json"), true);

  await frontendHandler({ type: "continuity_cleanup_unused", token: scan.token }, "user-1");
  const cleanup = frontendMessages.findLast(
    (payload) => payload.type === "continuity_action_result" && payload.action === "cleanup",
  );
  assert.equal(cleanup.ok, true);
  assert.match(cleanup.message, /Deleted 2 unused tracking files/);
  assert.equal(files.has("chats/live-inert.json"), false);
  assert.equal(files.has("chats/orphan-tracked.json"), false);
  assert.equal(files.has("chats/live-tracked.json"), true);
  assert.equal(files.has("chats/mismatched.json"), true);
  assert.equal(files.has("chats/malformed.json"), true);
  assert.equal(files.has("chats/nested/ignored.json"), true);
  assert.equal(files.has("config.json"), true);

  delete globalThis.spindle;
});

test("chat deletion waits for an in-flight tracker and removes its final sidecar", async () => {
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
      read: async (name) => JSON.stringify(files.get(name)),
      list: async () => [],
      exists: async (name) => files.has(name),
      delete: async (name) => { files.delete(name); },
      stat: async () => ({ exists: false, sizeBytes: 0 }),
    },
    variables: {
      chat: {
        get: async (chatId, key) => variables.get(`${chatId}:${key}`) ?? "",
        set: async (chatId, key, value) => variables.set(`${chatId}:${key}`, value),
      },
    },
    chat: { getMessages: async () => structuredClone(messages) },
    connections: {
      list: async () => [],
      get: async () => ({ id: "local", provider: "openai", is_default: true }),
    },
    generate: {
      quiet: async () => {
        markGenerationStarted();
        await generationGate;
        return { content: JSON.stringify(trackerStateForLlm(null)) };
      },
    },
    registerInterceptor: () => undefined,
    on: (name, handler) => { events.set(name, handler); return () => events.delete(name); },
    onFrontendMessage: () => () => undefined,
    sendToFrontend: () => undefined,
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
  };

  await import(`../src/backend.js?delete-race-test=${Date.now()}`);
  const tracking = events.get("MESSAGE_SENT")({ chatId: "chat-delete-race" }, "user-1");
  await generationStarted;
  assert.equal(files.has("chats/chat-delete-race.json"), true);

  const deletion = events.get("CHAT_DELETED")({ id: "chat-delete-race" }, "user-1");
  releaseGeneration();
  await Promise.all([tracking, deletion]);
  assert.equal(files.has("chats/chat-delete-race.json"), false);

  await events.get("MESSAGE_SENT")({ chatId: "chat-delete-race" }, "user-1");
  assert.equal(files.has("chats/chat-delete-race.json"), false);

  delete globalThis.spindle;
});
