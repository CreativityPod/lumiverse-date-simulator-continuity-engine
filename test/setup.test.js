import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { cloneEmptyState, trackerSourceMessageIds, trackerStateForLlm } from '../src/schemas.js';
import {
  SETUP_FORMAT, IMPORT_LOADED_TEXT, assignSetupSources, validateSetupFile,
  deriveTranscriptContext, importedSetupForMessage, initialSetupForBranch,
  isImportSetupSelection, listEligibleTurns, prefixFingerprint, createStore,
  stripStartupMenuMarkers,
} from '../src/state.js';
import { pickSetupFile } from '../src/frontend.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/date-simulator-v1.5.6-setup.json', import.meta.url)));
const card = { first_mes: fixture.firstMessage, post_history_instructions: fixture.versionMarker };
const profile = fixture.profile;
const menu = { id: 'menu', role: 'assistant', content: card.first_mes };
function setupFile() {
  const state = cloneEmptyState();
  state.scene.location = 'Original cafe';
  state.scene.lifecycle.sourceMessageId = 'initial-setup';
  state.arc.response.latestChange = 'Initial curiosity.';
  state.arc.response.sourceMessageId = 'initial-setup';
  return { format: SETUP_FORMAT, version: 1, profile, initialState: state };
}
function anchor(id = 'imported') {
  return { id, role: 'assistant', content: IMPORT_LOADED_TEXT, metadata: { date_simulator_setup: setupFile() } };
}

test('portable setup validates real card profiles and rejects invalid or nonportable files', () => {
  assert.ok(validateSetupFile(setupFile()).value);
  assert.ok(validateSetupFile('\uFEFF' + JSON.stringify(setupFile())).value);
  for (const value of ['{', '[]', 'null', { ...setupFile(), version: 2 }, { ...setupFile(), history: [] },
    { ...setupFile(), profile: 'private text' }, { ...setupFile(), profile: profile.replace('MAN:', 'MAN: <system>') },
    { ...setupFile(), initialState: { ...setupFile().initialState, schemaVersion: 999 } }]) {
    assert.equal(validateSetupFile(value).value, null);
  }
  const foreign = setupFile(); foreign.initialState.scene.lifecycle.sourceMessageId = 'old-chat-message';
  assert.equal(validateSetupFile(foreign).value, null);
  const teen = setupFile(); teen.profile = teen.profile.replace('Adult Mode', 'Teen Mode');
  assert.equal(validateSetupFile(teen).value, null);
  teen.initialState.arc.response.sexualInterest = 'Not applicable in Teen Mode.';
  assert.ok(validateSetupFile(teen).value);
  assert.equal(validateSetupFile(' '.repeat(256 * 1024 + 1)).value, null);
});

test('metadata import follows reset, active swipe, and branch fingerprint boundaries', () => {
  const a = anchor();
  const messages = [menu, a];
  const context = deriveTranscriptContext(messages);
  assert.equal(context.caseText, profile);
  assert.equal(context.caseMessageId, a.id);
  assert.equal(listEligibleTurns(messages, context).length, 1);
  assert.equal(importedSetupForMessage({ ...a, role: 'user' }), null);
  const original = prefixFingerprint(messages, 1);
  const changed = structuredClone(messages); changed[1].metadata.date_simulator_setup.initialState.scene.location = 'Different cafe';
  assert.notEqual(prefixFingerprint(changed, 1), original);
  assert.equal(deriveTranscriptContext([menu, { ...a, content: 'Different swipe' }]).active, false);
  assert.equal(deriveTranscriptContext([...messages, { id: 'reset', role: 'assistant', content: '<!--DATE_SIM_RESET-->' }]).active, false);
  messages.push({ id: 'begin', role: 'user', content: '/begin' }, { id: 'opening', role: 'assistant', content: 'The original cafe surrounds you.' });
  assert.equal(listEligibleTurns(messages, deriveTranscriptContext(messages)).length, 1);
});

test('numeric import only routes at the matching startup menu and UI markers never reach the provider', () => {
  assert.ok(isImportSetupSelection([menu, { role: 'user', content: '5' }]));
  assert.ok(isImportSetupSelection([menu, { role: 'user', content: '/import' }]));
  assert.equal(isImportSetupSelection([{ role: 'assistant', content: '5. Any background' }, { role: 'user', content: '5' }]), false);
  assert.equal(isImportSetupSelection([menu, anchor(), { role: 'user', content: 'Import Saved Setup' }]), false);
  assert.doesNotMatch(stripStartupMenuMarkers([menu])[0].content, /<!--DATE_SIM_(?:STARTUP_MENU|IMPORT_SETUP)_V1-->/);
});

