import fs from "node:fs/promises";
import { readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveOnPath, spawnSync } from "../process/exec.js";
import { fileURLToPath } from "node:url";
import { createLogger } from "../log.js";
import { HOME_DIR, LOG_DIR, ensureHome } from "../paths.js";

const log = createLogger("service");

const LABEL = "com.lark-opencode-bridge";
const IS_WIN = process.platform === "win32";

export interface ServiceBinaries {
  larkCli?: string;
  opencode?: string;
}

/** Resolve absolute paths while installing the daemon (launchd has a minimal PATH). */
export function resolveServiceBinaries(): ServiceBinaries {
  return {
    larkCli: resolveOnPath("lark-cli"),
    opencode: resolveOnPath("opencode"),
  };
}

/**
 * PATH for launchd/systemd — include common npm / Homebrew locations that are
 * often missing when the daemon starts outside the user's shell profile.
 */
function servicePathEnv(): string {
  const home = os.homedir();
  const parts = new Set<string>();
  const add = (p?: string) => {
    if (p) parts.add(p);
  };

  add(process.env.PATH);
  add("/opt/homebrew/bin");
  add("/usr/local/bin");
  add("/usr/bin");
  add("/bin");

  const npmPrefix = spawnSync("npm", ["prefix", "-g"], { encoding: "utf8" });
  if (npmPrefix.status === 0) {
    add(path.join(npmPrefix.stdout.trim(), "bin"));
  }

  add(path.join(home, ".npm-global", "bin"));
  add(path.join(home, ".local", "bin"));

  const nvmCurrent = path.join(home, ".nvm", "versions", "node");
  try {
    for (const v of readdirSync(nvmCurrent)) {
      add(path.join(nvmCurrent, v, "bin"));
    }
  } catch {
    // nvm not installed
  }

  return [...parts].filter(Boolean).join(":");
}

function runProgramArgs(binaries: ServiceBinaries): string[] {
  const bin = bridgeBin();
  const node = nodeBin();
  const args = [node, bin, "run"];
  if (binaries.larkCli) args.push("--lark-cli", binaries.larkCli);
  if (binaries.opencode) args.push("--opencode", binaries.opencode);
  return args;
}

export interface ServiceStatus {
  installed: boolean;
  running: boolean;
  platform: NodeJS.Platform;
  detail: string;
}

function bridgeBin(): string {
  // Resolve the installed CLI entry relative to this package.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../bin/lark-opencode-bridge.mjs");
}

function nodeBin(): string {
  return process.execPath;
}

