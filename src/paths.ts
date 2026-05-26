import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const ROOT_ENV = process.env.LARK_OPENCODE_HOME;
export const HOME_DIR = ROOT_ENV
  ? path.resolve(ROOT_ENV)
  : path.join(os.homedir(), ".lark-opencode-bridge");

export const CONFIG_PATH = path.join(HOME_DIR, "config.json");
export const SESSIONS_PATH = path.join(HOME_DIR, "sessions.json");
export const WORKSPACES_PATH = path.join(HOME_DIR, "workspaces.json");
export const PROCESSES_PATH = path.join(HOME_DIR, "processes.json");
export const SCOPES_PATH = path.join(HOME_DIR, "scopes-recommended.json");
export const LOG_DIR = path.join(HOME_DIR, "logs");
export const MEDIA_DIR = path.join(HOME_DIR, "media");

export async function ensureHome(): Promise<void> {
  await fs.mkdir(HOME_DIR, { recursive: true });
  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.mkdir(MEDIA_DIR, { recursive: true });
}
