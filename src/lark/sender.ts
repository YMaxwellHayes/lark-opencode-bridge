import { spawn } from "node:child_process";
import { createLogger } from "../log.js";
import { isThreadUnsupportedError } from "./thread-reply.js";

const log = createLogger("lark.send");

export interface SenderOptions {
  identity: "bot" | "user";
  larkCliPath?: string;
}

export interface ReplyOptions {
  messageId: string;
  /** Either markdown or text — markdown gets richer rendering. */
  markdown?: string;
  text?: string;
  replyInThread?: boolean;
}

export interface SendOptions {
  chatId: string;
  markdown?: string;
  text?: string;
}

export interface PatchCardOptions {
  messageId: string;
  /** Lark interactive card JSON (will be passed as `--data`). */
  card: unknown;
}

export class LarkSender {
  constructor(private readonly opts: SenderOptions) {}

  async reply(o: ReplyOptions): Promise<void> {
    const args = [
      "im",
      "+messages-reply",
      "--message-id",
      o.messageId,
      "--as",
      this.opts.identity,
    ];
    if (o.markdown) {
      args.push("--markdown", o.markdown);
    } else if (o.text) {
      args.push("--text", o.text);
    } else {
      throw new Error("reply requires markdown or text");
    }
    if (o.replyInThread) args.push("--reply-in-thread");
    try {
      await this.runVoid(args);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (o.replyInThread && isThreadUnsupportedError(detail)) {
        log.warn("reply-in-thread unsupported (230071); retrying as plain reply");
        await this.reply({ ...o, replyInThread: false });
        return;
      }
      throw err;
    }
  }

  send(o: SendOptions): Promise<void> {
    const args = ["im", "+messages-send", "--chat-id", o.chatId, "--as", this.opts.identity];
    if (o.markdown) {
      args.push("--markdown", o.markdown);
    } else if (o.text) {
      args.push("--text", o.text);
    } else {
      return Promise.reject(new Error("send requires markdown or text"));
    }
    return this.runVoid(args);
  }

  /**
   * Send an interactive card to a chat. Returns the new message_id from
   * lark-cli's response so callers can patch it later for streaming updates.
   */
  async sendCard(chatId: string, card: unknown): Promise<string> {
    const args = [
      "im",
      "+messages-send",
      "--chat-id",
      chatId,
      "--msg-type",
      "interactive",
      "--content",
      JSON.stringify(card),
      "--as",
      this.opts.identity,
    ];
    const stdout = await this.run(args);
    return this.parseMessageId(stdout);
  }

  /**
   * Reply with an interactive card under an existing message. Prefer this over
   * `sendCard` in topic-mode groups so the bot stays in the same topic/thread.
   */
  async replyCard(messageId: string, card: unknown, replyInThread = false): Promise<string> {
    const args = [
      "im",
      "+messages-reply",
      "--message-id",
      messageId,
      "--msg-type",
      "interactive",
      "--content",
      JSON.stringify(card),
      "--as",
      this.opts.identity,
    ];
    if (replyInThread) args.push("--reply-in-thread");
    try {
      const stdout = await this.run(args);
      return this.parseMessageId(stdout);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (replyInThread && isThreadUnsupportedError(detail)) {
        log.warn("reply-in-thread unsupported (230071); retrying card as plain reply");
        return this.replyCard(messageId, card, false);
      }
      throw err;
    }
  }

  /**
   * Patch the content of an interactive card message. There is no
   * `lark-cli im messages patch` shortcut, so we use the generic api command.
   */
  patchCard(o: PatchCardOptions): Promise<void> {
    const args = [
      "api",
      "PATCH",
      `/open-apis/im/v1/messages/${o.messageId}`,
      "--data",
      JSON.stringify({ content: JSON.stringify(o.card) }),
      "--as",
      this.opts.identity,
    ];
    return this.runVoid(args);
  }

  private parseMessageId(stdout: string): string {
    try {
      const parsed = JSON.parse(stdout);
      const messageId: string | undefined =
        parsed?.data?.message_id ?? parsed?.message_id ?? parsed?.data?.message?.message_id;
      if (!messageId) throw new Error(`no message_id in lark-cli response: ${stdout.slice(0, 400)}`);
      return messageId;
    } catch (err) {
      throw new Error(`failed to parse lark-cli response: ${(err as Error).message}`);
    }
  }

  private runVoid(args: string[]): Promise<void> {
    return this.run(args).then(() => undefined);
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
          log.error(`lark-cli ${args[0]} ${args[1]} failed (code=${code}): ${err.trim() || out.trim()}`);
          reject(new Error(`lark-cli failed (code=${code}): ${err.trim() || out.trim()}`));
        }
      });
    });
  }
}
