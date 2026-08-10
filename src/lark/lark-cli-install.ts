import { resolveOnPath, spawnSync } from "../process/exec.js";
import { createLogger } from "../log.js";

const log = createLogger("lark-cli.install");

export interface EnsureLarkCliOptions {
  larkCliPath?: string;
  /** When true, run `npm install -g @larksuite/cli@latest` if `lark-cli` is missing. */
  installIfMissing?: boolean;
  /** When true, upgrade to the latest @larksuite/cli if an older version is detected. */
  upgradeToLatest?: boolean;
  /** Suppress progress lines (preflight uses this). */
  silent?: boolean;
}

export interface EnsureLarkCliResult {
  ok: boolean;
  larkCliPath: string;
  version?: string;
  installed: boolean;
  upgraded: boolean;
  error?: string;
}

/** Parse `lark-cli version 1.0.40` → `1.0.40`. */
export function parseLarkCliVersion(output: string): string | undefined {
  const match = output.match(/(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/);
  return match?.[1];
}

function probeLarkCli(bin: string): { ok: boolean; version?: string; output: string } {
  const res = spawnSync(bin, ["--version"], { encoding: "utf8" });
  const output = `${res.stdout || ""}${res.stderr || ""}`.trim();
  if (res.error) return { ok: false, output: res.error.message };
  if (res.status !== 0) return { ok: false, output: output || `exit ${res.status}` };
  return { ok: true, version: parseLarkCliVersion(output), output: output.split("\n")[0] ?? output };
}

function resolveLarkCliBin(explicit?: string): string {
  if (explicit) return explicit;
  return resolveOnPath("lark-cli") ?? "lark-cli";
}

function fetchLatestLarkCliVersion(): string | undefined {
  const res = spawnSync("npm", ["view", "@larksuite/cli", "version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.status !== 0) return undefined;
  return res.stdout.trim() || undefined;
}

function installLatestLarkCli(silent: boolean): { ok: boolean; output: string } {
  if (!silent) process.stdout.write("正在安装最新版飞书 CLI（@larksuite/cli）…\n");
  log.info("running npm install -g @larksuite/cli@latest");
  const res = spawnSync("npm", ["install", "-g", "@larksuite/cli@latest"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output =
    `${res.stdout || ""}${res.stderr || ""}`.trim() || res.error?.message || "";
  return { ok: res.status === 0, output };
}

function versionNeedsUpgrade(current: string, latest: string): boolean {
  const cur = current.split("-")[0]!.split(".").map(Number);
  const lat = latest.split("-")[0]!.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const c = cur[i] ?? 0;
    const l = lat[i] ?? 0;
    if (c < l) return true;
    if (c > l) return false;
  }
  return false;
}

/**
 * Ensure `lark-cli` is on PATH. Used before QR app onboarding and during preflight.
 * Installs via the official npm package `@larksuite/cli` (not the unrelated `lark-cli` package).
 */
export async function ensureLarkCli(opts: EnsureLarkCliOptions = {}): Promise<EnsureLarkCliResult> {
  const silent = opts.silent ?? false;
  let bin = resolveLarkCliBin(opts.larkCliPath);
  let installed = false;
  let upgraded = false;

  if (!silent) process.stdout.write("正在检查飞书 CLI (lark-cli)…\n");

  let probe = probeLarkCli(bin);

  if (!probe.ok && opts.installIfMissing) {
    const install = installLatestLarkCli(silent);
    installed = install.ok;
    if (!install.ok) {
      return {
        ok: false,
        larkCliPath: bin,
        installed: false,
        upgraded: false,
        error: `安装 @larksuite/cli 失败：${install.output || "unknown error"}`,
      };
    }
    bin = resolveLarkCliBin(opts.larkCliPath);
    probe = probeLarkCli(bin);
  }

  if (!probe.ok) {
    return {
      ok: false,
      larkCliPath: bin,
      installed,
      upgraded,
      error:
        `未找到 lark-cli（${probe.output}）。请手动安装：npm install -g @larksuite/cli@latest`,
    };
  }

  if (opts.upgradeToLatest && probe.version) {
    const latest = fetchLatestLarkCliVersion();
    if (latest && versionNeedsUpgrade(probe.version, latest)) {
      if (!silent) {
        process.stdout.write(
          `检测到 lark-cli ${probe.version}，正在升级到 ${latest}…\n`,
        );
      }
      const install = installLatestLarkCli(silent);
      upgraded = install.ok;
      if (!install.ok) {
        log.warn(`lark-cli upgrade failed: ${install.output}`);
        if (!silent) {
          process.stdout.write(
            `升级失败，将继续使用当前版本 ${probe.version}。\n`,
          );
        }
      } else {
        bin = resolveLarkCliBin(opts.larkCliPath);
        probe = probeLarkCli(bin);
      }
    }
  }

  if (!silent) {
    if (probe.version) {
      process.stdout.write(`✓ lark-cli ${probe.version} 已就绪\n\n`);
    } else {
      process.stdout.write(`✓ lark-cli 已就绪\n\n`);
    }
  }

  return {
    ok: true,
    larkCliPath: bin,
    version: probe.version,
    installed,
    upgraded,
  };
}
