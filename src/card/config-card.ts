import type { BridgeConfig } from "../config.js";
import { joinIdList } from "../config-access.js";

export interface ConfigFormOpts {
  replyStyle: BridgeConfig["replyStyle"];
  idleTimeoutMinutes: number;
  messageBatchMs: number;
  handleDocComments: boolean;
  requireGroupMention: boolean;
  allowedUsers: string;
  allowedChats: string;
  admins: string;
}

export function configFormOptsFromBridge(cfg: BridgeConfig): ConfigFormOpts {
  return {
    replyStyle: cfg.replyStyle,
    idleTimeoutMinutes: cfg.idleTimeoutMinutes,
    messageBatchMs: cfg.messageBatchMs,
    handleDocComments: cfg.handleDocComments,
    requireGroupMention: cfg.requireGroupMention,
    allowedUsers: joinIdList(cfg.allowedSenderOpenIds),
    allowedChats: joinIdList(cfg.allowedChatIds),
    admins: joinIdList(cfg.adminOpenIds),
  };
}

/** Interactive form card for `/config`. */
export function configFormCard(opts: ConfigFormOpts): object {
  return {
    schema: "2.0",
    config: { summary: { content: "偏好设置" } },
    body: {
      elements: [
        {
          tag: "markdown",
          content:
            "⚙️ **偏好设置**\n\n" +
            "调整 bridge 行为。提交后**立即生效**（无需重启），并写入 `~/.lark-opencode-bridge/config.json`。",
        },
        { tag: "hr" },
        {
          tag: "form",
          name: "config_form",
          elements: [
            {
              tag: "markdown",
              content:
                "**消息回复方式**\n" +
                "_reply：跑完后一条 markdown 回复_\n" +
                "_card：流式交互卡片（推荐）_",
            },
            {
              tag: "select_static",
              name: "reply_style",
              initial_option: opts.replyStyle,
              options: [
                { text: { tag: "plain_text", content: "reply（线程 markdown）" }, value: "reply" },
                { text: { tag: "plain_text", content: "card（流式卡片）" }, value: "card" },
              ],
            },
            {
              tag: "markdown",
              content:
                "\n**全局空闲超时（分钟）**\n" +
                "_opencode 长时间无输出则自动中断；0 = 关闭。可被 `/timeout` 按聊天覆盖_",
            },
            {
              tag: "input",
              name: "idle_timeout_minutes",
              default_value: String(opts.idleTimeoutMinutes),
              placeholder: { tag: "plain_text", content: "30" },
              input_type: "text",
            },
            {
              tag: "markdown",
              content:
                "\n**消息批处理间隔（毫秒）**\n" +
                "_同一聊天快速连发时合并为一次 prompt；0 = 不等待_",
            },
            {
              tag: "input",
              name: "message_batch_ms",
              default_value: String(opts.messageBatchMs),
              placeholder: { tag: "plain_text", content: "600" },
              input_type: "text",
            },
            {
              tag: "markdown",
              content:
                "\n**云文档评论 @bot**\n" +
                "_开启：文档评论里 @bot 会交给 opencode 并回帖_",
            },
            {
              tag: "select_static",
              name: "handle_doc_comments",
              initial_option: opts.handleDocComments ? "yes" : "no",
              options: [
                { text: { tag: "plain_text", content: "开启" }, value: "yes" },
                { text: { tag: "plain_text", content: "关闭" }, value: "no" },
              ],
            },
            {
              tag: "markdown",
              content:
                "\n**群里需要 @ bot**\n" +
                "_是(默认)：普通群需 @ 才回复；`/spawn` 群仍免 @_\n" +
                "_否：群内任意消息都路由到 opencode_",
            },
            {
              tag: "select_static",
              name: "require_mention_in_group",
              initial_option: opts.requireGroupMention ? "yes" : "no",
              options: [
                { text: { tag: "plain_text", content: "是(默认)" }, value: "yes" },
                { text: { tag: "plain_text", content: "否" }, value: "no" },
              ],
            },
            { tag: "hr" },
            {
              tag: "markdown",
              content:
                "🔒 **访问控制**（留空 = 不限制）\n\n" +
                "open_id / chat_id 可从日志 `~/.lark-opencode-bridge/logs/` 里查看 sender / chat 字段。",
            },
            {
              tag: "markdown",
              content: "\n**用户白名单**（`allowedSenderOpenIds`，英文逗号分隔）",
            },
            {
              tag: "input",
              name: "allowed_users",
              default_value: opts.allowedUsers,
              placeholder: { tag: "plain_text", content: "ou_xxx, ou_yyy（留空=不限制）" },
              input_type: "text",
            },
            {
              tag: "markdown",
              content: "\n**群白名单**（`allowedChatIds`，仅限制群；私聊不受此约束）",
            },
            {
              tag: "input",
              name: "allowed_chats",
              default_value: opts.allowedChats,
              placeholder: { tag: "plain_text", content: "oc_xxx（留空=所有群）" },
              input_type: "text",
            },
            {
              tag: "markdown",
              content:
                "\n**管理员**（`adminOpenIds`）\n" +
                "_限制 `/config` `/reconnect` `/doctor` `/cd` `/workspaces` `/spawn`；留空=不限制_",
            },
            {
              tag: "input",
              name: "admins",
              default_value: opts.admins,
              placeholder: { tag: "plain_text", content: "ou_xxx（留空=不限制）" },
              input_type: "text",
            },
            {
              tag: "column_set",
              flex_mode: "flow",
              horizontal_spacing: "small",
              columns: [
                {
                  tag: "column",
                  width: "auto",
                  elements: [
                    {
                      tag: "button",
                      name: "submit_btn",
                      text: { tag: "plain_text", content: "提交" },
                      type: "primary",
                      form_action_type: "submit",
                      behaviors: [{ type: "callback", value: { cmd: "config.submit" } }],
                    },
                  ],
                },
                {
                  tag: "column",
                  width: "auto",
                  elements: [
                    {
                      tag: "button",
                      name: "cancel_btn",
                      text: { tag: "plain_text", content: "取消" },
                      behaviors: [{ type: "callback", value: { cmd: "config.cancel" } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

export function configSavedCard(opts: ConfigFormOpts): object {
  const summarizeList = (raw: string): string => {
    const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return items.length === 0 ? "_(不限制)_" : `${items.length} 项`;
  };
  return {
    schema: "2.0",
    config: { summary: { content: "偏好已保存" } },
    body: {
      elements: [
        {
          tag: "markdown",
          content:
            "✅ **偏好已保存**\n\n" +
            `**回复方式**：\`${opts.replyStyle}\`\n` +
            `**全局空闲超时**：\`${opts.idleTimeoutMinutes > 0 ? `${opts.idleTimeoutMinutes} 分钟` : "关闭"}\`\n` +
            `**消息批处理**：\`${opts.messageBatchMs} ms\`\n` +
            `**文档评论**：\`${opts.handleDocComments ? "开启" : "关闭"}\`\n` +
            `**群里需要 @**：\`${opts.requireGroupMention ? "是" : "否"}\`\n\n` +
            "🔒 **访问控制**\n" +
            `**用户白名单**：${summarizeList(opts.allowedUsers)}\n` +
            `**群白名单**：${summarizeList(opts.allowedChats)}\n` +
            `**管理员**：${summarizeList(opts.admins)}\n\n` +
            "下一条消息开始生效。",
        },
      ],
    },
  };
}

export function configCancelledCard(): object {
  return {
    schema: "2.0",
    config: { summary: { content: "已取消" } },
    body: {
      elements: [{ tag: "markdown", content: "已取消，未做任何修改。" }],
    },
  };
}

export function configErrorCard(message: string): object {
  return {
    schema: "2.0",
    config: { summary: { content: "保存失败" } },
    body: {
      elements: [{ tag: "markdown", content: `❌ **未能保存**\n\n${message}` }],
    },
  };
}
