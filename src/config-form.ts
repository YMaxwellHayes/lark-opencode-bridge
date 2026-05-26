import type { BridgeConfig } from "./config.js";
import { parseIdList } from "./config-access.js";
import {
  configFormOptsFromBridge,
  type ConfigFormOpts,
} from "./card/config-card.js";

export interface ConfigFormInput {
  reply_style?: string;
  idle_timeout_minutes?: string;
  message_batch_ms?: string;
  handle_doc_comments?: string;
  require_mention_in_group?: string;
  allowed_users?: string;
  allowed_chats?: string;
  admins?: string;
}

export type ApplyConfigResult =
  | { ok: true; cfg: BridgeConfig; formOpts: ConfigFormOpts }
  | { ok: false; error: string };

export function applyConfigForm(
  cfg: BridgeConfig,
  form: ConfigFormInput,
  operatorOpenId: string,
  currentChatId?: string,
  chatType?: "p2p" | "group",
): ApplyConfigResult {
  const replyStyle = form.reply_style === "card" ? "card" : "reply";

  const idleRaw = (form.idle_timeout_minutes ?? "").trim();
  const idleTimeoutMinutes = idleRaw === "" ? cfg.idleTimeoutMinutes : Number(idleRaw);
  if (!Number.isFinite(idleTimeoutMinutes) || idleTimeoutMinutes < 0 || idleTimeoutMinutes > 120) {
    return { ok: false, error: "全局空闲超时须为 0–120 的整数（0 = 关闭）。" };
  }

  const batchRaw = (form.message_batch_ms ?? "").trim();
  const messageBatchMs = batchRaw === "" ? cfg.messageBatchMs : Number(batchRaw);
  if (!Number.isFinite(messageBatchMs) || messageBatchMs < 0 || messageBatchMs > 10_000) {
    return { ok: false, error: "消息批处理间隔须为 0–10000 的整数（毫秒）。" };
  }

  const handleDocComments = form.handle_doc_comments !== "no";
  const requireGroupMention = form.require_mention_in_group !== "no";

  const allowedSenderOpenIds = parseIdList(form.allowed_users ?? "");
  const allowedChatIds = parseIdList(form.allowed_chats ?? "");
  const adminOpenIds = parseIdList(form.admins ?? "");

  if (allowedSenderOpenIds.length && !allowedSenderOpenIds.includes(operatorOpenId)) {
    return {
      ok: false,
      error:
        "用户白名单未包含你自己 — 保存后会无法跟 bot 对话。请把自己的 open_id 加进白名单，或留空表示不限制。",
    };
  }

  if (adminOpenIds.length && !adminOpenIds.includes(operatorOpenId)) {
    return {
      ok: false,
      error:
        "管理员名单未包含你自己 — 保存后将无法再用 `/config` 等敏感命令。请把自己的 open_id 加进管理员，或留空表示不限制。",
    };
  }

  if (
    chatType === "group" &&
    currentChatId &&
    allowedChatIds.length &&
    !allowedChatIds.includes(currentChatId)
  ) {
    return {
      ok: false,
      error:
        "群白名单未包含当前群 — 保存后本群将无法触发 bot。请把当前 chat_id 加进群白名单，或留空表示所有群可用。",
    };
  }

  const next: BridgeConfig = {
    ...cfg,
    replyStyle,
    idleTimeoutMinutes,
    messageBatchMs,
    handleDocComments,
    requireGroupMention,
    allowedSenderOpenIds,
    allowedChatIds,
    adminOpenIds,
  };

  return { ok: true, cfg: next, formOpts: configFormOptsFromBridge(next) };
}
