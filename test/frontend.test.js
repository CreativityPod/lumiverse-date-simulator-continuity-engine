import assert from "node:assert/strict";
import test from "node:test";

import {
  cardsInside,
  formatLocalTimestamp,
  privateStatePresentation,
  profileCardPresentation,
} from "../src/frontend.js";

test("formats tracker timestamps in the requested local time zone", () => {
  assert.equal(
    formatLocalTimestamp("2026-08-15T14:30:00.000Z", "en-US", { timeZone: "America/New_York" }),
    "Aug 15, 2026, 10:30 AM",
  );
  assert.equal(formatLocalTimestamp("not-a-timestamp", "en-US"), "not-a-timestamp");
});

test("private-state display keeps requested data across stale public-only status responses", () => {
  const visible = privateStatePresentation(true, {
    chatId: "chat-1",
    state: { scene: { location: "Cafe" } },
  });
  assert.match(visible.text, /"location": "Cafe"/);

  const afterStaleResponse = privateStatePresentation(true, { chatId: "chat-1" }, visible.cache);
  assert.equal(afterStaleResponse.text, visible.text);
  assert.equal(privateStatePresentation(false, { chatId: "chat-1" }, visible.cache).cache, null);
});

test("private-state display does not leak cached data across chats", () => {
  const cached = { chatId: "chat-1", state: { private: true } };
  assert.deepEqual(
    privateStatePresentation(true, { chatId: "chat-2" }, cached),
    { text: "Loading private state…", cache: null },
  );
});

test("finds a profile card inside an open Shadow DOM island without realm checks", () => {
  const card = {
    nodeType: 1,
    matches: (selector) => selector.includes("ds-state-card"),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const shadowRoot = {
    querySelectorAll: (selector) => {
      if (selector === ".ds-state-card[data-ds-profile-card='true']") return [card];
      if (selector === "*") return [card];
      return [];
    },
  };
  const host = {
    nodeType: 1,
    shadowRoot,
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const documentRoot = {
    querySelectorAll: (selector) => selector === "*" ? [host] : [],
  };

  assert.deepEqual(cardsInside(documentRoot), [card]);
});

test("saved profiles hide the manual fallback even while tracker status is degraded", () => {
  const presentation = profileCardPresentation({
    profileSaved: true,
    code: "error",
    level: "amber",
    text: "Continuity Engine kept the last valid state.",
  });

  assert.equal(presentation.state, "saved");
  assert.equal(presentation.label, "Private profile saved");
  assert.equal(presentation.manual, false);
  assert.equal(presentation.level, "amber");
});

test("profile persistence in progress does not expose the manual fallback", () => {
  const presentation = profileCardPresentation({
    profileSaved: false,
    code: "profile_saving",
    level: "amber",
    text: "Saving outside chat context…",
  });

  assert.equal(presentation.state, "saving");
  assert.equal(presentation.label, "Saving private profile…");
  assert.equal(presentation.manual, false);
});

test("disabled and permission states expose the manual fallback", () => {
  for (const code of ["disabled", "permissions"]) {
    const presentation = profileCardPresentation({
      profileSaved: false,
      code,
      level: "amber",
      text: "Continuity Engine is unavailable.",
    });
    assert.equal(presentation.state, "fallback");
    assert.equal(presentation.manual, true);
  }
});

test("an invalid profile cannot be made valid by the manual action", () => {
  const presentation = profileCardPresentation({
    profileSaved: false,
    code: "invalid_profile",
    level: "amber",
    text: "The private profile is malformed.",
  });

  assert.equal(presentation.state, "invalid");
  assert.equal(presentation.manual, false);
});
