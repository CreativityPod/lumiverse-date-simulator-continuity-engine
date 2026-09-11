import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { setup, SETUP_FILENAME, cardsInside } from "../src/frontend.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/date-simulator-v1.5.6-setup.json", import.meta.url)));
const fileText = JSON.stringify({ format: "date-simulator-initial-setup", version: 1, profile: fixture.profile, initialState: { private: "é & < >" } });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function mount(t, { secure = true, savePicker, pickFile = async () => [], hostChat = true, getActiveChatThrows = false } = {}) {
  const dom = new JSDOM("<!doctype html><body><main></main></body>", { url: secure ? "https://sim.example" : "http://sim.example" });
  const { window } = dom;
  const previous = {};
  for (const key of ["window", "document", "MutationObserver", "Element"]) {
    previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: window[key] ?? window });
  }
  window.isSecureContext = secure;
  window.showSaveFilePicker = savePicker;
  const messages = new Map();
  const sent = [];
  const events = new Map();
  let hostChatId = "chat-1";
  let drawerRegistrations = 0;
  let floatWidgetOptions = null;
  let receive;
  const root = window.document.querySelector("main");
  const ctx = {
    deferReady() {}, ready() {},
    dom: {
      addStyle(css) { const style = window.document.createElement("style"); style.textContent = css; window.document.head.append(style); return () => style.remove(); },
      findMessageElement: id => messages.get(id),
      listMessageElements: () => [...messages.values()],
      cleanup() {},
    },
    ui: {
      registerDrawerTab: () => {
        drawerRegistrations++;
        return { root, destroy() {}, activate() {}, setBadge() {}, onActivate: () => () => {} };
      },
      createFloatWidget(options) {
        floatWidgetOptions = options;
        const widget = window.document.createElement("aside");
        widget.className = "test-float-widget";
        window.document.body.append(widget);
        return {
          root: widget,
          setVisible: visible => { widget.hidden = !visible; },
          destroy: () => widget.remove(),
        };
      },
    },
    ...(hostChat ? { getActiveChat: () => {
      if (getActiveChatThrows) throw new Error("Host state unavailable during startup");
      return { chatId: hostChatId };
    } } : {}),
    uploads: { pickFile },
    events: { on(name, callback) { events.set(name, callback); return () => events.delete(name); } },
    onBackendMessage(callback) { receive = callback; return () => { receive = null; }; },
    sendToBackend: message => sent.push(message),
  };
  const dispose = setup(ctx);
  t.after(async () => {
    // Drain queued observer work before teardown, then release all app timers.
    await tick();
    dispose();
    dom.window.close();
    for (const key of Object.keys(previous)) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
      else delete globalThis[key];
    }
  });
  const status = (extra = {}) => receive({ type: "continuity_status", chatId: "chat-1", caseMessageId: "case-1", profileSaved: true, code: "ready", level: "green", text: "Ready", config: { showStatusWidget: false }, setup: { canExport: true, canImport: true, fingerprint: "prefix-1" }, ...extra });
  const button = text => [...root.querySelectorAll("button, a.dsc-button")].find(node => node.textContent === text);
  const result = () => {
    const request = sent.findLast(message => message.type === "continuity_export_setup");
    assert.ok(request);
    receive({ type: "continuity_setup_result", chatId: request.chatId, requestId: request.requestId, ok: true, fileText, message: "Initial setup prepared" });
  };
  return {
    window, root, messages, sent, status, result, button,
    drawerRegistrations: () => drawerRegistrations,
    floatWidgetOptions: () => floatWidgetOptions,
    widgetVisible: () => [...window.document.querySelectorAll(".test-float-widget")].some(widget => !widget.hidden),
    event(name, payload) {
      if (name === "CHAT_SWITCHED") hostChatId = payload?.chatId ?? null;
      return events.get(name)?.(payload);
    },
  };
}

