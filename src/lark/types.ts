/**
 * Internal event types the bridge handles. Adapted from both lark-cli's
 * flattened NDJSON and the @larksuiteoapi/node-sdk webhook envelopes.
 */

export interface MentionInfo {
  /** "@_user_1" style key used inside `content`. */
  key: string;
  openId?: string;
  name: string;
}

export interface LarkMessageEvent {
  kind: "message";
  type: string;
  event_id: string;
  message_id: string;
  chat_id: string;
  chat_type: "p2p" | "group" | string;
  sender_id: string;
  message_type: string;
  /** Pre-rendered text for text/post/image/file/audio. JSON string for interactive. */
  content: string;
  create_time: string;
  mentions: MentionInfo[];
  /** When the user replies to or quotes another message, Feishu sets parent_id. */
  reply_to_message_id?: string;
}

export interface LarkCommentEvent {
  kind: "comment";
  type: "drive.notice.comment_add_v1";
  event_id: string;
  file_token: string;
  file_type: "doc" | "docx" | "sheet" | "bitable" | "slides" | "file" | string;
  comment_id: string;
  reply_id: string;
  is_mentioned: boolean;
  notice_type: "add_comment" | "add_reply" | string;
  from_open_id?: string;
  to_open_id?: string;
  create_time: string;
}

export type LarkInboundEvent = LarkMessageEvent | LarkCommentEvent;

export function isMessageEvent(e: LarkInboundEvent): e is LarkMessageEvent {
  return e.kind === "message";
}

export function isCommentEvent(e: LarkInboundEvent): e is LarkCommentEvent {
  return e.kind === "comment";
}
