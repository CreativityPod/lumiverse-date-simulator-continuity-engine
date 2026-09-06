import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { setup, SETUP_FILENAME, cardsInside } from "../src/frontend.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/date-simulator-v1.5.6-setup.json", import.meta.url)));
const fileText = JSON.stringify({ format: "date-simulator-initial-setup", version: 1, profile: fixture.profile, initialState: { private: "é & < >" } });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function mount(t, { secure = true, savePicker, pickFile = async () => [] } = {}) {
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
    ui: { registerDrawerTab: () => ({ root, destroy() {}, activate() {}, setBadge() {}, onActivate: () => () => {} }) },
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
  const button = text => [...root.querySelectorAll("button")].find(node => node.textContent === text);
  const result = () => {
    const request = sent.findLast(message => message.type === "continuity_export_setup");
    assert.ok(request);
    receive({ type: "continuity_setup_result", chatId: request.chatId, requestId: request.requestId, ok: true, fileText, message: "Initial setup prepared" });
  };
  return { window, root, messages, sent, status, result, button, event: (name, payload) => events.get(name)?.(payload) };
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
  assert.equal(exportButton.style.minHeight, "38px");
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