test("full frontend paints saved profile status in a message root's own Shadow DOM", async t => {
  const h = mount(t);
  const host = h.window.document.createElement("div");
  h.window.document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = fixture.profileCardHtml;
  h.messages.set("case-1", host);
  h.status();
  await tick();
  const card = shadow.querySelector(".ds-state-card");
  assert.deepEqual(cardsInside(host), [card]);
  assert.equal(card.dataset.engineState, "saved");
  assert.equal(card.querySelector(".ds-engine-missing").style.display, "none");
  assert.equal(card.querySelector(".ds-state-label").textContent, "Private profile saved");
  assert.equal(card.querySelector(".ds-state-button").hidden, true);
});

test("saved status survives delayed shadow attachment and later profile replacement", async t => {
  const h = mount(t);
  const host = h.window.document.createElement("div");
  h.window.document.body.append(host);
  h.messages.set("case-1", host);
  h.status();
  await tick();
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = fixture.profileCardHtml;
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(shadow.querySelector(".ds-state-card").dataset.engineState, "saved");
  shadow.innerHTML = fixture.profileCardHtml;
  await tick();
  assert.equal(shadow.querySelector(".ds-state-card").dataset.engineState, "saved");
  assert.equal(shadow.querySelector(".ds-engine-missing").style.display, "none");
});

test("background message events cannot divert the active chat's export or badge", async t => {
  const h = mount(t);
  h.status();
  h.event("MESSAGE_SENT", { chatId: "background-chat" });
  h.status();
  h.button("Export Initial Setup").click();
  assert.equal(h.sent.findLast(message => message.type === "continuity_export_setup").chatId, "chat-1");
});

test("Save As opens in the original click before the backend responds, and writes exact JSON", async t => {
  const writes = [];
  let pickerCalls = 0;
  let closed = false;
  const h = mount(t, { savePicker: options => {
    pickerCalls++;
    assert.equal(h.sent.some(message => message.type === "continuity_export_setup"), false);
    assert.equal(options.suggestedName, SETUP_FILENAME);
    return Promise.resolve({ createWritable: async () => ({ write: async text => writes.push(text), close: async () => { closed = true; } }) });
  } });
  h.status();
  h.button("Export Initial Setup").click();
  assert.equal(pickerCalls, 1);
  assert.deepEqual(writes, []);
  h.result();
  await tick();
  assert.deepEqual(writes, [fileText]);
  assert.equal(closed, true);
  assert.match(h.root.textContent, /saved to the selected JSON file/);
});

test("remote HTTP export uses an explicit download click with exact JSON and filename", async t => {
  const downloads = [];
  const h = mount(t, { secure: false, savePicker: () => { throw new Error("HTTP must not open native picker"); } });
  h.window.HTMLAnchorElement.prototype.click = function () {
    downloads.push({ href: this.href, filename: this.download, connected: this.isConnected });
  };
  h.status();
  const exportButton = h.button("Export Initial Setup");
  assert.equal(exportButton.tagName, "BUTTON");
  assert.equal(h.window.getComputedStyle(exportButton).fontWeight, "500");
  exportButton.click();
  h.result();
  await tick();
  assert.equal(downloads.length, 0);
  const downloadButton = h.button("Download JSON File");
  assert.equal(downloadButton.tagName, "BUTTON");
  assert.equal(downloadButton.hidden, false);
  downloadButton.click();
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].filename, SETUP_FILENAME);
  assert.equal(downloads[0].connected, true);
  assert.equal(decodeURIComponent(downloads[0].href.split(",").slice(1).join(",")), fileText);
  assert.equal(h.window.document.querySelectorAll("a[download]").length, 0);
});

test("canceling Save As never claims success or triggers a download", async t => {
  const h = mount(t, { savePicker: () => Promise.reject(Object.assign(new Error("Canceled"), { name: "AbortError" })) });
  h.window.HTMLAnchorElement.prototype.click = () => assert.fail("Canceled export must not download");
  h.status();
  h.button("Export Initial Setup").click();
  h.result();
  await tick();
  assert.match(h.root.textContent, /Save canceled. No file was written/);
  assert.equal(h.button("Download JSON File").hidden, true);
});

