import { resolveLarkCli, spawnSync } from "../process/exec.js";
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
  return { ok: true, version: parseLarkCliVersion(output), output: output.split(/\r?\n/)[0] ?? output };
}

function resolveLarkCliBin(explicit?: string): string {
  // refresh: this runs right after a possible fresh npm install of lark-cli.
  return resolveLarkCli(explicit, { refresh: true });
}

function fetchLatestLarkCliVersion(): string | undefined {
  // Best-effort upgrade check — a slow/blocked registry must not hang the wizard.
  const res = spawnSync("npm", ["view", "@larksuite/cli", "version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20_000,
  });
  if (res.status !== 0) return undefined;
  return res.stdout.trim() || undefined;
}

function installLatestLarkCli(silent: boolean): { ok: boolean; output: string } {
  if (!silent) {
    process.stdout.write("正在安装最新版飞书 CLI（@larksuite/cli），下载进度如下（取决于网络可能需要几分钟）…\n");
  }
  log.info("running npm install -g @larksuite/cli@latest");
  // Interactive runs stream npm's own output so the wizard never looks frozen;
  // silent (preflight) runs capture it for the error message instead.
  const res = spawnSync("npm", ["install", "-g", "@larksuite/cli@latest"], {
    encoding: "utf8",
    stdio: silent ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    timeout: 15 * 60_000,
  });
  const timedOut = res.error && "code" in res.error && (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  const output =
    `${res.stdout || ""}${res.stderr || ""}`.trim() ||
    (timedOut ? "npm install 超时（15 分钟）— 请检查网络或 npm registry 配置" : res.error?.message) ||
    (res.status !== 0 ? `npm 退出码 ${res.status}（详见上方 npm 输出）` : "");
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

  // A fresh install IS @latest — don't hit the registry again to "check for upgrades".
  if (opts.upgradeToLatest && !installed && probe.version) {
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
