/**
 * Default event subscriptions for lark-opencode-bridge (WebSocket / 长连接).
 * Applied by `configure` / setup wizard via Open API.
 */
export const DEFAULT_SUBSCRIBED_EVENTS = [
  /** 撤销 user_access_token */
  "auth.user_access_token.revoked_v4",
  /** 用户进入与机器人的会话 */
  "im.chat.access_event.bot_p2p_chat_entered_v1",
  /** 解散群 */
  "im.chat.disbanded_v1",
  /** 机器人进群 */
  "im.chat.member.bot.added_v1",
  /** 机器人被移出群 */
  "im.chat.member.bot.deleted_v1",
  /** 用户进群 */
  "im.chat.member.user.added_v1",
  /** 用户主动退群或被移出群聊 */
  "im.chat.member.user.deleted_v1",
  /** 撤销拉用户进群 */
  "im.chat.member.user.withdrawn_v1",
  /** 群配置修改 */
  "im.chat.updated_v1",
  /** 用户修改是否接收机器人消息配置 */
  "im.message.bot_muted_v1",
  /** 消息已读 */
  "im.message.message_read_v1",
  /** 消息被 reaction */
  "im.message.reaction.created_v1",
  /** 消息被取消 reaction */
  "im.message.reaction.deleted_v1",
  /** 消息撤回 */
  "im.message.recalled_v1",
  /** 接收消息 */
  "im.message.receive_v1",
  /** 用户和机器人的会话首次被创建 */
  "p2p_chat_create",
  /** 有新文档评论或回复通知 */
  "drive.notice.comment_add_v1",
] as const;

/** 卡片回传交互 — streaming card stop button, /help buttons, etc. */
export const DEFAULT_SUBSCRIBED_CALLBACKS = ["card.action.trigger"] as const;

export function formatAppDisplayName(ownerName: string): string {
  const trimmed = ownerName.trim();
  if (!trimmed || trimmed === "我的") return "我的 OpenCode-Bridge";
  return `${trimmed} 的 OpenCode-Bridge`;
}

export function eventsConsoleUrl(appId: string, brand: "feishu" | "lark" = "feishu"): string {
  const host = brand === "lark" ? "open.larksuite.com" : "open.feishu.cn";
  return `https://${host}/app/${appId}/event`;
}

export function callbacksConsoleUrl(appId: string, brand: "feishu" | "lark" = "feishu"): string {
  const host = brand === "lark" ? "open.larksuite.com" : "open.feishu.cn";
  return `https://${host}/app/${appId}/callback`;
}

export function baseInfoConsoleUrl(appId: string, brand: "feishu" | "lark" = "feishu"): string {
  const host = brand === "lark" ? "open.larksuite.com" : "open.feishu.cn";
  return `https://${host}/app/${appId}/credentials`;
}
