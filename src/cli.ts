import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { loadConfig, saveConfig, type BridgeConfig } from "./config.js";
import { Bridge } from "./core/bridge.js";
import { createLogger, recentLogEntries } from "./log.js";
import { HOME_DIR, CONFIG_PATH, SESSIONS_PATH, LOG_DIR } from "./paths.js";
import { runPreflight } from "./preflight.js";
import { runSetupWizard } from "./lark/wizard.js";
import { formatScopesJson } from "./lark/scopes.js";
import { guideScopeImport, copyScopesToClipboard, writeScopesFile } from "./lark/scopes-setup.js";
import { configureBridgeApp } from "./lark/app-setup.js";
import { loadActiveLarkCredentials, hasLarkAppConfigured, loadLarkProfileMeta } from "./lark/credentials.js";
import { saveBridgeSecret } from "./lark/bridge-secrets.js";
import {
  getServiceStatus,
  installService,
  uninstallService,
  startService,
  stopService,
  ensureServiceStarted,
  restartService,
} from "./service/daemon.js";
import { listProcesses, killProcess, isAlive } from "./process/registry.js";

const log = createLogger("cli");

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name("lark-opencode-bridge")
    .description("Bridge Feishu/Lark messenger with the opencode CLI")
    .version(VERSION);

  program
    .command("scopes")
    .description("Print recommended Feishu permission scopes JSON (batch-import format)")
    .option("--copy", "copy JSON to clipboard")
    .option("--write", "write JSON to ~/.lark-opencode-bridge/scopes-recommended.json")
    .action(async (opts: { copy?: boolean; write?: boolean }) => {
      const json = formatScopesJson();
      process.stdout.write(json + "\n");
      if (opts.write) {
        const path = await writeScopesFile();
        process.stdout.write(`\n已写入: ${path}\n`);
      }
      if (opts.copy) {
        process.stdout.write(
          copyScopesToClipboard() ? "\n已复制到剪贴板\n" : "\n剪贴板复制失败（请手动复制上方 JSON）\n",
        );
      }
    });

  program
    .command("scopes-guide")
    .description("Open permissions console and copy scopes JSON to clipboard")
    .requiredOption("--app-id <id>", "Feishu app id (cli_xxx)")
    .option("--brand <b>", "feishu | lark", "feishu")
    .action(async (opts: { appId: string; brand: string }) => {
      await guideScopeImport(opts.appId, opts.brand === "lark" ? "lark" : "feishu");
    });

  const secretCmd = program
    .command("secret")
    .description("Manage bridge-local app secrets (~/.lark-opencode-bridge/secrets.json)");

  secretCmd
    .command("save")
    .description("Save app secret for a lark-cli profile (for npm start when keychain is opaque)")
    .option("--profile <name>", "lark-cli profile name")
    .option("--app-id <id>", "app id (cli_xxx)")
    .option("--stdin", "read secret from stdin")
    .action(async (opts: { profile?: string; appId?: string; stdin?: boolean }) => {
      const meta = await loadLarkProfileMeta({
        profileOrAppId: opts.profile ?? opts.appId,
      });
      let secret = process.env.LARK_APP_SECRET?.trim();
      if (opts.stdin) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
        secret = Buffer.concat(chunks).toString("utf8").trim();
      }
      if (!secret) {
        throw new Error(
          "no secret provided — use --stdin, LARK_APP_SECRET, or paste from developer console",
        );
      }
      await saveBridgeSecret({
        appId: meta.appId,
        appSecret: secret,
        brand: meta.brand,
        profile: meta.profile,
      });
      process.stdout.write(`已保存 ${meta.appId} (profile=${meta.profile}) 到 bridge secrets 文件\n`);
    });

  program
    .command("configure")
    .description("Configure app name, WebSocket events and card callbacks via Open API")
    .option("--profile <name>", "lark-cli profile (default: current)")
    .option("--app-id <id>", "override app id")
    .option("--app-secret <secret>", "app secret (or use LARK_APP_SECRET env)")
    .option("--lark-cli <path>", "override lark-cli binary path")
    .option("--owner-open-id <id>", "owner open_id for display name")
    .option("--owner-name <name>", "owner display name for app title")
    .action(
      async (opts: {
        profile?: string;
        appId?: string;
        appSecret?: string;
        larkCli?: string;
        ownerOpenId?: string;
        ownerName?: string;
      }) => {
        const meta = await loadLarkProfileMeta({
          profileOrAppId: opts.profile ?? opts.appId,
        });
        const appId = opts.appId ?? meta.appId;
        let appSecret = opts.appSecret;
        if (!appSecret) {
          try {
            const creds = await loadActiveLarkCredentials({
              profileOrAppId: opts.profile ?? opts.appId,
            });
            appSecret = creds.appSecret;
          } catch {
            // lark-cli encrypted keyring — fall back to lark-cli api below
          }
        }

        await configureBridgeApp({
          appId,
          brand: meta.brand,
          appSecret,
          larkCliProfile: appSecret ? undefined : meta.profile,
          larkCliPath: opts.larkCli,
          ownerOpenId: opts.ownerOpenId ?? meta.ownerOpenId,
          ownerName: opts.ownerName ?? meta.ownerName,
        });
      },
    );

  program
    .command("setup")
    .description("QR-code onboarding — bind a Feishu app without copying app_secret")
    .option("--profile <name>", "lark-cli profile name", "lark-opencode-bridge")
    .option("--lark-cli <path>", "override lark-cli binary path")
    .option("--domain <d>", "feishu | lark", "feishu")
    .action(async (opts) => {
      await runSetupWizard({
        profileName: opts.profile,
        larkCliPath: opts.larkCli,
        domain: opts.domain === "lark" ? "lark" : "feishu",
      });
    });

  program
    .command("run", { isDefault: true })
    .description("Run the bridge in the foreground (default command)")
    .option("--port <n>", "opencode serve port", String)
    .option("--host <h>", "opencode serve host")
    .option("--no-manage-server", "do not spawn `opencode serve` (connect to an existing one)")
    .option("--cwd <path>", "default working directory for opencode sessions")
    .option("--agent <name>", "default opencode agent (build | plan | …)")
    .option("--model <id>", "default opencode model id")
    .option("--as <identity>", "lark-cli identity (bot | user)")
    .option("--reply-style <style>", "reply | card (streaming interactive card)")
    .option("--lark-cli <path>", "override lark-cli binary path")
    .option("--opencode <path>", "override opencode binary path")
    .option("--force", "skip multi-instance prompt")
    .option("--skip-preflight", "skip dependency checks")
    .action(async (opts) => {
      const cfg = await mergedConfig(opts);

      if (!(await hasLarkAppConfigured(cfg.larkProfile))) {
        if (!process.stdin.isTTY) {
          log.error(
            "飞书应用未配置，后台服务无法扫码绑定 — 请先在前台运行: lark-opencode-bridge run",
          );
          process.exit(1);
        }
        process.stdout.write("\n未检测到飞书应用配置，进入扫码向导…\n\n");
        await runSetupWizard({
          profileName: cfg.larkProfile ?? "lark-opencode-bridge",
          larkCliPath: opts.larkCli,
        });
      }

      if (!opts.skipPreflight) {
        const pf = await runPreflight({
          larkCliPath: opts.larkCli,
          opencodePath: opts.opencode,
          installLarkCli: false,
        });
        if (!pf.ok) {
          log.error("preflight failed — fix the issues above or use --skip-preflight");
          process.exit(1);
        }
      }
      const bridge = new Bridge({
        config: cfg,
        larkCliPath: opts.larkCli,
        opencodePath: opts.opencode,
      });
      await bridge.start({ force: opts.force });

      const shutdown = (signal: NodeJS.Signals) => {
        log.info(`received ${signal}, shutting down`);
        bridge.stop().finally(() => process.exit(0));
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });

  program
    .command("start")
    .description("Install (if needed) and start background daemon (macOS launchd / Linux systemd)")
    .action(async () => {
      if (!(await hasLarkAppConfigured())) {
        process.stdout.write(
          "⚠ 尚未完成飞书应用绑定。请先在前台运行并完成扫码:\n\n  lark-opencode-bridge run\n\n",
        );
        process.exit(1);
      }
      await ensureServiceStarted();
      const st = await getServiceStatus();
      process.stdout.write(`后台服务已启动。\n${st.detail}\n`);
      process.stdout.write(`日志: ${LOG_DIR}/\n`);
      process.stdout.write(`  - ${LOG_DIR}/service.stderr.log（启动错误）\n`);
      process.stdout.write(`  - ${LOG_DIR}/${new Date().toISOString().slice(0, 10)}.log（运行日志）\n`);

      await sleep(2500);
      const procs = await listProcesses();
      const alive = procs.some((p) => p.label === "run" && isAlive(p.pid));
      if (!alive) {
        process.stdout.write(
          "\n⚠ bridge 进程未注册（可能 preflight 失败）。请运行:\n\n  lark-opencode-bridge doctor\n  tail -20 ~/.lark-opencode-bridge/logs/service.stderr.log\n\n",
        );
      } else {
        process.stdout.write("\n✓ bridge 进程已就绪。私聊直接发消息；群里请 @ 机器人。\n");
      }
      process.stdout.write(
        "\n提示: 后台命令需全局安装 (npm i -g lark-opencode-bridge)，勿用 npx。\n",
      );
    });

  program
    .command("stop")
    .description("Stop background daemon")
    .action(async () => {
      await stopService();
      process.stdout.write("后台服务已停止（仍保留服务定义，可用 start 再次启动）。\n");
    });

  program
    .command("restart")
    .description("Restart background daemon")
    .action(async () => {
      await restartService();
      const st = await getServiceStatus();
      process.stdout.write(`后台服务已重启。\n${st.detail}\n`);
    });

  program
    .command("unregister")
    .description("Stop daemon and remove service definition (alias: service uninstall)")
    .action(async () => {
      await uninstallService();
      process.stdout.write("已撤销后台服务注册。\n");
    });

  const service = program.command("service").description("Install/manage OS background service (alias of top-level start/stop)");

  service
    .command("install")
    .description("Install launchd (macOS) or systemd user service (Linux)")
    .action(async () => {
      await installService();
      process.stdout.write("Service installed.\n");
    });

  service
    .command("uninstall")
    .description("Remove background service")
    .action(async () => {
      await uninstallService();
      process.stdout.write("Service uninstalled.\n");
    });

  service
    .command("start")
    .description("Start background service")
    .action(async () => {
      await startService();
      process.stdout.write("Service started.\n");
    });

  service
    .command("stop")
    .description("Stop background service")
    .action(async () => {
      await stopService();
      process.stdout.write("Service stopped.\n");
    });

  service
    .command("status")
    .description("Show background service status")
    .action(async () => {
      const st = await getServiceStatus();
      process.stdout.write(`${st.detail}\n`);
      process.stdout.write(`installed=${st.installed} running=${st.running}\n`);
    });

  program
    .command("status")
    .description("Show bridge service and config summary")
    .action(async () => {
      const cfg = await loadConfig();
      const svc = await getServiceStatus();
      const procs = await listProcesses();
      process.stdout.write("lark-opencode-bridge status\n");
      process.stdout.write(`service: ${svc.detail}\n`);
      process.stdout.write(`registered processes: ${procs.length}\n`);
      for (const p of procs) {
        process.stdout.write(`  pid=${p.pid} alive=${isAlive(p.pid)} label=${p.label} since=${p.startedAt}\n`);
      }
      process.stdout.write(`config: ${CONFIG_PATH}\n`);
      process.stdout.write(`logs: ${LOG_DIR}\n`);
      process.stdout.write(`opencode: http://${cfg.opencodeHost}:${cfg.opencodePort}\n`);
    });

  program
    .command("ps")
    .description("List registered bridge processes on this machine")
    .action(async () => {
      const procs = await listProcesses();
      if (!procs.length) {
        process.stdout.write("(no registered bridge processes)\n");
        return;
      }
      for (const p of procs) {
        process.stdout.write(
          `${p.pid}\t${isAlive(p.pid) ? "alive" : "dead"}\t${p.label}\t${p.appId ?? "-"}\t${p.startedAt}\n`,
        );
      }
    });

  program
    .command("kill")
    .description("Terminate a bridge process by PID")
    .argument("<pid>", "process id", Number)
    .option("-9", "send SIGKILL")
    .action(async (pid: number, opts: { 9?: boolean }) => {
      const ok = await killProcess(pid, opts[9] ? "SIGKILL" : "SIGTERM");
      process.stdout.write(ok ? `sent signal to ${pid}\n` : `process ${pid} not running\n`);
    });

  program
    .command("doctor")
    .description("Verify dependencies and show recent warn/error logs")
    .option("--lark-cli <path>", "override lark-cli binary path")
    .option("--opencode <path>", "override opencode binary path")
    .action(async (opts) => {
      const cfg = await loadConfig();
      const pf = await runPreflight({ larkCliPath: opts.larkCli, opencodePath: opts.opencode });
      const lark = checkBinary(opts.larkCli ?? "lark-cli", ["--version"]);
      const opencode = checkBinary(opts.opencode ?? "opencode", ["--version"]);
      const authed = checkBinary(opts.larkCli ?? "lark-cli", ["auth", "list"]);
      printDoctor({
        homeDir: HOME_DIR,
        configPath: CONFIG_PATH,
        sessionsPath: SESSIONS_PATH,
        cfg,
        lark,
        opencode,
        authed,
        preflightOk: pf.ok,
      });
      const logs = await recentLogEntries(30, new Set(["warn", "error"]));
      if (logs.length) {
        process.stdout.write("\nrecent warn/error:\n");
        for (const e of logs.slice(-15)) {
          process.stdout.write(`${e.ts} [${e.level}] ${e.scope}: ${e.msg}\n`);
        }
      }
    });

  program
    .command("show-config")
    .description("Print the resolved config path and contents")
    .action(async () => {
      const cfg = await loadConfig();
      process.stdout.write(`config: ${CONFIG_PATH}\n`);
      process.stdout.write(JSON.stringify(cfg, null, 2) + "\n");
    });

  await program.parseAsync(argv);
}

