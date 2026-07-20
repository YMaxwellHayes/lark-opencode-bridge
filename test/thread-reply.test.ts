import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isThreadUnsupportedError, shouldReplyInThread } from "../src/lark/thread-reply.js";

describe("shouldReplyInThread", () => {
  it("is true for group messages (topic desks treat send as new topic)", () => {
    assert.equal(shouldReplyInThread({ chat_type: "group" }), true);
  });

  it("is true for group replies even without thread_id", () => {
    assert.equal(
      shouldReplyInThread({
        chat_type: "group",
        reply_to_message_id: "om_parent",
      }),
      true,
    );
  });

  it("is true for p2p when thread_id or reply_to is present", () => {
    assert.equal(
      shouldReplyInThread({ chat_type: "p2p", thread_id: "omt_x" }),
      true,
    );
    assert.equal(
      shouldReplyInThread({ chat_type: "p2p", reply_to_message_id: "om_x" }),
      true,
    );
  });

  it("is false for bare p2p messages", () => {
    assert.equal(shouldReplyInThread({ chat_type: "p2p" }), false);
  });
});

describe("isThreadUnsupportedError", () => {
  it("detects Lark 230071", () => {
    assert.equal(isThreadUnsupportedError("lark-cli failed: code=230071"), true);
    assert.equal(isThreadUnsupportedError("other error"), false);
  });
});