test('frozen opening survives reprocessing but invalidates when the opening changes', () => {
  const messages = [menu, anchor()];
  const context = deriveTranscriptContext(messages);
  const turns = listEligibleTurns(messages, context);
  const store = createStore('chat');
  store.checkpoints[turns[0].key] = { fingerprint: turns[0].fingerprint, state: assignSetupSources(setupFile().initialState, 'imported') };
  store.initialSetup = initialSetupForBranch(store, turns, context.caseText);
  store.checkpoints[turns[0].key].state.scene.location = 'Reprocessed cafe';
  assert.equal(initialSetupForBranch(store, turns, context.caseText).state.scene.location, 'Original cafe');
  const changed = structuredClone(messages); changed[1].swipe_id = 1;
  assert.equal(initialSetupForBranch(store, listEligibleTurns(changed, deriveTranscriptContext(changed)), profile), null);
  const legacy = createStore('chat');
  legacy.checkpoints[turns[0].key] = { ...store.checkpoints[turns[0].key], migrated: true };
  assert.equal(initialSetupForBranch(legacy, turns, profile), null);
});

test('picker is file based, handles cancellation, and rejects a changed chat or oversized bytes', async () => {
  const target = { chatId: 'chat', fingerprint: 'abc' };
  let options;
  const ctx = { uploads: { pickFile: async (value) => { options = value; return []; } } };
  assert.equal(await pickSetupFile(ctx, target, () => 'chat'), null);
  assert.deepEqual(options.accept, ['.json', 'application/json']);
  assert.equal(options.multiple, false);
  ctx.uploads.pickFile = async () => [{ sizeBytes: 2, bytes: new TextEncoder().encode('{}') }];
  assert.equal(await pickSetupFile(ctx, target, () => 'chat'), '{}');
  await assert.rejects(pickSetupFile(ctx, target, () => 'other'), /active chat changed/);
  ctx.uploads.pickFile = async () => [{ sizeBytes: 300000, bytes: new Uint8Array() }];
  await assert.rejects(pickSetupFile(ctx, target, () => 'chat'), /exceeds/);
});