test("write failure offers a real download button without claiming a saved file", async t => {
  let aborted = false;
  const h = mount(t, { savePicker: async () => ({ createWritable: async () => ({ write: async () => { throw new Error("Disk full"); }, abort: async () => { aborted = true; } }) }) });
  h.status(); h.button("Export Initial Setup").click(); h.result();
  await tick();
  assert.equal(aborted, true);
  assert.match(h.root.textContent, /Could not save the file: Disk full/);
  assert.doesNotMatch(h.root.textContent, /saved to the selected JSON file/);
  assert.equal(h.button("Download JSON File").hidden, false);
});

test("chat switch while Save As is pending prevents the old chat from writing", async t => {
  let select;
  let writes = 0;
  const h = mount(t, { savePicker: () => new Promise(resolve => { select = resolve; }) });
  h.status(); h.button("Export Initial Setup").click(); h.result();
  h.event("CHAT_SWITCHED", { chatId: "chat-2" });
  select({ createWritable: async () => { writes++; throw new Error("must not write"); } });
  await tick();
  assert.equal(writes, 0);
  assert.equal(h.button("Download JSON File").hidden, true);
});

test("the release greeting has a visible outlined button that opens the import picker from Shadow DOM", async t => {
  let calls = 0;
  const h = mount(t, { pickFile: () => { calls++; return Promise.resolve([]); } });
  h.status();
  const host = h.window.document.createElement("div");
  h.window.document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = fixture.importButtonHtml;
  const button = shadow.querySelector("button");
  assert.equal(button.style.borderWidth, "2px");
  assert.equal(button.style.minHeight, "40px");
  button.click();
  assert.equal(calls, 1);
  await tick();
  assert.match(h.root.textContent, /File selection canceled/);
});

test("native export can save repeatedly in one chat and after switching chats", async t => {
  const writes = [];
  let calls = 0;
  const h = mount(t, { savePicker: async () => {
    calls++;
    return { createWritable: async () => ({ write: async text => writes.push(text), close: async () => {} }) };
  } });
  h.status();
  for (let i = 0; i < 3; i++) {
    if (i === 2) { h.event("CHAT_SWITCHED", { chatId: "chat-2" }); h.status({ chatId: "chat-2" }); }
    assert.equal(h.button("Export Initial Setup").disabled, false);
    h.button("Export Initial Setup").click(); h.result(); await tick();
  }
  assert.equal(calls, 3);
  assert.deepEqual(writes, [fileText, fileText, fileText]);
});

test("fallback export and download can repeat in the same chat and a new chat", async t => {
  const h = mount(t, { secure: false });
  let downloads = 0;
  h.window.HTMLAnchorElement.prototype.click = function () {
    assert.equal(this.download, SETUP_FILENAME);
    assert.equal(this.isConnected, true);
    assert.equal(decodeURIComponent(this.href.split(",").slice(1).join(",")), fileText);
    downloads++;
  };
  h.status();
  for (let i = 0; i < 3; i++) {
    if (i === 2) { h.event("CHAT_SWITCHED", { chatId: "chat-2" }); h.status({ chatId: "chat-2" }); }
    assert.equal(h.button("Export Initial Setup").disabled, false);
    h.button("Export Initial Setup").click(); h.result(); await tick();
    h.button("Download JSON File").click();
    h.button("Download JSON File").click();
  }
  assert.equal(downloads, 6);
  assert.equal(h.window.document.querySelectorAll("a[download]").length, 0);
});

