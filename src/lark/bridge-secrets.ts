import fs from "node:fs/promises";
import path from "node:path";
import { HOME_DIR, ensureHome } from "../paths.js";
import { createLogger } from "../log.js";

const log = createLogger("secrets");

export interface BridgeSecretEntry {
  appId: string;
  appSecret: string;
  brand?: "feishu" | "lark";
  profile?: string;
  savedAt?: string;
}

export interface BridgeSecretsFile {
  apps: BridgeSecretEntry[];
}

const SECRETS_PATH = path.join(HOME_DIR, "secrets.json");

export function bridgeSecretsPath(): string {
  return SECRETS_PATH;
}

export async function saveBridgeSecret(entry: BridgeSecretEntry): Promise<void> {
  await ensureHome();
  const existing = await readBridgeSecrets();
  const apps = existing.apps.filter(
    (a) => a.appId !== entry.appId && a.profile !== entry.profile,
  );
  apps.push({
    ...entry,
    savedAt: new Date().toISOString(),
  });
  const payload = JSON.stringify({ apps }, null, 2) + "\n";
  await fs.writeFile(SECRETS_PATH, payload, { mode: 0o600 });
  log.info(`saved app secret for ${entry.appId} profile=${entry.profile ?? "-"}`);
}

export async function readBridgeSecrets(): Promise<BridgeSecretsFile> {
  try {
    const raw = await fs.readFile(SECRETS_PATH, "utf8");
    const parsed = JSON.parse(raw) as BridgeSecretsFile;
    return { apps: parsed.apps ?? [] };
  } catch {
    return { apps: [] };
  }
}

export async function loadBridgeSecret(opts: {
  appId?: string;
  profile?: string;
}): Promise<BridgeSecretEntry | null> {
  const { apps } = await readBridgeSecrets();
  if (opts.profile) {
    const byProfile = apps.find((a) => a.profile === opts.profile);
    if (byProfile) return byProfile;
  }
  if (opts.appId) {
    const byApp = apps.find((a) => a.appId === opts.appId);
    if (byApp) return byApp;
  }
  return null;
}