interface RunOpts {
  port?: string;
  host?: string;
  manageServer?: boolean;
  cwd?: string;
  agent?: string;
  model?: string;
  as?: string;
  replyStyle?: string;
  larkCli?: string;
  opencode?: string;
}

async function mergedConfig(opts: RunOpts): Promise<BridgeConfig> {
  const cfg = await loadConfig();
  const merged: BridgeConfig = { ...cfg };
  if (opts.port) merged.opencodePort = Number(opts.port);
  if (opts.host) merged.opencodeHost = opts.host;
  if (opts.manageServer === false) merged.manageOpencodeServer = false;
  if (opts.cwd) merged.defaultCwd = opts.cwd;
  if (opts.agent) merged.agent = opts.agent;
  if (opts.model) merged.model = opts.model;
  if (opts.as === "bot" || opts.as === "user") merged.larkIdentity = opts.as;
  if (opts.replyStyle === "card" || opts.replyStyle === "reply") {
    merged.replyStyle = opts.replyStyle;
  }
  await saveConfig(merged);
  return merged;
}

interface BinaryCheck {
  bin: string;
  ok: boolean;
  output: string;
}

function checkBinary(bin: string, args: string[]): BinaryCheck {
  try {
    const res = spawnSync(bin, args, { encoding: "utf8" });
    if (res.error) {
      return { bin, ok: false, output: res.error.message };
    }
    const ok = res.status === 0;
    const output = (res.stdout || res.stderr || "").trim().split("\n")[0] ?? "";
    return { bin, ok, output };
  } catch (err) {
    return { bin, ok: false, output: (err as Error).message };
  }
}