test("a rendered background chat cannot select that chat or invalidate an active save", async t => {
  let select;
  const writes = [];
  const h = mount(t, { savePicker: () => new Promise(resolve => { select = resolve; }) });
  h.status(); h.button("Export Initial Setup").click(); h.result();
  h.event("CHARACTER_MESSAGE_RENDERED", { chatId: "chat-2" });
  h.status({ chatId: "chat-2" });
  select({ createWritable: async () => ({ write: async value => writes.push(value), close: async () => {} }) });
  await tick();
  assert.deepEqual(writes, [fileText]);
  h.button("Export Initial Setup").click();
  assert.equal(h.sent.findLast(message => message.type === "continuity_export_setup").chatId, "chat-1");
});

test("Home hides the widget and rejects late render events and statuses until a chat is selected", t => {
  const h = mount(t);
  const widgetStatus = { config: { showStatusWidget: true } };
  h.status(widgetStatus);
  assert.equal(h.widgetVisible(), true);

  h.event("CHAT_SWITCHED", { chatId: null });
  assert.equal(h.widgetVisible(), false);
  assert.equal(h.sent.findLast(message => message.type === "continuity_get_status").chatId, null);

  const sentAtHome = h.sent.length;
  h.event("CHARACTER_MESSAGE_RENDERED", { chatId: "chat-1" });
  h.event("MESSAGE_SENT", { chatId: "chat-1" });
  h.event("GENERATION_STARTED", { chatId: "chat-1" });
  h.status(widgetStatus);
  assert.equal(h.sent.length, sentAtHome);
  assert.equal(h.widgetVisible(), false);
  assert.equal(h.button("Export Initial Setup").disabled, true);
  assert.match(h.root.textContent, /No active chat/);

  h.status({ ...widgetStatus, chatId: null, caseMessageId: null, profileSaved: false, setup: {} });
  assert.equal(h.widgetVisible(), false);
  h.event("CHAT_SWITCHED", { chatId: "chat-2" });
  h.status({ ...widgetStatus, chatId: "chat-2" });
  h.status(widgetStatus);
  assert.equal(h.widgetVisible(), true);
  h.button("Export Initial Setup").click();
  assert.equal(h.sent.findLast(message => message.type === "continuity_export_setup").chatId, "chat-2");
});

test("drawer registration survives unavailable host state during startup", t => {
  const throwing = mount(t, { getActiveChatThrows: true });
  assert.equal(throwing.drawerRegistrations(), 1);
  assert.equal(Object.hasOwn(throwing.sent.find(message => message.type === "continuity_get_status"), "chatId"), false);
});

test("legacy bootstrap keeps the drawer and accepts the backend-selected chat", t => {
  const legacy = mount(t, { hostChat: false });
  assert.equal(legacy.drawerRegistrations(), 1);
  assert.equal(Object.hasOwn(legacy.sent.find(message => message.type === "continuity_get_status"), "chatId"), false);
  legacy.status({ config: { showStatusWidget: true } });
  assert.equal(legacy.widgetVisible(), true);
});

test("floating widget persists its geometry and uses the profile warning color while updating", t => {
  const h = mount(t);
  h.status({
    profileSaved: false,
    code: "profile_saving",
    level: "amber",
    text: "Continuity Engine detected. Saving the private profile outside chat context…",
    config: { showStatusWidget: true },
  });

  assert.equal(h.floatWidgetOptions().persistGeometry, "continuity-status");
  assert.equal(h.window.document.querySelector(".dsc-floating-status").dataset.state, "updating");
  const styles = [...h.window.document.querySelectorAll("style")].map(style => style.textContent).join("\n");
  assert.match(
    styles,
    /\.dsc-floating-status\[data-state="updating"\] \{ color: var\(--lumiverse-warning, #c89b62\); \}/,
  );
});

test("disabled drawer buttons use Lumiverse opacity and cursor with no inline overrides", t => {
  const h = mount(t);
  const button = h.button("Export Initial Setup");
  assert.equal(button.disabled, true);
  const style = h.window.getComputedStyle(button);
  assert.equal(style.opacity, "0.4");
  assert.equal(style.cursor, "not-allowed");
  assert.equal(style.fontWeight, "500");
  assert.equal(button.getAttribute("style"), null);
});
