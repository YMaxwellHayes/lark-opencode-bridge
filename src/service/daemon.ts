import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createLogger } from "../log.js";
import { HOME_DIR } from "../paths.js";

const log = createLogger("service");

const LABEL = "com.lark-opencode-bridge";

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

function launchAgentPlist(): string {
  const bin = bridgeBin();
  const node = nodeBin();
  const home = HOME_DIR;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${bin}</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${home}/logs/service.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${home}/logs/service.stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}</string>
  </dict>
</dict>
</plist>
`;
}

function systemdUnit(): string {
  const bin = bridgeBin();
  const node = nodeBin();
  return `[Unit]
Description=Lark OpenCode Bridge
After=network.target

[Service]
Type=simple
ExecStart=${node} ${bin} run
Restart=always
RestartSec=5
Environment=PATH=${process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin"}

[Install]
WantedBy=default.target
`;
}

function launchAgentPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

function systemdUnitPath(): string {
  return path.join(os.homedir(), ".config", "systemd", "user", `${LABEL}.service`);
}

function assertServicePlatform(): void {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error(
      "后台服务仅支持 macOS / Linux — 请在前台运行: lark-opencode-bridge run",
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
  await ensureServiceInstalled();
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
  if (process.platform === "darwin") {
    const plistPath = launchAgentPath();
    await fs.mkdir(path.dirname(plistPath), { recursive: true });
    await fs.writeFile(plistPath, launchAgentPlist(), "utf8");
    run("launchctl", ["load", "-w", plistPath]);
    log.info(`installed launchd agent: ${plistPath}`);
    return;
  }
  if (process.platform === "linux") {
    const unitPath = systemdUnitPath();
    await fs.mkdir(path.dirname(unitPath), { recursive: true });
    await fs.writeFile(unitPath, systemdUnit(), "utf8");
    run("systemctl", ["--user", "daemon-reload"]);
    run("systemctl", ["--user", "enable", "--now", `${LABEL}.service`]);
    log.info(`installed systemd user service: ${unitPath}`);
    return;
  }
  throw new Error(`service install not supported on ${process.platform}`);
}

export async function uninstallService(): Promise<void> {
  assertServicePlatform();
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
  if (process.platform === "darwin") {
    run("launchctl", ["start", LABEL]);
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
  if (process.platform === "darwin") {
    run("launchctl", ["stop", LABEL]);
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
