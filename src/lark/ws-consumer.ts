import { createLarkChannel, Domain } from "@larksuiteoapi/node-sdk";
import type { LarkChannel, NormalizedMessage, CommentEvent } from "@larksuiteoapi/node-sdk";
import { extractTextFromRawMessage } from "./attach.js";
import { createLogger } from "../log.js";
import type { LarkCommentEvent, LarkMessageEvent, MentionInfo } from "./types.js";
import type { LarkCredentials } from "./credentials.js";

const log = createLogger("lark.ws");

export interface CardActionPayload {
  cmd: string;
  chatId: string;
  messageId: string;
  operatorOpenId: string;
  chatType?: "p2p" | "group";
  formValue?: Record<string, string>;
}

export interface WsConsumerOptions {
  credentials: LarkCredentials;
  onMessage: (evt: LarkMessageEvent) => void;
  onComment: (evt: LarkCommentEvent) => void;
  onCardAction: (payload: CardActionPayload) => void;
  /** Called when user presses the stop button on a running card. */
  onStop: (chatId: string) => void;
}

/**
 * Consumes Lark events via the SDK's LarkChannel, which handles both IM
 * events and interactive card action callbacks over the same WS connection.
 */
export class LarkWsConsumer {
  private _channel: LarkChannel | null = null;

  constructor(private readonly opts: WsConsumerOptions) {}

  /** Exposed so callers can call channel.updateCard() for streaming patches. */
  get channel(): LarkChannel | null {
    return this._channel;
  }

  async start(): Promise<void> {
    const { appId, appSecret, brand } = this.opts.credentials;
    log.info(`starting LarkChannel appId=${appId} brand=${brand}`);

    const ch = createLarkChannel({
      appId,
      appSecret,
      domain: brand === "lark" ? Domain.Lark : Domain.Feishu,
      source: "lark-opencode-bridge",
      // Keep raw comment payloads so we can distinguish new top-level comments
      // from replies via notice_meta.notice_type.
      includeRawEvent: true,
      // SDK PolicyGate defaults requireMention=true, which drops every group
      // message that doesn't @ the bot before our handler ever runs. Feishu
      // *does* deliver those messages (verified via lark-cli event consume);
      // we want bridge-level control instead: /spawn groups accept all messages,
      // other groups still require an @ (see handleMessage in bridge.ts).
      policy: { requireMention: false },
      // Disable the 600ms text batching window. Without this, a welcome card
      // or other prior message in the same chat can be merged with the user's
      // `/help`, producing "welcome…\n\n/help" which no longer parses as a
      // slash command and gets sent to opencode instead.
      safety: { batch: { text: { delayMs: 0 } } },
    });
    this._channel = ch;

    ch.on({
      message: (msg: NormalizedMessage) => {
        try {
          const evt = adaptMessage(msg);
          if (evt) this.opts.onMessage(evt);
        } catch (err) {
          log.warn(`message adapt failed: ${(err as Error).message}`);
        }
      },
      cardAction: (evt) => {
        try {
          const value = evt.action?.value as { cmd?: string; chatId?: string } | undefined;
          const chatId = value?.chatId ?? evt.chatId;
          if (!chatId) return;
          const cmd = typeof value?.cmd === "string" ? value.cmd : "";
          if (cmd === "stop") {
            log.info(`stop callback for chatId=${chatId}`);
            this.opts.onStop(chatId);
            return;
          }
          if (!cmd) return;
          const raw = (evt as { raw?: { action?: { form_value?: Record<string, string> } } }).raw;
          const chatType =
            (evt as { chatType?: string }).chatType === "p2p" ? "p2p" : "group";
          this.opts.onCardAction({
            cmd,
            chatId,
            messageId: evt.messageId,
            operatorOpenId: evt.operator.openId,
            chatType,
            formValue: raw?.action?.form_value,
          });
        } catch (err) {
          log.warn(`cardAction handler failed: ${(err as Error).message}`);
        }
      },
      comment: (evt: CommentEvent) => {
        try {
          const mapped = adaptComment(evt);
          if (mapped) this.opts.onComment(mapped);
        } catch (err) {
          log.warn(`comment adapt failed: ${(err as Error).message}`);
        }
      },
      error: (err) => {
        log.error(`channel error: ${err.message}`);
      },
      reconnecting: () => {
        log.warn("channel reconnecting…");
      },
    });

    await ch.connect();
    log.info("LarkChannel connected");
  }

