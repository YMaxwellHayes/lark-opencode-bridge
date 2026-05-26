import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SUBSCRIBED_CALLBACKS,
  DEFAULT_SUBSCRIBED_EVENTS,
} from "../src/lark/default-events.js";
import { DEFAULT_SETUP_SCOPES, formatScopesJson } from "../src/lark/scopes.js";

describe("lark defaults", () => {
  it("subscribes im receive and doc comment events", () => {
    assert.ok(DEFAULT_SUBSCRIBED_EVENTS.includes("im.message.receive_v1"));
    assert.ok(DEFAULT_SUBSCRIBED_EVENTS.includes("drive.notice.comment_add_v1"));
    assert.equal(DEFAULT_SUBSCRIBED_CALLBACKS.includes("card.action.trigger"), true);
  });

  it("exports non-empty scope manifest JSON", () => {
    assert.ok(DEFAULT_SETUP_SCOPES.scopes.tenant.length > 50);
    assert.ok(DEFAULT_SETUP_SCOPES.scopes.user.length > 50);
    const json = formatScopesJson();
    assert.match(json, /"tenant"/);
    assert.match(json, /"user"/);
  });
});
