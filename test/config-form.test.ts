import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyConfigForm } from "../src/config-form.js";
import { baseConfig } from "./helpers.js";

describe("applyConfigForm", () => {
  it("applies valid preferences", () => {
    const cfg = baseConfig();
    const result = applyConfigForm(
      cfg,
      {
        reply_style: "card",
        idle_timeout_minutes: "15",
        message_batch_ms: "800",
        handle_doc_comments: "no",
        require_mention_in_group: "no",
        allowed_users: "ou_me",
        admins: "ou_me",
      },
      "ou_me",
      "oc_group",
      "group",
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.cfg.replyStyle, "card");
    assert.equal(result.cfg.idleTimeoutMinutes, 15);
    assert.equal(result.cfg.messageBatchMs, 800);
    assert.equal(result.cfg.handleDocComments, false);
    assert.equal(result.cfg.requireGroupMention, false);
  });

  it("rejects admin list that excludes the operator", () => {
    const result = applyConfigForm(
      baseConfig(),
      { admins: "ou_other" },
      "ou_me",
    );
    assert.equal(result.ok, false);
  });

  it("rejects group allowlist that excludes current group", () => {
    const result = applyConfigForm(
      baseConfig(),
      { allowed_chats: "oc_other" },
      "ou_me",
      "oc_current",
      "group",
    );
    assert.equal(result.ok, false);
  });
});