  stop(): void {
    void this._channel?.disconnect();
  }

  /** Manual WS reconnect (/reconnect). */
  async reconnect(): Promise<void> {
    const ch = this._channel;
    if (!ch) throw new Error("LarkChannel not started");
    log.info("manual reconnect requested");
    await ch.disconnect();
    await ch.connect();
    log.info("LarkChannel reconnected");
  }

  connectionSummary(): string {
    const st = this._channel?.getConnectionStatus();
    if (!st) return "not connected";
    return `state=${st.state} reconnectAttempts=${st.reconnectAttempts}`;
  }

  /** Fetch quoted/replied message text via the SDK (same auth as WS). */
  async fetchMessageText(messageId: string): Promise<string | null> {
    const ch = this._channel;
    if (!ch) return null;
    try {
      const res = await ch.rawClient.im.v1.message.get({
        path: { message_id: messageId },
      });
      const item = res.data?.items?.[0];
      if (!item?.body?.content) {
        log.warn(
          `message.get ${messageId}: empty body (code=${res.code ?? "?"} msg=${res.msg ?? ""})`,
        );
        return null;
      }
      const text = extractTextFromRawMessage({
        msg_type: item.msg_type,
        body: item.body,
      });
      return text.trim() || null;
    } catch (err) {
      log.warn(`message.get ${messageId} failed: ${(err as Error).message}`);
      return null;
    }
  }
}

function adaptMessage(msg: NormalizedMessage): LarkMessageEvent | null {
  const mentions: MentionInfo[] = msg.mentions.map((m) => ({
    key: m.key,
    openId: m.openId,
    name: m.name ?? "",
  }));
  return {
    kind: "message",
    type: "im.message.receive_v1",
    event_id: msg.messageId,
    message_id: msg.messageId,
    chat_id: msg.chatId,
    chat_type: (msg.chatType as string) === "p2p" ? "p2p" : "group",
    sender_id: msg.senderId,
    message_type: msg.rawContentType,
    content: msg.content,
    create_time: String(msg.createTime),
    mentions,
    reply_to_message_id: resolveReplyToMessageId(msg),
  };
}

function resolveReplyToMessageId(msg: NormalizedMessage): string | undefined {
  if (msg.replyToMessageId) return msg.replyToMessageId;
  const raw = msg.raw as { message?: { parent_id?: string } } | undefined;
  const parent = raw?.message?.parent_id;
  return parent && parent !== "0" ? parent : undefined;
}

function adaptComment(evt: CommentEvent): LarkCommentEvent | null {
  if (!evt.fileToken || !evt.commentId) return null;
  const raw = rawCommentEvent(evt);
  const noticeType =
    readString(raw.notice_meta?.notice_type) ?? (evt.replyId ? "add_reply" : "add_comment");
  return {
    kind: "comment",
    type: "drive.notice.comment_add_v1",
    event_id: `${noticeType}:${evt.commentId}:${evt.replyId ?? ""}:${evt.timestamp}`,
    file_token: evt.fileToken,
    file_type: evt.fileType ?? "doc",
    comment_id: evt.commentId,
    reply_id: evt.replyId ?? "",
    is_mentioned: evt.mentionedBot,
    notice_type: noticeType,
    from_open_id: evt.operator?.openId,
    to_open_id: readString(raw.notice_meta?.to_user_id?.open_id),
    create_time: String(evt.timestamp),
  };
}

type RawCommentEventLike = {
  notice_meta?: {
    notice_type?: unknown;
    to_user_id?: {
      open_id?: unknown;
    };
  };
};

function rawCommentEvent(evt: CommentEvent): RawCommentEventLike {
  return evt.raw && typeof evt.raw === "object" ? (evt.raw as RawCommentEventLike) : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