function launchAgentPlist(binaries: ServiceBinaries): string {
  const home = HOME_DIR;
  const programArgs = runProgramArgs(binaries);
  const argXml = programArgs.map((a) => `    <string>${escapeXml(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <!-- KeepAlive as a dict: only restart on crash (non-zero exit), NOT on
       clean exit. Without this, launchctl stop would respawn within seconds
       because launchd treats every exit as needing a restart. -->
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${home}/logs/service.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${home}/logs/service.stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(servicePathEnv())}</string>
  </dict>
</dict>
</plist>
`;
}

function systemdUnit(binaries: ServiceBinaries): string {
  const programArgs = runProgramArgs(binaries);
  const execStart = programArgs.map(shellQuote).join(" ");
  return `[Unit]
Description=Lark OpenCode Bridge
After=network.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=always
RestartSec=5
Environment=PATH=${servicePathEnv()}

[Install]
WantedBy=default.target
`;
}

/**
 * Windows Task Scheduler definition. Mirrors launchd KeepAlive / systemd
 * Restart=always semantics:
 *  - LogonTrigger → starts on user logon (per-user, like a LaunchAgent / --user unit)
 *  - RestartOnFailure → relaunch on crash (non-zero exit), not on clean exit
 *  - ExecutionTimeLimit PT0S → never time-limited (it's a long-running daemon)
 * The action runs cmd.exe so we can redirect stdout/stderr to the same log
 * files the other platforms use. The scheduled task inherits the interactive
 * user's full environment (PATH etc.), so no explicit PATH wiring is needed.
 */
export function windowsTaskXml(binaries: ServiceBinaries): string {
  const programArgs = runProgramArgs(binaries);
  const outLog = path.join(LOG_DIR, "service.stdout.log");
  const errLog = path.join(LOG_DIR, "service.stderr.log");
  const inner =
    programArgs.map((a) => `"${a}"`).join(" ") +
    ` 1>> "${outLog}" 2>> "${errLog}"`;
  // cmd /c "<full command line>" — the outer wrapping quotes are stripped by cmd.
  const cmdArgs = `/c "${inner}"`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Lark OpenCode Bridge</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>cmd.exe</Command>
      <Arguments>${escapeXml(cmdArgs)}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

function windowsTaskXmlPath(): string {
  return path.join(HOME_DIR, "service-task.xml");
}

/** schtasks needs a UTF-16LE file with BOM for /Create /XML. */
async function writeWindowsTaskXml(binaries: ServiceBinaries): Promise<string> {
  const xml = windowsTaskXml(binaries);
  const file = windowsTaskXmlPath();
  await fs.writeFile(file, Buffer.from("﻿" + xml, "utf16le"));
  return file;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function launchAgentPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

function systemdUnitPath(): string {
  return path.join(os.homedir(), ".config", "systemd", "user", `${LABEL}.service`);
}

function assertServicePlatform(): void {
  const ok = process.platform === "darwin" || process.platform === "linux" || IS_WIN;
  if (!ok) {
    throw new Error(
      `后台服务暂不支持 ${process.platform} — 请在前台运行: lark-opencode-bridge run`,
    );
  }
}

export async function ensureServiceInstalled(): Promise<void> {
  assertServicePlatform();
  const st = await getServiceStatus();
  if (!st.installed) await installService();
}

/** Install launchd/systemd unit if missing, then start the daemon. */
export async function ensureServiceStarted(): Promise<void> {
  assertServicePlatform();
  // Always refresh the plist/unit so absolute binary paths stay current after
  // upgrades. installService is now idempotent — it writes the file and
  // tolerates "already loaded" from launchctl.
  await installService();
  const st = await getServiceStatus();
  if (!st.running) await startService();
}

export async function restartService(): Promise<void> {
  assertServicePlatform();
  const st = await getServiceStatus();
  if (!st.installed) {
    throw new Error("服务未安装 — 先运行: lark-opencode-bridge start");
  }
  await stopService();
  await startService();
}

export async function installService(): Promise<void> {
  assertServicePlatform();
  // The daemon redirects stdout/stderr into LOG_DIR before the bridge gets a
  // chance to create it — make sure it exists up front on every platform.
  await ensureHome();
  const binaries = resolveServiceBinaries();
  if (!binaries.larkCli) {
    log.warn("lark-cli not found on PATH — daemon may fail preflight until @larksuite/cli is installed");
  }
  if (!binaries.opencode) {
    log.warn("opencode not found on PATH — daemon may fail preflight until opencode is installed");
  }

  if (IS_WIN) {
    const xmlPath = await writeWindowsTaskXml(binaries);
    try {
      // /F overwrites an existing task so in-place upgrades refresh the command.
      run("schtasks", ["/Create", "/TN", LABEL, "/XML", xmlPath, "/F"]);
    } finally {
      await fs.rm(xmlPath, { force: true }).catch(() => undefined);
    }
    log.info(`installed scheduled task: ${LABEL}`);
    return;
  }
  if (process.platform === "darwin") {
    const plistPath = launchAgentPath();
    await fs.mkdir(path.dirname(plistPath), { recursive: true });
    await fs.writeFile(plistPath, launchAgentPlist(binaries), "utf8");
    // Unload-then-load so an in-place upgrade picks up the refreshed plist.
    // Both ops are tolerated as "already in target state".
    runTolerant("launchctl", ["unload", plistPath], /could not find|no such/i);
    runTolerant("launchctl", ["load", "-w", plistPath], /already loaded/i);
    log.info(`installed launchd agent: ${plistPath}`);
    return;
  }
  if (process.platform === "linux") {
    const unitPath = systemdUnitPath();
    await fs.mkdir(path.dirname(unitPath), { recursive: true });
    await fs.writeFile(unitPath, systemdUnit(binaries), "utf8");
    run("systemctl", ["--user", "daemon-reload"]);
    run("systemctl", ["--user", "enable", "--now", `${LABEL}.service`]);
    log.info(`installed systemd user service: ${unitPath}`);
    return;
  }
  throw new Error(`service install not supported on ${process.platform}`);
}

export async function uninstallService(): Promise<void> {
  assertServicePlatform();
  if (IS_WIN) {
    // Tolerate "task does not exist" so uninstall is idempotent.
    runTolerant("schtasks", ["/Delete", "/TN", LABEL, "/F"], /cannot find|does not exist|ERROR:.*specified/i);
    log.info("uninstalled scheduled task");
    return;
  }
  if (process.platform === "darwin") {
    const plistPath = launchAgentPath();
    run("launchctl", ["unload", plistPath]);
    await fs.rm(plistPath, { force: true });
    log.info("uninstalled launchd agent");
    return;
  }
  if (process.platform === "linux") {
    run("systemctl", ["--user", "disable", "--now", `${LABEL}.service`]);
    await fs.rm(systemdUnitPath(), { force: true });
    run("systemctl", ["--user", "daemon-reload"]);
    log.info("uninstalled systemd user service");
    return;
  }
  throw new Error(`service uninstall not supported on ${process.platform}`);
}

export async function startService(): Promise<void> {
  assertServicePlatform();
  if (IS_WIN) {
    // /Run starts the task immediately regardless of its logon trigger.
    // MultipleInstancesPolicy=IgnoreNew makes this a no-op if already running.
    run("schtasks", ["/Run", "/TN", LABEL]);
    return;
  }
  if (process.platform === "darwin") {
    // Use load -w (idempotent when already loaded → ignore that error).
    const plistPath = launchAgentPath();
    const res = spawnSync("launchctl", ["load", "-w", plistPath], { encoding: "utf8" });
    if (res.status !== 0) {
      const err = (res.stderr || res.stdout || "").trim();
      if (!/already loaded/i.test(err)) {
        throw new Error(`launchctl load failed: ${err}`);
      }
    }
    return;
  }
  if (process.platform === "linux") {
    run("systemctl", ["--user", "start", `${LABEL}.service`]);
    return;
  }
  throw new Error(`service start not supported on ${process.platform}`);
}

export async function stopService(): Promise<void> {
  assertServicePlatform();
  if (IS_WIN) {
    // /End terminates the running instance but keeps the task definition.
    // The logon trigger won't refire until next logon; `start` re-runs it now.
    runTolerant("schtasks", ["/End", "/TN", LABEL], /cannot find|does not exist|not running|ERROR:.*specified/i);
    return;
  }
  if (process.platform === "darwin") {
    // `launchctl stop` alone would respawn due to KeepAlive. Unload the plist
    // so the agent is truly gone; restart pairs this with load -w.
    const plistPath = launchAgentPath();
    const res = spawnSync("launchctl", ["unload", plistPath], { encoding: "utf8" });
    if (res.status !== 0) {
      const err = (res.stderr || res.stdout || "").trim();
      // "Could not find specified service" is fine — already stopped.
      if (!/could not find|no such/i.test(err)) {
        throw new Error(`launchctl unload failed: ${err}`);
      }
    }
    return;
  }
  if (process.platform === "linux") {
    run("systemctl", ["--user", "stop", `${LABEL}.service`]);
    return;
  }
  throw new Error(`service stop not supported on ${process.platform}`);
}

export async function getServiceStatus(): Promise<ServiceStatus> {
  const platform = process.platform;
  if (IS_WIN) {
    const res = spawnSync("schtasks", ["/Query", "/TN", LABEL, "/FO", "LIST"], {
      encoding: "utf8",
    });
    const installed = res.status === 0;
    // schtasks prints a localized "Status:" line; "Running" is stable across
    // locales for the running state, otherwise it reads "Ready".
    const running = installed && /\bRunning\b/i.test(res.stdout || "");
    return {
      installed,
      running,
      platform,
      detail: installed
        ? running
          ? "schtasks: running"
          : "schtasks: installed, not running"
        : "schtasks: not installed",
    };
  }
  if (platform === "darwin") {
    const plistPath = launchAgentPath();
    let installed = false;
    try {
      await fs.access(plistPath);
      installed = true;
    } catch {
      // not installed
    }
    const res = spawnSync("launchctl", ["list"], { encoding: "utf8" });
    const running = installed && (res.stdout || "").includes(LABEL);
    return {
      installed,
      running,
      platform,
      detail: installed ? (running ? "launchd: running" : "launchd: installed, not running") : "launchd: not installed",
    };
  }
  if (platform === "linux") {
    const unitPath = systemdUnitPath();
    let installed = false;
    try {
      await fs.access(unitPath);
      installed = true;
    } catch {
      // not installed
    }
    const res = spawnSync("systemctl", ["--user", "is-active", `${LABEL}.service`], {
      encoding: "utf8",
    });
    const running = res.stdout?.trim() === "active";
    return {
      installed,
      running,
      platform,
      detail: installed ? `systemd: ${res.stdout?.trim() || "unknown"}` : "systemd: not installed",
    };
  }
  return { installed: false, running: false, platform, detail: "foreground only on this platform" };
}

function run(bin: string, args: string[]): void {
  const res = spawnSync(bin, args, { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`${bin} ${args.join(" ")} failed: ${(res.stderr || res.stdout || "").trim()}`);
  }
}

/** Run a command and ignore non-zero exit when stderr matches `tolerable`. */
function runTolerant(bin: string, args: string[], tolerable: RegExp): void {
  const res = spawnSync(bin, args, { encoding: "utf8" });
  if (res.status === 0) return;
  const err = (res.stderr || res.stdout || "").trim();
  if (tolerable.test(err)) return;
  throw new Error(`${bin} ${args.join(" ")} failed: ${err}`);
}
