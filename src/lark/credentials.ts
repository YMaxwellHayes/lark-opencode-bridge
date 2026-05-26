import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createLogger } from "../log.js";
import { loadBridgeSecret } from "./bridge-secrets.js";

const log = createLogger("lark.cred");

export interface LarkCredentials {
  appId: string;
  appSecret: string;
  /** "feishu" (open.feishu.cn) | "lark" (open.larksuite.com). */
  brand: "feishu" | "lark";
  /** Friendly profile name from lark-cli config. */
  profile?: string;
}

export interface LarkConfigUser {
  userOpenId?: string;
  userName?: string;
}

export interface LarkConfigApp {
  name?: string;
  appId: string;
  brand?: "feishu" | "lark";
  appSecret?: { source?: string; id?: string };
  users?: LarkConfigUser[];
}

export interface LarkConfig {
  currentApp?: string;
  apps?: LarkConfigApp[];
}

const LARK_CONFIG_PATH = path.join(os.homedir(), ".lark-cli", "config.json");

export async function readLarkConfig(): Promise<LarkConfig> {
  try {
    const raw = await fs.readFile(LARK_CONFIG_PATH, "utf8");
    return JSON.parse(raw) as LarkConfig;
  } catch (err: unknown) {
    throw new Error(
      `cannot read lark-cli config at ${LARK_CONFIG_PATH}: ${(err as Error).message}`,
    );
  }
}

export function resolveLarkApp(cfg: LarkConfig, profileOrAppId?: string): LarkConfigApp {
  const target = profileOrAppId ?? cfg.currentApp;
  const apps = cfg.apps ?? [];
  if (!apps.length) {
    throw new Error(
      "no apps registered in lark-cli config — run `lark-cli profile add` first",
    );
  }
  return (
    apps.find((a) => a.name === target || a.appId === target) ??
    apps.find((a) => a.name === cfg.currentApp || a.appId === cfg.currentApp) ??
    apps[0]!
  );
}

export function ownerNameFromLarkApp(app: LarkConfigApp): string | undefined {
  const name = app.users?.[0]?.userName?.trim();
  return name || undefined;
}

/**
 * Resolve the active lark-cli profile and its app credentials.
 *
 * Secret resolution order:
 * 1. LARK_APP_SECRET env
 * 2. ~/.lark-opencode-bridge/secrets.json (written by setup)
 * 3. macOS Keychain via lark-cli service name (legacy; modern lark-cli uses encrypted keyring)
 */
export async function loadActiveLarkCredentials(opts?: {
  profileOrAppId?: string;
  appSecretOverride?: string;
}): Promise<LarkCredentials> {
  const cfg = await readLarkConfig();
  const match = resolveLarkApp(cfg, opts?.profileOrAppId);
  const appSecret = await readAppSecret(match, opts?.appSecretOverride);
  return {
    appId: match.appId,
    appSecret,
    brand: match.brand ?? "feishu",
    profile: match.name ?? match.appId,
  };
}

/**
 * Load profile metadata without requiring app secret (for configure via lark-cli api).
 */
export async function loadLarkProfileMeta(opts?: {
  profileOrAppId?: string;
}): Promise<{
  appId: string;
  brand: "feishu" | "lark";
  profile: string;
  ownerName?: string;
  ownerOpenId?: string;
}> {
  const cfg = await readLarkConfig();
  const match = resolveLarkApp(cfg, opts?.profileOrAppId);
  const profile = match.name ?? match.appId;
  return {
    appId: match.appId,
    brand: match.brand ?? "feishu",
    profile,
    ownerName: ownerNameFromLarkApp(match),
    ownerOpenId: match.users?.[0]?.userOpenId,
  };
}

/** True when we can resolve app_id + app_secret for the bridge (setup complete). */
export async function hasLarkAppConfigured(profileOrAppId?: string): Promise<boolean> {
  try {
    await loadActiveLarkCredentials({ profileOrAppId });
    return true;
  } catch {
    return false;
  }
}

async function readAppSecret(
  app: LarkConfigApp,
  override?: string,
): Promise<string> {
  if (override?.trim()) {
    log.info(`using app secret from CLI for ${app.appId}`);
    return override.trim();
  }

  const envSecret = process.env.LARK_APP_SECRET;
  if (envSecret) {
    log.info(`using LARK_APP_SECRET from env for ${app.appId}`);
    return envSecret;
  }

  const stored = await loadBridgeSecret({
    appId: app.appId,
    profile: app.name ?? app.appId,
  });
  if (stored?.appSecret) {
    log.info(`loaded app secret for ${app.appId} from bridge secrets file`);
    return stored.appSecret;
  }

  const secretRef = app.appSecret;
  if (secretRef?.source === "keychain" && secretRef.id) {
    const secret = readKeychainLegacy(secretRef.id);
    if (secret) {
      log.info(`loaded app secret for ${app.appId} from macOS Keychain`);
      return secret;
    }
  }

  throw new Error(formatMissingSecretHelp(app));
}

function formatMissingSecretHelp(app: LarkConfigApp): string {
  const profile = app.name ?? app.appId;
  return (
    `cannot resolve app secret for ${app.appId} (profile=${profile}).\n` +
    `Modern lark-cli stores secrets in an encrypted keyring (not readable via \`security\`).\n` +
    `Fix one of these:\n` +
    `  1. Re-run setup (saves secret to ~/.lark-opencode-bridge/secrets.json)\n` +
    `  2. Export: \`export LARK_APP_SECRET=<secret>\` from https://open.feishu.cn/app/${app.appId}/cert\n` +
    `  3. For configure only: \`npm run bridge -- configure --profile ${profile}\` (uses lark-cli api)\n` +
    `  4. Re-add profile: \`echo '<secret>' | lark-cli profile add --name ${profile} --app-id ${app.appId} --app-secret-stdin\``
  );
}

function readKeychainLegacy(service: string | undefined): string | null {
  if (!service || process.platform !== "darwin") return null;
  const res = spawnSync("security", ["find-generic-password", "-s", service, "-w"], {
    encoding: "utf8",
  });
  const out = (res.stdout || "").trim();
  if (!out) {
    if (res.stderr) log.debug(`keychain ${service}: ${res.stderr.trim()}`);
    return null;
  }
  return out;
}

/**
 * Fetch the bot's open_id by calling Lark's bot info endpoint via lark-cli.
 * Used to recognise @mentions targeting us.
 */
export function fetchBotOpenId(opts: { larkCliPath?: string; profile?: string }): string | null {
  const bin = opts.larkCliPath ?? "lark-cli";
  const args = ["api", "GET", "/open-apis/bot/v3/info", "--as", "bot"];
  if (opts.profile) args.unshift("--profile", opts.profile);
  const res = spawnSync(bin, args, { encoding: "utf8" });
  if (res.status !== 0) {
    log.warn(`bot info lookup failed: ${(res.stderr || "").trim()}`);
    return null;
  }
  try {
    const parsed = JSON.parse(res.stdout) as Record<string, unknown>;
    const data = (parsed.data as Record<string, unknown> | undefined) ?? parsed;
    const bot = (data.bot as Record<string, unknown> | undefined) ?? data;
    const openId = bot.open_id;
    if (typeof openId === "string") return openId;
  } catch (err) {
    log.warn(`bot info parse failed: ${(err as Error).message}`);
  }
  return null;
}
