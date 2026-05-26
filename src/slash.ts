/**
 * In-chat slash commands. We mirror the names used by opencode's TUI as
 * closely as possible (see https://opencode.ai/docs/tui/) so users who
 * already know opencode can drop straight into the bridge:
 *
 *   /help /new /clear /init /sessions /resume /continue
 *   /models /agents
 *   /compact /summarize /share /unshare /undo /redo
 *
 * Bridge-specific (no opencode TUI counterpart):
 *
 *   /cd /status /stop /workspaces (/ws)
 *
 * Aliases (e.g. `/model` → `/models`, `/ws` → `/workspaces`) are normalised
 * during parsing so callers only need to handle the canonical name.
 */
export type SlashName =
  | "help"
  | "new"
  | "init"
  | "sessions"
  | "models"
  | "agents"
  | "compact"
  | "share"
  | "unshare"
  | "undo"
  | "redo"
  | "cd"
  | "status"
  | "stop"
  | "spawn"
  | "workspaces"
  | "reconnect"
  | "timeout"
  | "doctor"
  | "config";

export interface SlashCommand {
  name: SlashName;
  /** Original head as typed by the user (useful for the alias-aware help). */
  rawName: string;
  args: string[];
  raw: string;
}

/**
 * Map command aliases to their canonical name. Keys must be lower-case.
 * `/clear` is an opencode alias for `/new`; `/summarize` for `/compact`;
 * `/resume` and `/continue` for `/sessions`. The singular forms `/model`,
 * `/agent`, `/ws` are kept for backward compatibility with the older
 * bridge UX.
 */
const ALIASES: Record<string, SlashName> = {
  clear: "new",
  summarize: "compact",
  resume: "sessions",
  continue: "sessions",
  model: "models",
  agent: "agents",
  ws: "workspaces",
  group: "spawn",
  拉群: "spawn",
};

const CANONICAL: ReadonlySet<SlashName> = new Set<SlashName>([
  "help",
  "new",
  "init",
  "sessions",
  "models",
  "agents",
  "compact",
  "share",
  "unshare",
  "undo",
  "redo",
  "cd",
  "status",
  "stop",
  "spawn",
  "workspaces",
  "reconnect",
  "timeout",
  "doctor",
  "config",
]);

/**
 * Parse a single line as a slash command. Returns null when the line is not
 * a slash command or the name is unknown.
 */
function parseSlashLine(input: string): SlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const body = trimmed.slice(1);
  if (!body) return null;
  const [head, ...rest] = body.split(/\s+/);
  if (!head) return null;
  const lower = head.toLowerCase();
  const canonical =
    ALIASES[lower] ?? (CANONICAL.has(lower as SlashName) ? (lower as SlashName) : null);
  if (!canonical) return null;
  return { name: canonical, rawName: lower, args: rest, raw: trimmed };
}

/**
 * Parse a leading slash command from a chat message. Aliases are folded into
 * the canonical name. When the SDK batching layer merges a prior message with
 * a trailing `/command` line, we scan from the bottom up so `/help` still
 * works. Returns null when the message is not a slash command — callers
 * should treat that as a regular prompt.
 */
export function parseSlash(input: string): SlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const direct = parseSlashLine(trimmed);
  if (direct) return direct;
  const lines = trimmed.split(/\n+/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const hit = parseSlashLine(lines[i] ?? "");
    if (hit) return hit;
  }
  return null;
}

export const HELP_TEXT = [
  "**lark-opencode-bridge** 帮助介绍",
  "",
  "**会话相关**",
  "- `/help` —— 显示这份帮助",
  "- `/new` （别名 `/clear`）—— 开一个全新会话，清空当前聊天的上下文",
  "- `/init` —— 让 opencode 分析仓库并生成 / 更新根目录的 `AGENTS.md`",
  "- `/sessions` （别名 `/resume`、`/continue`）—— 列出 opencode 已有会话",
  "- `/compact` （别名 `/summarize`）—— 压缩当前会话历史，保留关键信息、释放上下文",
  "- `/share` —— 给当前会话生成一个公开分享链接（可发给别人查看）",
  "- `/unshare` —— 撤销上面生成的分享链接",
  "- `/undo` —— 撤销上一条用户消息，连带它产生的文件改动一起回滚",
  "- `/redo` —— 撤销 `/undo`，把刚被回滚的内容再恢复回来",
  "- `/stop` —— 中断当前正在跑的任务（相当于按 esc）",
  "- `/reconnect` —— 手动重连飞书 WebSocket（无需重启 bridge）",
  "- `/timeout [分钟]` —— 查看或设置本聊天无输出自动中断时间（0 = 关闭）",
  "- `/doctor [描述]` —— 根据最近 bridge 日志让 opencode 帮你自查问题",
  "- `/config` —— 打开偏好设置卡片（回复方式、访问控制、群 @ 策略等）",
  "",
  "**模型与 Agent**",
  "- `/models` （别名 `/model`）—— 列出 opencode 当前可用的所有 provider 和模型",
  "- `/models <provider/model>` —— 切换本聊天使用的模型；只写模型名时会自动补全 provider 前缀",
  "- `/agents` （别名 `/agent`）—— 列出可用的 agent（`build`、`plan` 等）",
  "- `/agents <name>` —— 切换本聊天使用的 agent",
  "",
  "**桥接特有**",
  "- `/cd <绝对路径>` —— 把本聊天的工作目录切到指定路径（会重建会话）",
  "- `/status` —— 查看当前会话 id、工作目录、agent、模型等状态",
  "- `/spawn <主题>` （别名 `/group`、`/拉群`）—— 只能在 P2P 私聊用；自动新建一个带 `[opencode]` 前缀的群聊（以主题为名），把你和机器人拉进去，并绑定一个新的 opencode 会话",
  "- `/workspaces` （别名 `/ws`）—— 管理常用工作目录的快捷别名",
  "  - `/workspaces list` —— 列出已保存的工作目录",
  "  - `/workspaces save <名字> [路径]` —— 把当前 cwd（或指定路径）保存为一个命名工作目录",
  "  - `/workspaces use <名字>` —— 切到指定工作目录（会重建会话）",
  "  - `/workspaces rm <名字>` —— 删除一个保存的工作目录",
  "",
  "小提示：直接 @ 机器人发消息就是普通对话；带图片/文件的消息会自动作为附件交给 opencode。",
].join("\n");