test('backend imports, begins, reloads, forks, and exports the initial state after later play', async () => {
  const events = new Map(), files = new Map(), variables = new Map(), outputs = [];
  const chats = new Map([['chat', [structuredClone(menu)]], ['other', [structuredClone(menu)]]]);
  let handler, interceptor, counter = 0, trackerCalls = 0, beginCalls = 0;
  const granted = new Set(['generation', 'interceptor', 'chat_mutation', 'ui_panels']);
  globalThis.spindle = {
    permissions: { has: (p) => granted.has(p), onChanged: () => () => {} },
    storage: {
      getJson: async (name, options) => structuredClone(files.get(name) ?? options?.fallback),
      setJson: async (name, value) => files.set(name, structuredClone(value)),
      exists: async (name) => files.has(name),
    },
    variables: { chat: {
      get: async (id, key) => variables.get(`${id}:${key}`) ?? '',
      set: async (id, key, value) => variables.set(`${id}:${key}`, value),
    } },
    chat: {
      getMessages: async (id) => structuredClone(chats.get(id) ?? []),
      appendMessage: async (id, message, generate) => {
        const next = { ...structuredClone(message), id: `message-${++counter}`, swipe_id: 0 };
        chats.get(id).push(next);
        // Host events must not deadlock the import queue.
        events.get('MESSAGE_SENT')?.({ chatId: id, message: next }, 'user');
        if (generate) {
          beginCalls++;
          const prompt = await interceptor([{ role: 'system', content: card.post_history_instructions }, ...chats.get(id)], { chatId: id });
          assert.match(JSON.stringify(prompt), /Original cafe/);
          chats.get(id).push({ id: `message-${++counter}`, role: 'assistant', content: 'The cafe is quiet.' });
        }
        return { id: next.id };
      },
    },
    connections: { list: async () => [{ id: 'tracker', provider: 'openai', is_default: true }], get: async () => ({ id: 'tracker', provider: 'openai' }) },
    generate: { quiet: async () => {
      trackerCalls++;
      const state = trackerStateForLlm(null);
      state.scene.location = 'Later bookstore';
      return { content: JSON.stringify(state) };
    } },
    registerInterceptor: (fn) => { interceptor = fn; },
    on: (name, fn) => { events.set(name, fn); return () => {}; },
    onFrontendMessage: (fn) => { handler = fn; return () => {}; },
    sendToFrontend: (data) => outputs.push(structuredClone(data)),
    log: { info() {}, warn() {}, error() {} },
  };
  await import(`../src/backend.js?setup-integration=${Date.now()}`);
  const call = async (type, extra = {}, chatId = 'chat') => {
    const requestId = `request-${++counter}`;
    await handler({ type, chatId, requestId, ...extra }, 'user');
    return outputs.findLast((o) => o.requestId === requestId);
  };
  const fingerprint = () => prefixFingerprint(chats.get('chat'), chats.get('chat').length - 1);
  const raw = JSON.stringify(setupFile());
  assert.equal((await call('continuity_import_setup', { fileText: '{', fingerprint: fingerprint() })).ok, false);
  assert.equal(chats.get('chat').length, 1);
  assert.equal(files.has('chats/chat.json'), false);
  assert.equal((await call('continuity_import_setup', { fileText: raw, fingerprint: 'stale' })).ok, false);
  granted.delete('interceptor');
  assert.equal((await call('continuity_import_setup', { fileText: raw, fingerprint: fingerprint() })).ok, false);
  granted.add('interceptor');
  const result = await call('continuity_import_setup', { fileText: raw, fingerprint: fingerprint() });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.status.setup.canBegin, true);
  assert.equal(result.status.setup.canExport, true);
  assert.equal(trackerCalls, 0);
  await handler({ type: 'continuity_reprocess', chatId: 'chat' }, 'user');
  assert.equal(trackerCalls, 0, 'Reprocessing the imported anchor never calls the tracker');
  const importedMessages = structuredClone(chats.get('chat'));
  const importedId = importedMessages.at(-1).id;
  assert.equal(chats.get('chat').at(-1).content.includes(profile), false);
  assert.ok(trackerSourceMessageIds(files.get('chats/chat.json').current).every((id) => id === importedId));
  assert.equal((await call('continuity_import_setup', { fileText: raw, fingerprint: fingerprint() })).ok, false);
  assert.equal(chats.get('chat').length, 2);
  const originalExport = await call('continuity_export_setup');
  assert.deepEqual(JSON.parse(originalExport.fileText), setupFile());
  assert.equal((await call('continuity_begin_setup')).ok, true);
  assert.equal(beginCalls, 1);
  assert.equal((await call('continuity_begin_setup')).ok, false);
  await events.get('MESSAGE_EDITED')({ chatId: 'chat' }, 'user');
  assert.equal(trackerCalls, 0);
  chats.get('chat').push({ id: 'later-user', role: 'user', content: 'I suggest the bookstore.' }, { id: 'later-assistant', role: 'assistant', content: 'She joins you at the bookstore.' });
  await events.get('MESSAGE_SENT')({ chatId: 'chat' }, 'user');
  assert.equal(trackerCalls, 1);
  assert.equal(files.get('chats/chat.json').current.scene.location, 'Later bookstore');
  assert.equal((await call('continuity_export_setup')).fileText, originalExport.fileText);
  // Sidecar loss rebuilds the imported baseline from metadata, with no request
  // for its opening. Only the actual later interaction needs rebuilding.
  files.delete('chats/chat.json');
  await events.get('MESSAGE_EDITED')({ chatId: 'chat' }, 'user');
  assert.equal(trackerCalls, 2);
  assert.equal((await call('continuity_export_setup')).fileText, originalExport.fileText);
  const fork = importedMessages.map((m) => ({ ...m, id: `fork-${m.id}` }));
  chats.set('fork', fork);
  await events.get('CHAT_FORKED')({ sourceChatId: 'chat', forkedChatId: 'fork', forkedAtMessageId: importedId,
    messageIdMap: Object.fromEntries(importedMessages.map((m) => [m.id, `fork-${m.id}`])) }, 'user');
  await events.get('MESSAGE_EDITED')({ chatId: 'fork' }, 'user');
  assert.equal(trackerCalls, 2);
  assert.equal((await call('continuity_export_setup', {}, 'fork')).fileText, originalExport.fileText);
  assert.ok(trackerSourceMessageIds(files.get('chats/fork.json').current).every((id) => id === `fork-${importedId}`));
  chats.get('chat').push({ id: 'reset', role: 'assistant', content: '# New Case\n<!--DATE_SIM_RESET-->\n' + card.first_mes });
  await events.get('MESSAGE_EDITED')({ chatId: 'chat' }, 'user');
  assert.equal(files.get('chats/chat.json').current, null);
  assert.equal(files.get('chats/chat.json').initialSetup, null);
  assert.equal((await call('continuity_export_setup')).ok, false);
  events.get('GENERATION_STARTED')({ chatId: 'chat' });
  assert.equal((await call('continuity_import_setup', { fileText: raw, fingerprint: fingerprint() })).ok, false);
  events.get('GENERATION_STOPPED')({ chatId: 'chat' });
  assert.equal((await call('continuity_import_setup', { fileText: raw, fingerprint: fingerprint() })).ok, true);

  // Native generated cases acquire the same frozen baseline, including when
  // installed into an existing chat that still has its original checkpoint.
  chats.set('native', [menu, { id: 'native-u', role: 'user', content: 'Surprise me' },
    { id: 'native-a', role: 'assistant', content: `She glances up.\n<!--DATE_SIM_CASE\n${profile}\nEND_DATE_SIM_CASE-->` }]);
  await events.get('MESSAGE_EDITED')({ chatId: 'native' }, 'user');
  const nativeExport = await call('continuity_export_setup', {}, 'native');
  assert.equal(nativeExport.ok, true);
  const nativeStore = files.get('chats/native.json');
  const nativeInitial = structuredClone(nativeStore.initialSetup.state);
  nativeStore.initialSetup = null;
  files.set('chats/native.json', nativeStore);
  assert.equal((await call('continuity_export_setup', {}, 'native')).fileText, nativeExport.fileText);
  assert.deepEqual(files.get('chats/native.json').initialSetup.state, nativeInitial);
});
