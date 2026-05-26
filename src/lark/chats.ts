import { spawn } from "node:child_process";
import { createLogger } from "../log.js";

const log = createLogger("lark.chats");

export interface ChatsOptions {
  identity: "bot" | "user";
  larkCliPath?: string;
}

export interface CreateChatInput {
  /** Group name (capped at 60 chars by Lark; we trim defensively). */
  name: string;
  /** Group description (capped at 100 chars by Lark; trimmed defensively). */
  description?: string;
  /** open_ids of users to invite. */
  userOpenIds?: string[];
  /** "private" (default, invite-only) or "public" (searchable). */
  chatType?: "private" | "public";
  /** When true and identity=bot, make the creating bot a chat manager. */
  setBotManager?: boolean;
}

export interface CreateChatResult {
  chatId: string;
  raw: unknown;
}

/**
 * Thin wrapper over `lark-cli im +chat-create` / `+chat-update`. Used by the
 * bridge to spawn an opencode-owned group chat per session.
 */
export class LarkChats {
  constructor(private readonly opts: ChatsOptions) {}

  async create(input: CreateChatInput): Promise<CreateChatResult> {
    const name = clip(input.name, 60);
    const description = input.description ? clip(input.description, 100) : undefined;
    const args = [
      "im",
      "+chat-create",
      "--as",
      this.opts.identity,
      "--name",
      name,
      "--type",
      input.chatType ?? "private",
      "--chat-mode",
      "group",
    ];
    if (description) args.push("--description", description);
    if (input.userOpenIds?.length) {
      args.push("--users", input.userOpenIds.join(","));
    }
    if (input.setBotManager && this.opts.identity === "bot") {
      args.push("--set-bot-manager");
    }
    const stdout = await this.run(args);
    const parsed = safeJson(stdout);
    const chatId =
      pickString(parsed, ["data", "chat_id"]) ?? pickString(parsed, ["chat_id"]);
    if (!chatId) {
      throw new Error(`chat-create returned no chat_id: ${stdout.slice(0, 400)}`);
    }
    log.info(`created chat ${chatId} name=${JSON.stringify(name)}`);
    return { chatId, raw: parsed };
  }

  /** Update the group's name. Used to sync opencode session title → group name. */
  async updateName(chatId: string, name: string): Promise<void> {
    await this.run([
      "im",
      "+chat-update",
      "--as",
      this.opts.identity,
      "--chat-id",
      chatId,
      "--name",
      clip(name, 60),
    ]);
  }

  private run(args: string[]): Promise<string> {
    const bin = this.opts.larkCliPath ?? "lark-cli";
    return new Promise((resolve, reject) => {
      const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      proc.stdout.on("data", (c) => stdout.push(c));
      proc.stderr.on("data", (c) => stderr.push(c));
      proc.on("error", reject);
      proc.on("exit", (code) => {
        const out = Buffer.concat(stdout).toString("utf8");
        const err = Buffer.concat(stderr).toString("utf8");
        if (code === 0) {
          resolve(out);
        } else {
          log.error(
            `lark-cli ${args[0]} ${args[1]} failed (code=${code}): ${err.trim() || out.trim()}`,
          );
          reject(
            new Error(`lark-cli failed (code=${code}): ${err.trim() || out.trim()}`),
          );
        }
      });
    });
  }
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  // Reserve room for an ellipsis so trimming is visible.
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { _rawText: text };
  }
}

function pickString(obj: unknown, path: string[]): string | undefined {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur && typeof cur === "object" && k in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}
