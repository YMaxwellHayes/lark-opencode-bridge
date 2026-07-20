import type { LarkMessageEvent } from "./types.js";

/**
 * Whether outbound replies should use Lark `--reply-in-thread`.
 *
 * Topic-mode groups (e.g. Atlas Agent Desk) treat plain `messages-send` as a
 * brand-new top-level topic. Prefer thread replies whenever the inbound
 * message is already in a group/topic context.
 */
export function shouldReplyInThread(evt: Pick<LarkMessageEvent, "chat_type" | "thread_id" | "reply_to_message_id">): boolean {
  return (
    evt.chat_type !== "p2p" ||
    Boolean(evt.thread_id) ||
    Boolean(evt.reply_to_message_id)
  );
}

export function isThreadUnsupportedError(detail: string): boolean {
  return detail.includes("230071");
}
