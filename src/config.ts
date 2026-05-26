import fs from "node:fs/promises";
import { CONFIG_PATH, ensureHome } from "./paths.js";

export interface BridgeConfig {
  /** Default working directory passed to opencode for new sessions. */
  defaultCwd?: string;
  /** opencode model id, e.g. "anthropic/claude-3-5-sonnet" or "openrouter/..."; SDK default if absent. */
  model?: string;
  /** opencode agent name (e.g. "build" | "plan"). */
  agent?: string;
  /** opencode serve port (auto-spawned). */
  opencodePort: number;
  /** opencode serve host. */
  opencodeHost: string;
  /** If true, bridge will spawn `opencode serve` itself. Otherwise expects an external server. */
  manageOpencodeServer: boolean;
  /** Identity used for lark-cli (`--as bot` or `--as user`). */
  larkIdentity: "bot" | "user";
  /** Allowlist of open_ids that may talk to the bot. Empty = anyone. */
  allowedSenderOpenIds: string[];
  /** Allowlist of chat_ids the bot will respond in (groups only). Empty = all. */
  allowedChatIds: string[];
  /** When non-empty, only these open_ids may run sensitive slash commands. */
  adminOpenIds: string[];
  /** When true (default), group messages require @bot unless /spawn chat. */
  requireGroupMention: boolean;
  /** Reply style. `reply`: thread reply with markdown. `card`: interactive card. */
  replyStyle: "reply" | "card";
  /** lark-cli profile name (or appId) to use. Defaults to the active profile. */
  larkProfile?: string;
  /** When true, the bridge reacts to doc-comment @mentions. Requires the
   * Lark app to be subscribed to `drive.notice.comment_add_v1` events. */
  handleDocComments: boolean;
  /** Auto-abort opencode runs with no activity for this many minutes. 0 = off. */
  idleTimeoutMinutes: number;
  /** Batch rapid messages in the same chat before sending one prompt (ms). */
  messageBatchMs: number;
}

const DEFAULT: BridgeConfig = {
  opencodePort: 4096,
  opencodeHost: "127.0.0.1",
  manageOpencodeServer: true,
  larkIdentity: "bot",
  allowedSenderOpenIds: [],
  allowedChatIds: [],
  adminOpenIds: [],
  requireGroupMention: true,
  replyStyle: "reply",
  handleDocComments: true,
  idleTimeoutMinutes: 30,
  messageBatchMs: 600,
};

export async function loadConfig(): Promise<BridgeConfig> {
  await ensureHome();
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<BridgeConfig>;
    return { ...DEFAULT, ...parsed };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      await saveConfig(DEFAULT);
      return DEFAULT;
    }
    throw err;
  }
}

export async function saveConfig(cfg: BridgeConfig): Promise<void> {
  await ensureHome();
  await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}
