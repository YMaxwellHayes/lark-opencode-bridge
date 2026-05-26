import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAdmin,
  isChatAllowed,
  isUserAllowed,
  parseIdList,
} from "../src/config-access.js";
import { baseConfig } from "./lib/helpers.js";

describe("config-access", () => {
  it("parseIdList splits comma-separated ids", () => {
    assert.deepEqual(parseIdList(" ou_a , ou_b ,,"), ["ou_a", "ou_b"]);
    assert.deepEqual(parseIdList(""), []);
  });

  it("isUserAllowed respects sender allowlist", () => {
    const cfg = baseConfig({ allowedSenderOpenIds: ["ou_a"] });
    assert.equal(isUserAllowed(cfg, "ou_a"), true);
    assert.equal(isUserAllowed(cfg, "ou_b"), false);
    assert.equal(isUserAllowed(baseConfig(), "ou_any"), true);
  });

  it("isChatAllowed skips allowlist for p2p", () => {
    const cfg = baseConfig({ allowedChatIds: ["oc_group"] });
    assert.equal(isChatAllowed(cfg, "oc_other", "p2p"), true);
    assert.equal(isChatAllowed(cfg, "oc_group", "group"), true);
    assert.equal(isChatAllowed(cfg, "oc_other", "group"), false);
  });

  it("isAdmin gates when adminOpenIds is set", () => {
    const cfg = baseConfig({ adminOpenIds: ["ou_admin"] });
    assert.equal(isAdmin(cfg, "ou_admin"), true);
    assert.equal(isAdmin(cfg, "ou_other"), false);
    assert.equal(isAdmin(baseConfig(), "ou_any"), true);
  });
});
