import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveOnPath, spawn, spawnSync } from "../src/process/exec.js";

describe("process/exec", () => {
  it("spawnSync runs a PATH-resolved command", () => {
    const res = spawnSync("node", ["--version"], { encoding: "utf8" });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^v\d+/);
  });

  it("spawnSync surfaces a missing command as error, not throw", () => {
    const res = spawnSync("definitely-not-a-command-xyz", ["--version"], { encoding: "utf8" });
    assert.notEqual(res.status, 0);
  });

  it("spawn streams stdout from a PATH-resolved command", async () => {
    const proc = spawn("node", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    const code = await new Promise<number | null>((resolve) => proc.on("close", resolve));
    assert.equal(code, 0);
    assert.match(out, /^v\d+/);
  });

  it("resolveOnPath finds node and rejects nonsense", () => {
    const node = resolveOnPath("node");
    assert.ok(node && node.length > 0);
    assert.equal(resolveOnPath("definitely-not-a-command-xyz"), undefined);
  });
});
