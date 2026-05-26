import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSlash } from "../src/slash.js";

describe("parseSlash", () => {
  it("parses canonical commands", () => {
    assert.deepEqual(parseSlash("/help")?.name, "help");
    assert.deepEqual(parseSlash("/models anthropic/claude")?.args, ["anthropic/claude"]);
  });

  it("folds aliases to canonical names", () => {
    assert.equal(parseSlash("/clear")?.name, "new");
    assert.equal(parseSlash("/model list")?.name, "models");
    assert.equal(parseSlash("/ws list")?.name, "workspaces");
    assert.equal(parseSlash("/config")?.name, "config");
  });

  it("finds trailing slash line in batched text", () => {
    const hit = parseSlash("earlier text\n\n/help");
    assert.equal(hit?.name, "help");
  });

  it("returns null for non-commands", () => {
    assert.equal(parseSlash("hello"), null);
    assert.equal(parseSlash("/unknown-cmd"), null);
  });
});