interface DoctorReport {
  homeDir: string;
  configPath: string;
  sessionsPath: string;
  cfg: BridgeConfig;
  lark: BinaryCheck;
  opencode: BinaryCheck;
  authed: BinaryCheck;
  preflightOk: boolean;
}

function printDoctor(r: DoctorReport): void {
  const w = (s: string) => process.stdout.write(s + "\n");
  w("lark-opencode-bridge doctor");
  w("--------------------------------");
  w(`preflight         : ${r.preflightOk ? "ok" : "ISSUES"}`);
  w(`home dir          : ${r.homeDir}`);
  w(`config            : ${r.configPath}`);
  w(`sessions          : ${r.sessionsPath}`);
  w(`logs              : ${LOG_DIR}`);
  w(`lark-cli          : ${r.lark.ok ? "ok" : "MISSING"} (${r.lark.output})`);
  w(`opencode          : ${r.opencode.ok ? "ok" : "MISSING"} (${r.opencode.output})`);
  w(`lark auth list    : ${r.authed.ok ? "ok" : "FAIL"} (${r.authed.output.slice(0, 200)})`);
  w(`opencode addr     : http://${r.cfg.opencodeHost}:${r.cfg.opencodePort}`);
  w(`identity          : --as ${r.cfg.larkIdentity}`);
  w(`reply style       : ${r.cfg.replyStyle}`);
  w(`idle timeout      : ${r.cfg.idleTimeoutMinutes} min`);
  w(`message batch     : ${r.cfg.messageBatchMs} ms`);
  w(`default cwd       : ${r.cfg.defaultCwd ?? "(opencode default)"}`);
  w(`default agent     : ${r.cfg.agent ?? "(opencode default)"}`);
  w(`default model     : ${r.cfg.model ?? "(opencode default)"}`);
  w(`allowlist senders : ${r.cfg.allowedSenderOpenIds.length || "(open)"}`);
  w(`allowlist chats   : ${r.cfg.allowedChatIds.length || "(open)"}`);
  w(`admins            : ${r.cfg.adminOpenIds.length || "(open)"}`);
  w(`require @ in group: ${r.cfg.requireGroupMention}`);
}

const VERSION = "0.1.5";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
