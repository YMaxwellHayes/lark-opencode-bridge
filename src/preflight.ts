import { spawnSync } from "./process/exec.js";
import { createLogger } from "./log.js";
import { hasLarkAppConfigured } from "./lark/credentials.js";
import { ensureLarkCli } from "./lark/lark-cli-install.js";

const log = createLogger("preflight");

export interface PreflightResult {
  ok: boolean;
  issues: string[];
}

export interface PreflightOptions {
  larkCliPath?: string;
  opencodePath?: string;
  /** When true, install `@larksuite/cli@latest` if `lark-cli` is missing. */
  installLarkCli?: boolean;
}

/**
 * Verify external dependencies before starting the bridge. Returns a list of
 * human-readable issues; empty list means all checks passed.
 */
export async function runPreflight(opts: PreflightOptions = {}): Promise<PreflightResult> {
  const opencodeBin = opts.opencodePath ?? "opencode";
  const issues: string[] = [];

  const lark = await ensureLarkCli({
    larkCliPath: opts.larkCliPath,
    installIfMissing: opts.installLarkCli ?? false,
    upgradeToLatest: false,
    silent: true,
  });
  if (!lark.ok) {
    issues.push(lark.error ?? "lark-cli not available");
  } else if (!(await hasLarkAppConfigured())) {
    issues.push(`飞书应用未配置 — 运行 lark-opencode-bridge run 进入扫码向导`);
  }

  if (!checkBinary(opencodeBin, ["--version"]).ok) {
    issues.push(`opencode not found on PATH — install from https://opencode.ai`);
  }

  if (issues.length) {
    for (const i of issues) log.warn(i);
  }
  return { ok: issues.length === 0, issues };
}

function checkBinary(bin: string, args: string[]): { ok: boolean; output: string } {
  try {
    const res = spawnSync(bin, args, { encoding: "utf8" });
    if (res.error) return { ok: false, output: res.error.message };
    const output = (res.stdout || res.stderr || "").trim().split("\n")[0] ?? "";
    return { ok: res.status === 0, output };
  } catch (err) {
    return { ok: false, output: (err as Error).message };
  }
}
