import { createLogger, pruneOldLogs, recentLogEntries } from "../log.js";
import type { BridgeConfig } from "../config.js";
import { saveConfig } from "../config.js";
import {
  ADMIN_SLASH_COMMANDS,
  isAdmin,
  isChatAllowed,
  isUserAllowed,
} from "../config-access.js";
import { applyConfigForm } from "../config-form.js";
import {
  configCancelledCard,
  configErrorCard,
  configFormCard,
  configFormOptsFromBridge,
  configSavedCard,
} from "../card/config-card.js";
import { LarkWsConsumer, type CardActionPayload } from "../lark/ws-consumer.js";
import { LarkSender } from "../lark/sender.js";
import { LarkChats } from "../lark/chats.js";
import { LarkAttachmentFetcher, type AttachmentRef } from "../lark/attach.js";
import { CommentFetcher, type CommentReply, type CommentThread } from "../lark/comments.js";
import {
  loadActiveLarkCredentials,
  fetchBotOpenId,
  type LarkCredentials,
} from "../lark/credentials.js";
import { WsKeepalive } from "../lark/keepalive.js";
import { OpencodeServer } from "../opencode/server.js";
import {
  OpencodeClient,
  SessionNotFoundError,
  parseModel,
  type ModelRef,
  type PromptPart,
} from "../opencode/client.js";
import { OpencodeEventStream } from "../opencode/events.js";
import { SessionStore } from "../session.js";
import { WorkspaceStore, validateWorkspaceName } from "../workspace.js";
import { parseSlash, HELP_TEXT, type SlashCommand } from "../slash.js";
import { OpencodeAgentAdapter } from "../card/agent-event.js";
import { initialState, reduce, markInterrupted, finalizeIfRunning } from "../card/run-state.js";
import type { RunState } from "../card/run-state.js";
import { renderCard } from "../card/run-renderer.js";
import {
  isCommentEvent,
  isMessageEvent,
  type LarkCommentEvent,
  type LarkMessageEvent,
} from "../lark/types.js";
import { ChatPendingQueue } from "./pending-queue.js";
import { IdleWatchdog } from "./idle-watchdog.js";
import { pruneOldMedia } from "../media/cleanup.js";
import { registerProcess, unregisterProcess, findConflicts } from "../process/registry.js";
import { resolveConflicts } from "../process/conflicts.js";

const log = createLogger("bridge");

export interface BridgeOptions {
  config: BridgeConfig;
  larkCliPath?: string;
  opencodePath?: string;
}

interface PerChatRuntime {
  agent?: string;
  model?: string;
  abort?: AbortController;
  /** Per-chat idle timeout override (minutes). */
  idleTimeoutMinutes?: number;
  idleWatchdog?: IdleWatchdog;
}

const CARD_PATCH_INTERVAL_MS = 800;

/**
 * Tool toggles forwarded with every prompt. We disable opencode's `question`
 * tool because Feishu chat doesn't have a clean way to surface multi-step
 * interactive question forms — the model should just answer (or list its own
 * clarifying questions inline as markdown).
 */
const PROMPT_TOOLS: Record<string, boolean> = { question: false };

export class Bridge {
  private consumer: LarkWsConsumer | null = null;
  private credentials: LarkCredentials | null = null;
  private botOpenId: string | null = null;
  private readonly sender: LarkSender;
  private readonly chats: LarkChats;
  private readonly attach: LarkAttachmentFetcher;
  private readonly comments: CommentFetcher;
  private readonly server: OpencodeServer | null;
  private readonly client: OpencodeClient;
  private readonly sessions = new SessionStore();
  private readonly workspaces = new WorkspaceStore();
  private readonly perChat = new Map<string, PerChatRuntime>();
  private readonly pendingQueues = new Map<string, ChatPendingQueue>();
  private readonly docInflight = new Map<string, Promise<void>>();
  private readonly seenEventIds = new Set<string>();
  private keepalive: WsKeepalive | null = null;
  private stopping = false;

  constructor(private readonly opts: BridgeOptions) {
    const { config } = opts;
    this.sender = new LarkSender({
      identity: config.larkIdentity,
      larkCliPath: opts.larkCliPath,
    });
    this.chats = new LarkChats({
      identity: config.larkIdentity,
      larkCliPath: opts.larkCliPath,
    });
    this.attach = new LarkAttachmentFetcher({
      identity: config.larkIdentity,
      larkCliPath: opts.larkCliPath,
    });
    this.comments = new CommentFetcher();
    this.server = config.manageOpencodeServer
      ? new OpencodeServer({
          host: config.opencodeHost,
          port: config.opencodePort,
          opencodePath: opts.opencodePath,
        })
      : null;
    this.client = new OpencodeClient({
      baseUrl: `http://${config.opencodeHost}:${config.opencodePort}`,
      agent: config.agent,
      model: config.model,
      requestTimeoutMs: 10 * 60_000,
    });
  }

  async start(opts?: { force?: boolean }): Promise<void> {
    void pruneOldLogs();
    void pruneOldMedia();
    await this.sessions.load();
    await this.workspaces.load();
    if (this.server) await this.server.start();

    this.credentials = await loadActiveLarkCredentials({
      profileOrAppId: this.opts.config.larkProfile,
    });
    this.comments.setCredentials(this.credentials);

    const conflicts = await findConflicts(this.credentials.appId);
    const resolution = await resolveConflicts(conflicts, { force: opts?.force });
    if (resolution.action === "abort") {
      throw new Error("startup aborted — another bridge instance is running");
    }

    await registerProcess({
      pid: process.pid,
      appId: this.credentials.appId,
      label: "run",
    });

    log.info(
      `lark credentials: appId=${this.credentials.appId} profile=${this.credentials.profile ?? "(none)"}`,
    );

    this.botOpenId = fetchBotOpenId({ larkCliPath: this.opts.larkCliPath });
    log.info(`bot open_id: ${this.botOpenId ?? "(unknown — group mention detection degraded)"}`);

    this.consumer = new LarkWsConsumer({
      credentials: this.credentials,
      onMessage: (evt) => void this.handleInbound(evt),
      onComment: (evt) => void this.handleInbound(evt),
      onCardAction: (payload) => void this.handleCardAction(payload),
      onStop: (chatId) => this.handleStop(chatId),
    });
    await this.consumer.start();

    this.keepalive = new WsKeepalive({
      channel: () => this.consumer?.channel ?? null,
      onStale: () => {
        log.warn("websocket stale — consider /reconnect if messages stop arriving");
      },
    });
    this.keepalive.start();

    log.info("bridge ready — listening for IM messages & doc comments");
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.keepalive?.stop();
    for (const q of this.pendingQueues.values()) await q.drain().catch(() => undefined);
    this.consumer?.stop();
    for (const rt of this.perChat.values()) {
      rt.idleWatchdog?.stop();
      rt.abort?.abort();
    }
    if (this.server) this.server.stop();
    await unregisterProcess(process.pid);
  }

  private async handleInbound(evt: LarkMessageEvent | LarkCommentEvent): Promise<void> {
    if (this.stopping) return;

    if (this.seenEventIds.has(evt.event_id)) {
      log.debug(`skip duplicate event_id=${evt.event_id}`);
      return;
    }
    this.seenEventIds.add(evt.event_id);
    if (this.seenEventIds.size > 5000) {
      const first = this.seenEventIds.values().next().value;
      if (first) this.seenEventIds.delete(first);
    }

    if (isMessageEvent(evt)) {
      await this.handleMessage(evt);
      return;
    }
    if (isCommentEvent(evt)) {
      await this.handleComment(evt);
      return;
    }
  }

  // ---------------------------------------------------------------------
  // IM message branch
  // ---------------------------------------------------------------------

  private async handleMessage(evt: LarkMessageEvent): Promise<void> {
    // High-level inbound trace so users can debug "why didn't my message
    // get a response?" without flipping LOG_LEVEL=debug.
    log.info(
      `inbound msg chat=${evt.chat_id} type=${evt.chat_type} sender=${evt.sender_id} ` +
        `mentions=${evt.mentions.length} spawned=${this.sessions.isSpawned(evt.chat_id)} ` +
        `reply_to=${evt.reply_to_message_id ?? "-"}`,
    );

    // Never process our own outbound messages — the welcome card sent during
    // /spawn must not be fed back into opencode as a user prompt.
    if (this.botOpenId && evt.sender_id === this.botOpenId) {
      log.debug(`skip bot-originated message ${evt.message_id}`);
      return;
    }

    const cfg = this.opts.config;
    if (!isUserAllowed(cfg, evt.sender_id)) {
      log.info(`drop sender=${evt.sender_id} chat=${evt.chat_id} (not allowlisted)`);
      return;
    }
    if (!isChatAllowed(cfg, evt.chat_id, evt.chat_type === "p2p" ? "p2p" : "group")) {
      log.info(`drop chat=${evt.chat_id} (not allowlisted)`);
      return;
    }

    // Group chats normally require an @mention to trigger the bot, but groups
    // we created via `/spawn` are 1:1 with an opencode session and dedicated
    // to opencode work — every message in there is meant for the bot, so we
    // skip the mention gate. Set requireGroupMention=false to accept all group
    // messages without @ (legacy behaviour).
    if (
      evt.chat_type === "group" &&
      !this.sessions.isSpawned(evt.chat_id) &&
      cfg.requireGroupMention &&
      !this.isBotMentioned(evt)
    ) {
      log.info(
        `drop group msg without mention chat=${evt.chat_id} (not a /spawn chat)`,
      );
      return;
    }

    const text = stripMentions(extractTextContent(evt), evt.mentions);
    const slash = text ? parseSlash(text) : null;

    // Slash commands are cheap local replies — serve immediately.
    if (slash) {
      await this.handleSlash(evt, slash);
      return;
    }

    this.getQueue(evt.chat_id).enqueue(evt);
  }

  private getQueue(chatId: string): ChatPendingQueue {
    let q = this.pendingQueues.get(chatId);
    if (!q) {
      q = new ChatPendingQueue({
        batchMs: this.opts.config.messageBatchMs,
        onPreempt: () => this.preemptChat(chatId),
        onFlush: (evts) => this.dispatchBatch(evts),
      });
      this.pendingQueues.set(chatId, q);
    }
    return q;
  }

  private preemptChat(chatId: string): void {
    const rt = this.perChat.get(chatId);
    const sessionId = this.sessions.getSession(chatId);
    if (!rt?.abort) return;
    log.info(`preempt: aborting in-flight run for chat=${chatId}`);
    rt.abort.abort();
    if (sessionId) void this.client.abortSession(sessionId).catch(() => undefined);
  }

  private async dispatchBatch(evts: LarkMessageEvent[]): Promise<void> {
    if (!evts.length) return;
    const primary = evts[evts.length - 1]!;
    const textParts: string[] = [];
    for (const evt of evts) {
      const userText = stripMentions(extractTextContent(evt), evt.mentions);
      const slash = userText ? parseSlash(userText) : null;
      if (slash) {
        await this.handleSlash(evt, slash);
        return;
      }
      const text = await this.buildPromptText(evt, userText);
      if (text) textParts.push(text);
    }
    const combined = textParts.join("\n\n---\n\n");
    const attachments: AttachmentRef[] = [];
    for (const evt of evts) {
      const refs = await this.attach.fetch(evt.message_id, evt.message_type);
      attachments.push(...refs);
    }
    if (!combined && attachments.length === 0) {
      log.debug(`batch has no extractable content — skipping`);
      return;
    }
    await this.handlePrompt(primary, combined, attachments);
  }

  private isBotMentioned(evt: LarkMessageEvent): boolean {
    if (!evt.mentions.length) return false;
    if (this.botOpenId) {
      return evt.mentions.some((m) => m.openId === this.botOpenId);
    }
    // Fallback: any mention triggers (legacy behaviour from lark-cli days).
    return true;
  }


  private async handleReconnect(evt: LarkMessageEvent): Promise<void> {
    try {
      await this.consumer?.reconnect();
      const summary = this.consumer?.connectionSummary() ?? "unknown";
      await this.replyMarkdown(evt, `WebSocket 已重连。\n\n\`${summary}\``);
    } catch (err) {
      await this.replyMarkdown(evt, `重连失败：${(err as Error).message}`);
    }
  }

  private async handleTimeout(
    evt: LarkMessageEvent,
    rt: PerChatRuntime,
    cmd: SlashCommand,
  ): Promise<void> {
    const arg = cmd.args[0]?.trim();
    if (!arg) {
      const global = this.opts.config.idleTimeoutMinutes;
      const local = rt.idleTimeoutMinutes;
      const effective = local ?? global;
      await this.replyMarkdown(
        evt,
        [
          `**空闲超时**（无 opencode 输出则自动中断）`,
          `- 本聊天：\`${local ?? "(使用全局)"}\` 分钟`,
          `- 全局默认：\`${global}\` 分钟（0 = 关闭）`,
          `- 当前生效：\`${effective}\` 分钟`,
          "",
          "用法：`/timeout 30` 设置本聊天 30 分钟；`/timeout 0` 关闭",
        ].join("\n"),
      );
      return;
    }
    const n = Number(arg);
    if (!Number.isFinite(n) || n < 0) {
      await this.replyMarkdown(evt, "用法：`/timeout <分钟>`，例如 `/timeout 30` 或 `/timeout 0`");
      return;
    }
    rt.idleTimeoutMinutes = n;
    await this.replyMarkdown(
      evt,
      n === 0
        ? "本聊天的空闲超时已关闭。"
        : `本聊天的空闲超时已设为 **${n}** 分钟。`,
    );
  }

  private async handleDoctor(
    evt: LarkMessageEvent,
    _rt: PerChatRuntime,
    cmd: SlashCommand,
  ): Promise<void> {
    const userNote = cmd.args.join(" ").trim();
    const logs = await recentLogEntries(180, new Set(["warn", "error"]));
    const ws = this.consumer?.connectionSummary() ?? "unknown";
    const logText =
      logs.length === 0
        ? "_(no warn/error log entries in the last 2 days)_"
        : logs
            .map((e) => `${e.ts} [${e.level}] ${e.scope}: ${e.msg}`)
            .join("\n")
            .slice(0, 12_000);

    const prompt = [
      "你是 lark-opencode-bridge 的自诊断助手。根据以下 bridge 日志和用户描述，",
      "用中文简要分析可能原因并给出可操作的修复步骤（3-5 条以内）。",
      "",
      userNote ? `**用户描述**：${userNote}` : "",
      "",
      `**WebSocket**：${ws}`,
      "",
      "**最近 warn/error 日志**：",
      "```",
      logText,
      "```",
    ]
      .filter(Boolean)
      .join("\n");

    await this.handlePrompt(evt, prompt, []);
  }

  private startIdleWatchdog(chatId: string, rt: PerChatRuntime): void {
    rt.idleWatchdog?.stop();
    const minutes = rt.idleTimeoutMinutes ?? this.opts.config.idleTimeoutMinutes;
    if (minutes <= 0) return;
    const watchdog = new IdleWatchdog({
      timeoutMinutes: minutes,
      onTimeout: async () => {
        log.warn(`idle timeout for chat=${chatId}`);
        this.preemptChat(chatId);
        const sessionId = this.sessions.getSession(chatId);
        if (sessionId) await this.client.abortSession(sessionId).catch(() => undefined);
      },
    });
    rt.idleWatchdog = watchdog;
    watchdog.start();
  }

  private stopIdleWatchdog(rt: PerChatRuntime): void {
    rt.idleWatchdog?.stop();
    rt.idleWatchdog = undefined;
  }

  private async handleSlash(evt: LarkMessageEvent, cmd: SlashCommand): Promise<void> {
    if (ADMIN_SLASH_COMMANDS.has(cmd.name) && !isAdmin(this.opts.config, evt.sender_id)) {
      await this.replyMarkdown(evt, "❌ 此命令仅管理员可用。");
      return;
    }
    const rt = this.getRt(evt.chat_id);
    switch (cmd.name) {
      case "help":
        await this.replyMarkdown(evt, HELP_TEXT);
        return;
      case "new": {
        const oldId = this.sessions.getSession(evt.chat_id);
        this.sessions.clearSession(evt.chat_id);
        await this.replyMarkdown(
          evt,
          oldId ? `Session reset (previous: \`${oldId}\`).` : "No active session to reset.",
        );
        return;
      }
      case "cd": {
        const target = cmd.args.join(" ").trim();
        if (!target) {
          await this.replyMarkdown(evt, "Usage: `/cd <absolute-path>`");
          return;
        }
        if (!target.startsWith("/")) {
          await this.replyMarkdown(
            evt,
            `\`${target}\` 不是绝对路径。Usage: \`/cd <absolute-path>\``,
          );
          return;
        }
        this.setChatCwd(evt.chat_id, target);
        await this.replyMarkdown(
          evt,
          `cwd set to \`${target}\` — session will be reinitialised on the next prompt.`,
        );
        return;
      }
      case "status": {
        const sessionId = this.sessions.getSession(evt.chat_id) ?? "(none)";
        const cwd = this.chatCwd(evt.chat_id) ?? "(opencode default)";
        const agent = rt.agent ?? this.opts.config.agent ?? "(opencode default)";
        const model = rt.model ?? this.opts.config.model ?? "(opencode default)";
        const body = [
          `**chat_id**: \`${evt.chat_id}\``,
          `**session**: \`${sessionId}\``,
          `**cwd**: \`${cwd}\``,
          `**agent**: \`${agent}\``,
          `**model**: \`${model}\``,
          `**replyStyle**: \`${this.opts.config.replyStyle}\``,
          `**websocket**: \`${this.consumer?.connectionSummary() ?? "unknown"}\``,
          `**idleTimeout**: \`${rt.idleTimeoutMinutes ?? this.opts.config.idleTimeoutMinutes}\` min`,
        ].join("\n");
        await this.replyMarkdown(evt, body);
        return;
      }
      case "stop": {
        const sessionId = this.sessions.getSession(evt.chat_id);
        if (sessionId) await this.client.abortSession(sessionId);
        if (rt.abort) {
          rt.abort.abort();
          await this.replyMarkdown(evt, "Cancelled the in-flight run.");
        } else {
          await this.replyMarkdown(evt, "Nothing in flight.");
        }
        return;
      }
      case "agents": {
        const v = cmd.args[0]?.trim();
        if (!v) {
          await this.handleAgentsList(evt, rt);
          return;
        }
        rt.agent = v;
        await this.replyMarkdown(evt, `Agent set to \`${v}\` for this chat.`);
        return;
      }
      case "models": {
        const sub = cmd.args[0]?.trim();
        if (!sub) {
          await this.handleModelList(evt, rt);
          return;
        }
        const resolved = await this.resolveModelId(sub);
        if (!resolved.ok) {
          await this.replyMarkdown(evt, resolved.message);
          return;
        }
        rt.model = resolved.modelId;
        const note = resolved.autoCompleted
          ? ` (auto-resolved from \`${sub}\`)`
          : "";
        await this.replyMarkdown(
          evt,
          `Model set to \`${resolved.modelId}\` for this chat.${note}`,
        );
        return;
      }
      case "sessions":
        await this.handleSessionsList(evt);
        return;
      case "compact":
        await this.handleCompact(evt, rt);
        return;
      case "share":
        await this.handleShare(evt);
        return;
      case "unshare":
        await this.handleUnshare(evt);
        return;
      case "undo":
        await this.handleUndo(evt);
        return;
      case "redo":
        await this.handleRedo(evt);
        return;
      case "init":
        await this.handleInit(evt, rt);
        return;
      case "spawn":
        await this.handleSpawn(evt, cmd);
        return;
      case "workspaces":
        await this.handleWs(evt, cmd);
        return;
      case "reconnect":
        await this.handleReconnect(evt);
        return;
      case "timeout":
        await this.handleTimeout(evt, rt, cmd);
        return;
      case "doctor":
        await this.handleDoctor(evt, rt, cmd);
        return;
      case "config":
        await this.handleConfigForm(evt);
        return;
    }
  }

  private async handleConfigForm(evt: LarkMessageEvent): Promise<void> {
    const opts = configFormOptsFromBridge(this.opts.config);
    const card = configFormCard(opts);
    try {
      await this.sender.sendCard(evt.chat_id, card);
    } catch (err) {
      await this.replyMarkdown(evt, `无法发送配置卡片：${(err as Error).message}`);
    }
  }

  private async handleCardAction(payload: CardActionPayload): Promise<void> {
    const cfg = this.opts.config;
    if (!isUserAllowed(cfg, payload.operatorOpenId)) {
      log.info(`cardAction drop operator=${payload.operatorOpenId} (not allowlisted)`);
      return;
    }

    if (payload.cmd === "config.cancel") {
      try {
        await this.sender.patchCard({
          messageId: payload.messageId,
          card: configCancelledCard(),
        });
      } catch (err) {
        log.warn(`config cancel patch failed: ${(err as Error).message}`);
      }
      return;
    }

    if (payload.cmd === "config.submit") {
      if (
        payload.chatType === "group" &&
        !isChatAllowed(cfg, payload.chatId, "group")
      ) {
        log.info(`cardAction config.submit drop chat=${payload.chatId}`);
        return;
      }
      if (!isAdmin(cfg, payload.operatorOpenId)) {
        try {
          await this.sender.patchCard({
            messageId: payload.messageId,
            card: configErrorCard("❌ 仅管理员可修改配置。"),
          });
        } catch {
          // best effort
        }
        return;
      }
      if (!payload.formValue) {
        try {
          await this.sender.patchCard({
            messageId: payload.messageId,
            card: configErrorCard("未收到表单数据，请重新发送 `/config`。"),
          });
        } catch {
          // best effort
        }
        return;
      }

      const result = applyConfigForm(
        cfg,
        payload.formValue,
        payload.operatorOpenId,
        payload.chatId,
        payload.chatType,
      );
      if (!result.ok) {
        try {
          await this.sender.patchCard({
            messageId: payload.messageId,
            card: configErrorCard(result.error),
          });
        } catch (err) {
          log.warn(`config error patch failed: ${(err as Error).message}`);
        }
        return;
      }

      this.opts.config = result.cfg;
      await saveConfig(result.cfg);
      log.info("config updated via /config card");
      try {
        await this.sender.patchCard({
          messageId: payload.messageId,
          card: configSavedCard(result.formOpts),
        });
      } catch (err) {
        log.warn(`config saved patch failed: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Validate a user-supplied model id and, when it lacks a provider prefix,
   * try to auto-complete it by matching against opencode's known providers.
   *
   * Returns either:
   *  - `{ ok: true, modelId, autoCompleted }` — a full `provider/model` ready
   *    to store in `rt.model`. `autoCompleted` is true when we filled in the
   *    provider prefix for the user.
   *  - `{ ok: false, message }` — a markdown error to send back to the chat
   *    (unknown model, ambiguous match, or opencode unreachable).
   */
  private async resolveModelId(
    input: string,
  ): Promise<
    | { ok: true; modelId: string; autoCompleted: boolean }
    | { ok: false; message: string }
  > {
    if (input.includes("/")) {
      const slash = input.indexOf("/");
      if (slash === 0 || slash === input.length - 1) {
        return {
          ok: false,
          message: `\`${input}\` is not a valid \`provider/model\` id. Try \`/model list\`.`,
        };
      }
      return { ok: true, modelId: input, autoCompleted: false };
    }

    // No provider prefix. Try to find exactly one provider that has this model.
    let providers;
    try {
      providers = await this.client.listProviders();
    } catch (err) {
      return {
        ok: false,
        message:
          `\`${input}\` is missing a provider prefix and I couldn't reach opencode to auto-resolve it ` +
          `(${(err as Error).message}). Use \`/model <provider/model>\`.`,
      };
    }
    const matches: string[] = [];
    for (const p of providers) {
      if (p.models.some((m) => m.id === input)) {
        matches.push(`${p.id}/${input}`);
      }
    }
    if (matches.length === 1) {
      return { ok: true, modelId: matches[0]!, autoCompleted: true };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        message:
          `\`${input}\` is ambiguous — matches: ${matches.map((m) => `\`${m}\``).join(", ")}. ` +
          `Please specify the provider explicitly.`,
      };
    }
    return {
      ok: false,
      message:
        `No provider has a model named \`${input}\`. Run \`/model list\` to see what's available.`,
    };
  }

  /**
   * Render `/model list` output. Queries opencode's `/config/providers` for
   * the current providers + models, marks the chat's effective selection,
   * and posts a markdown list back to Lark.
   */
  private async handleModelList(
    evt: LarkMessageEvent,
    rt: PerChatRuntime,
  ): Promise<void> {
    let providers;
    try {
      providers = await this.client.listProviders();
    } catch (err) {
      await this.replyMarkdown(
        evt,
        `Failed to fetch providers from opencode: ${(err as Error).message}`,
      );
      return;
    }
    if (!providers.length) {
      await this.replyMarkdown(
        evt,
        "No providers available from opencode. Ensure `opencode serve` is running and models are configured.",
      );
      return;
    }

    const current = rt.model ?? this.opts.config.model;
    const lines: string[] = [`**Available models** (current: \`${current ?? "(opencode default)"}\`)`];
    for (const p of providers) {
      lines.push("");
      const header = p.name && p.name !== p.id ? `**${p.name}** (\`${p.id}\`)` : `**${p.id}**`;
      lines.push(header);
      if (!p.models.length) {
        lines.push("- _(no models)_");
        continue;
      }
      for (const m of p.models) {
        const fullId = `${p.id}/${m.id}`;
        const markers: string[] = [];
        if (current && current === fullId) markers.push("← current");
        if (p.defaultModelId && p.defaultModelId === m.id) markers.push("default");
        const tail = markers.length ? `  _(${markers.join(", ")})_` : "";
        const label = m.name && m.name !== m.id ? ` — ${m.name}` : "";
        lines.push(`- \`${fullId}\`${label}${tail}`);
      }
    }
    lines.push("");
    lines.push("Use `/model <provider/model>` to switch.");
    await this.replyMarkdown(evt, lines.join("\n"));
  }

  /** Render `/agents` — list opencode agents and mark the chat's selection. */
  private async handleAgentsList(
    evt: LarkMessageEvent,
    rt: PerChatRuntime,
  ): Promise<void> {
    let agents;
    try {
      agents = await this.client.listAgents();
    } catch (err) {
      await this.replyMarkdown(
        evt,
        `Failed to fetch agents from opencode: ${(err as Error).message}`,
      );
      return;
    }
    if (!agents.length) {
      await this.replyMarkdown(evt, "No agents configured in opencode.");
      return;
    }
    const current = rt.agent ?? this.opts.config.agent;
    const lines = [`**Available agents** (current: \`${current ?? "(opencode default)"}\`)`, ""];
    for (const a of agents) {
      const tail = current && current === a.name ? "  _(← current)_" : "";
      const mode = a.mode ? ` _[${a.mode}]_` : "";
      const desc = a.description ? ` — ${a.description}` : "";
      lines.push(`- \`${a.name}\`${mode}${desc}${tail}`);
    }
    lines.push("");
    lines.push("Use `/agents <name>` to switch.");
    await this.replyMarkdown(evt, lines.join("\n"));
  }

  /**
   * `/sessions` — list opencode sessions visible to this server. We don't
   * implement switching (each Lark chat is bound 1:1 to its own session
   * via `chat_id`), but listing is useful for debugging stale sessions.
   */
  private async handleSessionsList(evt: LarkMessageEvent): Promise<void> {
    let sessions;
    try {
      sessions = await this.client.listSessions();
    } catch (err) {
      await this.replyMarkdown(
        evt,
        `Failed to list sessions: ${(err as Error).message}`,
      );
      return;
    }
    if (!sessions.length) {
      await this.replyMarkdown(evt, "No sessions yet.");
      return;
    }
    const currentForChat = this.sessions.getSession(evt.chat_id);
    const lines: string[] = [`**Sessions** (${sessions.length})`, ""];
    for (const s of sessions.slice(0, 25)) {
      const tail = s.id === currentForChat ? "  _(← this chat)_" : "";
      const title = s.title ? ` — ${s.title}` : "";
      const dir = s.directory ? ` \`${s.directory}\`` : "";
      lines.push(`- \`${s.id}\`${title}${dir}${tail}`);
    }
    if (sessions.length > 25) lines.push(`_… and ${sessions.length - 25} more_`);
    await this.replyMarkdown(evt, lines.join("\n"));
  }

  /** `/compact` — opencode `POST /session/{id}/summarize`. */
  private async handleCompact(
    evt: LarkMessageEvent,
    rt: PerChatRuntime,
  ): Promise<void> {
    const sessionId = this.sessions.getSession(evt.chat_id);
    if (!sessionId) {
      await this.replyMarkdown(evt, "No active session to compact. Send a prompt first.");
      return;
    }
    const model = this.resolveModelForApi(rt);
    if (!model) {
      await this.replyMarkdown(
        evt,
        "`/compact` needs a model. Run `/models <provider/model>` first or set `config.model`.",
      );
      return;
    }
    try {
      await this.client.summarizeSession(sessionId, model);
      await this.replyMarkdown(
        evt,
        `Compacting session \`${sessionId}\` with \`${model.providerID}/${model.modelID}\` — opencode will summarise in the background.`,
      );
    } catch (err) {
      await this.replyMarkdown(evt, `Compact failed: ${(err as Error).message}`);
    }
  }

  /** `/share` — opencode `POST /session/{id}/share`. */
  private async handleShare(evt: LarkMessageEvent): Promise<void> {
    const sessionId = this.sessions.getSession(evt.chat_id);
    if (!sessionId) {
      await this.replyMarkdown(evt, "No active session to share. Send a prompt first.");
      return;
    }
    try {
      const url = await this.client.shareSession(sessionId);
      await this.replyMarkdown(
        evt,
        url
          ? `Session shared: ${url}`
          : `Session \`${sessionId}\` shared, but opencode didn't return a URL.`,
      );
    } catch (err) {
      await this.replyMarkdown(evt, `Share failed: ${(err as Error).message}`);
    }
  }

  /** `/unshare` — opencode `DELETE /session/{id}/share`. */
  private async handleUnshare(evt: LarkMessageEvent): Promise<void> {
    const sessionId = this.sessions.getSession(evt.chat_id);
    if (!sessionId) {
      await this.replyMarkdown(evt, "No active session.");
      return;
    }
    try {
      await this.client.unshareSession(sessionId);
      await this.replyMarkdown(evt, `Session \`${sessionId}\` is no longer shared.`);
    } catch (err) {
      await this.replyMarkdown(evt, `Unshare failed: ${(err as Error).message}`);
    }
  }

  /**
   * `/undo` — revert the most recent user message. opencode wants the
   * `messageID` to roll back to, so we fetch the message list and pick
   * the last user message.
   */
  private async handleUndo(evt: LarkMessageEvent): Promise<void> {
    const sessionId = this.sessions.getSession(evt.chat_id);
    if (!sessionId) {
      await this.replyMarkdown(evt, "No active session to undo.");
      return;
    }
    let messages;
    try {
      messages = await this.client.listMessages(sessionId);
    } catch (err) {
      await this.replyMarkdown(evt, `Undo failed: ${(err as Error).message}`);
      return;
    }
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) {
      await this.replyMarkdown(evt, "Nothing to undo — no user messages in this session.");
      return;
    }
    try {
      await this.client.revertSession(sessionId, lastUser.id);
      await this.replyMarkdown(
        evt,
        `Reverted message \`${lastUser.id}\` and its file changes. Use \`/redo\` to restore.`,
      );
    } catch (err) {
      await this.replyMarkdown(evt, `Undo failed: ${(err as Error).message}`);
    }
  }

  /** `/redo` — opencode `POST /session/{id}/unrevert`. */
  private async handleRedo(evt: LarkMessageEvent): Promise<void> {
    const sessionId = this.sessions.getSession(evt.chat_id);
    if (!sessionId) {
      await this.replyMarkdown(evt, "No active session to redo.");
      return;
    }
    try {
      await this.client.unrevertSession(sessionId);
      await this.replyMarkdown(evt, "Restored previously reverted messages.");
    } catch (err) {
      await this.replyMarkdown(evt, `Redo failed: ${(err as Error).message}`);
    }
  }

  /**
   * `/init` — analyse the project and create/refresh AGENTS.md. The opencode
   * init endpoint is anchored to a user message, so we route this through the
   * normal prompt path (with a canned instruction) which is simpler and works
   * across both reply-mode and card-mode.
   */
  private async handleInit(
    evt: LarkMessageEvent,
    _rt: PerChatRuntime,
  ): Promise<void> {
    const cwd = this.chatCwd(evt.chat_id);
    const instruction = [
      "Initialize this project for opencode.",
      "Analyze the codebase structure, coding patterns, and conventions, then",
      "create (or update if one exists) an `AGENTS.md` file at the project root",
      `${cwd ? `(cwd: ${cwd})` : ""} summarising:`,
      "- what the project does",
      "- the tech stack and key dependencies",
      "- directory layout",
      "- how to build/test/run",
      "- coding conventions worth knowing",
      "",
      "Keep it concise and actionable.",
    ].join("\n");
    await this.handlePrompt(evt, instruction, []);
  }

  /**
   * Resolve the chat's effective {providerID, modelID} for endpoints that
   * require a model parameter (`/compact`, `/init`). Returns undefined when
   * the chat has no model set anywhere.
   */
  private resolveModelForApi(rt: PerChatRuntime): ModelRef | undefined {
    return parseModel(rt.model ?? this.opts.config.model);
  }

  /**
   * `/spawn <主题>` — spin up a fresh Lark group chat dedicated to one
   * opencode session.
   *
   * Flow:
   *   1. Only allowed in P2P chats — spawning a group from inside another
   *      group is confusing and would mix two audiences.
   *   2. Group name is prefixed with `[opencode]` so it's easy to spot in
   *      the user's chat list. The description carries machine-readable
   *      metadata (`bridge=lark-opencode-bridge`) plus the cwd and creator,
   *      acting as our "opencode tag" since Lark has no public chat-tag API.
   *   3. The originating user is invited (`--users`) and, when running as a
   *      bot, the bridge bot is set as chat manager so it can keep updating
   *      the chat later.
   *   4. A new opencode session is created with the chosen cwd and bound to
   *      the new chat_id; opencode's auto-generated session title will then
   *      sync back into the group name on the first response (see
   *      `maybeSyncGroupName`).
   *   5. We post a welcome card into the new chat and reply to the P2P
   *      with the link / chat_id.
   */
  private async handleSpawn(
    evt: LarkMessageEvent,
    cmd: SlashCommand,
  ): Promise<void> {
    if (evt.chat_type !== "p2p") {
      await this.replyMarkdown(
        evt,
        "`/spawn` 只能在 P2P 私聊里使用。请先私聊机器人再执行此命令。",
      );
      return;
    }

    const topic = cmd.args.join(" ").trim();
    if (!topic) {
      await this.replyMarkdown(evt, "用法：`/spawn <主题>`，例如 `/spawn 重构 auth 模块`");
      return;
    }

    const cwd = this.chatCwd(evt.chat_id) ?? this.opts.config.defaultCwd;
    const groupName = formatGroupName(topic);
    const description = SPAWN_GROUP_DESCRIPTION;

    let newChatId: string;
    try {
      const result = await this.chats.create({
        name: groupName,
        description,
        userOpenIds: [evt.sender_id],
        chatType: "private",
        setBotManager: this.opts.config.larkIdentity === "bot",
      });
      newChatId = result.chatId;
      this.sessions.markSpawned(newChatId, { titleSynced: false });
    } catch (err) {
      await this.replyMarkdown(evt, formatChatCreateError(err as Error));
      return;
    }

    // Bind a fresh opencode session to the new chat. We do this eagerly so
    // the welcome message can reference the session id.
    let sessionId: string | null = null;
    try {
      if (cwd) this.sessions.setCwd(newChatId, cwd);
      const created = await this.client.createSession(`lark:${newChatId}`, cwd);
      sessionId = created.id;
      this.sessions.setSession(newChatId, sessionId);
      log.info(`spawn: bound session ${sessionId} → chat ${newChatId}`);
    } catch (err) {
      log.warn(`spawn: session creation failed: ${(err as Error).message}`);
    }

    // Welcome message in the new group.
    const welcome = [
      `**欢迎来到 \`[opencode]\` 工作群**`,
      "",
      `- 主题：${topic}`,
      `- cwd：\`${cwd ?? "(opencode 默认)"}\``,
      sessionId ? `- session：\`${sessionId}\`` : null,
      "",
      "在这个群里**直接发消息**就行，无需 @ 我；群里每个人发的内容都会进入同一个 opencode 会话。",
      "",
      "常用命令：`/help` 查看全部 · `/status` 查看状态 · `/new` 重置会话 · `/stop` 中断 · `/models` 切模型 · `/cd <路径>` 换目录",
    ]
      .filter((x): x is string => Boolean(x))
      .join("\n");
    try {
      await this.sender.send({ chatId: newChatId, markdown: welcome });
    } catch (err) {
      log.warn(`spawn: welcome message failed: ${(err as Error).message}`);
    }

    // Tell the originator in P2P that the group is ready.
    await this.replyMarkdown(
      evt,
      [
        `已创建群聊 **${groupName}**`,
        "",
        `- chat_id：\`${newChatId}\``,
        sessionId ? `- session：\`${sessionId}\`` : "- session：_(opencode 暂未返回，下次发消息时会重建)_",
        "",
        "我已经把你拉进去了，去新群里 @ 我继续聊吧。",
      ].join("\n"),
    );
  }

  private async handleWs(evt: LarkMessageEvent, cmd: SlashCommand): Promise<void> {
    const [sub, ...rest] = cmd.args;
    const subcommand = (sub ?? "list").toLowerCase();
    // Echo whichever form the user typed (`/ws` or `/workspaces`) in any
    // usage hints we send back.
    const prefix = `/${cmd.rawName}`;

    if (subcommand === "list") {
      const items = this.workspaces.list();
      if (!items.length) {
        await this.replyMarkdown(evt, `No saved workspaces. Use \`${prefix} save <name> [path]\`.`);
        return;
      }
      const lines = items.map((w) => `- **${w.name}** — \`${w.path}\``);
      await this.replyMarkdown(evt, lines.join("\n"));
      return;
    }
    if (subcommand === "save") {
      const name = rest[0]?.trim();
      if (!name) {
        await this.replyMarkdown(evt, `Usage: \`${prefix} save <name> [path]\``);
        return;
      }
      try {
        validateWorkspaceName(name);
      } catch (err) {
        await this.replyMarkdown(evt, (err as Error).message);
        return;
      }
      const explicit = rest.slice(1).join(" ").trim();
      const dir = explicit || this.chatCwd(evt.chat_id) || process.cwd();
      const ws = this.workspaces.save(name, dir);
      await this.replyMarkdown(evt, `Saved workspace **${ws.name}** → \`${ws.path}\``);
      return;
    }
    if (subcommand === "use") {
      const name = rest[0]?.trim();
      if (!name) {
        await this.replyMarkdown(evt, `Usage: \`${prefix} use <name>\``);
        return;
      }
      const ws = this.workspaces.get(name);
      if (!ws) {
        await this.replyMarkdown(evt, `No workspace named **${name}**. Use \`${prefix} list\`.`);
        return;
      }
      this.setChatCwd(evt.chat_id, ws.path);
      await this.replyMarkdown(
        evt,
        `Switched to workspace **${name}** (\`${ws.path}\`) — session reset.`,
      );
      return;
    }
    if (subcommand === "rm" || subcommand === "remove" || subcommand === "delete") {
      const name = rest[0]?.trim();
      if (!name) {
        await this.replyMarkdown(evt, `Usage: \`${prefix} rm <name>\``);
        return;
      }
      const removed = this.workspaces.remove(name);
      await this.replyMarkdown(
        evt,
        removed ? `Removed workspace **${name}**.` : `No workspace named **${name}**.`,
      );
      return;
    }
    await this.replyMarkdown(
      evt,
      `Unknown \`${prefix}\` subcommand. Try \`list\`, \`save\`, \`use\`, \`rm\`.`,
    );
  }

  private setChatCwd(chatId: string, dir: string): void {
    this.sessions.setCwd(chatId, dir);
    this.sessions.clearSession(chatId);
  }

  /**
   * Resolve the working directory for a chat. Defensively ignores stored
   * values that aren't absolute paths (defends against past `/cd ?` typos
   * that wrote garbage into sessions.json).
   */
  private chatCwd(chatId: string): string | undefined {
    const stored = this.sessions.getCwd(chatId);
    if (stored && stored.startsWith("/")) return stored;
    return this.opts.config.defaultCwd;
  }

  private async ensureChatSession(chatId: string): Promise<string> {
    let sessionId = this.sessions.getSession(chatId);
    if (!sessionId) {
      const cwd = this.chatCwd(chatId);
      const created = await this.client.createSession(`lark:${chatId}`, cwd);
      sessionId = created.id;
      this.sessions.setSession(chatId, sessionId);
      log.info(`created opencode session ${sessionId} for chat ${chatId} (cwd=${cwd ?? "default"})`);
    }
    return sessionId;
  }

  private async handlePrompt(
    evt: LarkMessageEvent,
    text: string,
    attachments: AttachmentRef[],
  ): Promise<void> {
    const parts: PromptPart[] = [];
    if (text) parts.push({ type: "text", text });
    for (const a of attachments) {
      parts.push({ type: "file", mime: a.mime, url: a.url, filename: a.filename });
    }
    await this.handlePromptCore(evt, parts);
  }

  private async handlePromptCore(evt: LarkMessageEvent, parts: PromptPart[]): Promise<void> {
    const rt = this.getRt(evt.chat_id);
    let sessionId = await this.ensureChatSession(evt.chat_id);

    rt.abort?.abort();
    rt.abort = new AbortController();
    this.startIdleWatchdog(evt.chat_id, rt);

    const run = (sid: string) =>
      this.opts.config.replyStyle === "card"
        ? this.runWithCard(evt, sid, parts, rt)
        : this.runWithReply(evt, sid, parts, rt);

    try {
      await run(sessionId);
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        log.warn(`stale session ${sessionId} for chat ${evt.chat_id} — clearing and retrying`);
        this.sessions.clearSession(evt.chat_id);
        sessionId = await this.ensureChatSession(evt.chat_id);
        rt.abort = new AbortController();
        await run(sessionId);
      } else {
        throw err;
      }
    } finally {
      this.stopIdleWatchdog(rt);
      // Best-effort: after the first response in a /spawn-ed chat, sync the
      // opencode-generated session title into the Lark group name. Errors here
      // shouldn't surface to the user.
      void this.maybeSyncSpawnedChatName(evt.chat_id, sessionId).catch((e) =>
        log.warn(`title sync failed: ${(e as Error).message}`),
      );
    }
  }

  /**
   * For chats spawned via `/spawn`, fetch the opencode session's title once
   * it's been auto-generated (usually after the first prompt completes) and
   * rename the Lark group to match. We only do this once per chat to avoid
   * fighting with the user if they manually rename the group later.
   */
  private async maybeSyncSpawnedChatName(
    chatId: string,
    sessionId: string,
  ): Promise<void> {
    const meta = this.sessions.getSpawnedMeta(chatId);
    if (!meta || meta.titleSynced) return;

    // opencode generates a title in the background. Give it a moment, then
    // pull session info — if there's a non-default title, sync it.
    await sleep(2000);
    let title: string | undefined;
    try {
      const sessions = await this.client.listSessions();
      title = sessions.find((s) => s.id === sessionId)?.title;
    } catch (err) {
      log.debug(`title fetch failed: ${(err as Error).message}`);
      return;
    }
    if (!title) return;
    // Skip the placeholder title we passed at session creation (`lark:<chat>`).
    if (title.startsWith("lark:")) return;

    try {
      await this.chats.updateName(chatId, formatGroupName(title));
      this.sessions.setSpawnedTitleSynced(chatId, true);
      log.info(`synced spawned chat ${chatId} → name="[opencode] ${title}"`);
    } catch (err) {
      log.warn(`group rename failed: ${(err as Error).message}`);
    }
  }

  private async runWithReply(
    evt: LarkMessageEvent,
    sessionId: string,
    parts: PromptPart[],
    rt: PerChatRuntime,
  ): Promise<void> {
    try {
      const result = await this.client.prompt({
        sessionId,
        parts,
        agent: rt.agent,
        model: rt.model,
        tools: PROMPT_TOOLS,
        signal: rt.abort?.signal,
      });
      const reply = result.text || "_(opencode returned an empty response)_";
      await this.replyMarkdown(evt, reply);
    } catch (err) {
      if (err instanceof SessionNotFoundError) throw err;
      await this.replyMarkdown(evt, `**Error:** ${(err as Error).message}`);
    } finally {
      rt.abort = undefined;
    }
  }

  private async runWithCard(
    evt: LarkMessageEvent,
    sessionId: string,
    parts: PromptPart[],
    rt: PerChatRuntime,
  ): Promise<void> {
    const meta = {
      chatId: evt.chat_id,
      agent: rt.agent ?? this.opts.config.agent,
      model: rt.model ?? this.opts.config.model,
    };

    let state: RunState = initialState;
    let dirty = false;

    let messageId: string | null = null;
    try {
      messageId = await this.sender.sendCard(evt.chat_id, renderCard(state, meta));
    } catch (err) {
      log.warn(`card send failed, falling back to reply mode: ${(err as Error).message}`);
      await this.runWithReply(evt, sessionId, parts, rt);
      return;
    }

    const adapter = new OpencodeAgentAdapter();
    const stream = new OpencodeEventStream({
      baseUrl: `http://${this.opts.config.opencodeHost}:${this.opts.config.opencodePort}`,
      sessionID: sessionId,
    });

    const answeredPermissions = new Set<string>();
    const completion = new Promise<void>((resolve, reject) => {
      stream.on("event", (e) => {
        rt.idleWatchdog?.touch();
        // Auto-approve tool permission prompts.
        if (e.kind === "permission" && e.sessionID === sessionId) {
          if (answeredPermissions.has(e.requestID)) return;
          answeredPermissions.add(e.requestID);
          log.info(`auto-approving permission ${e.requestID}`);
          void this.client.replyPermission(e.requestID, "always").catch((err) => {
            log.warn(`permission auto-approve failed: ${(err as Error).message}`);
          });
          return;
        }
        const agentEvents = adapter.translate(e, sessionId);
        for (const ae of agentEvents) {
          state = reduce(state, ae);
          dirty = true;
          if (ae.type === "done") resolve();
          else if (ae.type === "error") reject(new Error(ae.message));
        }
      });
      stream.on("close", () => resolve());
    });

    const abortListener = () => stream.close();
    rt.abort?.signal.addEventListener("abort", abortListener);

    const ch = this.consumer?.channel;
    const patch = async () => {
      const card = renderCard(state, meta);
      try {
        if (ch) {
          await ch.updateCard(messageId!, card);
        } else {
          await this.sender.patchCard({ messageId: messageId!, card });
        }
      } catch (err) {
        log.warn(`card patch failed: ${(err as Error).message}`);
      }
    };

    const patcher = setInterval(() => {
      if (!dirty) return;
      dirty = false;
      rt.idleWatchdog?.touch();
      void patch();
    }, CARD_PATCH_INTERVAL_MS);

    // Capture the abort signal now so we can check it after rt.abort is cleared.
    const abortSignal = rt.abort?.signal;
    try {
      await stream.start();
      await this.client.promptAsync({
        sessionId,
        parts,
        agent: rt.agent,
        model: rt.model,
        tools: PROMPT_TOOLS,
        signal: abortSignal,
      });
      await completion;
      // completion resolves either via done event OR via stream.close() (abort path).
      // Check the abort signal to distinguish the two.
      if (abortSignal?.aborted) {
        state = markInterrupted(state);
      } else {
        state = finalizeIfRunning(state);
      }
    } catch (err) {
      if (err instanceof SessionNotFoundError) throw err;
      if ((err as Error)?.name === "AbortError" || abortSignal?.aborted) {
        state = markInterrupted(state);
      } else {
        const msg = (err as Error)?.message ?? String(err);
        state = reduce(state, { type: "error", message: msg });
      }
    } finally {
      rt.abort?.signal.removeEventListener("abort", abortListener);
      rt.abort = undefined;
      clearInterval(patcher);
      stream.close();
      await patch();
    }
  }

  private handleStop(chatId: string): void {
    const rt = this.perChat.get(chatId);
    if (rt?.abort) {
      log.info(`stop button pressed for chat=${chatId}`);
      rt.abort.abort();
      const sessionId = this.sessions.getSession(chatId);
      if (sessionId) void this.client.abortSession(sessionId);
    }
  }


  private async replyMarkdown(evt: LarkMessageEvent, body: string): Promise<void> {
    try {
      await this.sender.reply({ messageId: evt.message_id, markdown: body });
    } catch (err) {
      log.error(`reply failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------
  // Document comment branch
  // ---------------------------------------------------------------------

  private async handleComment(evt: LarkCommentEvent): Promise<void> {
    if (!this.opts.config.handleDocComments) {
      log.debug(`comment events disabled (config.handleDocComments=false)`);
      return;
    }
    if (!evt.is_mentioned) {
      log.debug(`comment ${evt.comment_id} skipped — bot not mentioned`);
      return;
    }
    if (this.botOpenId && evt.from_open_id === this.botOpenId) {
      log.debug(`comment ${evt.comment_id} skipped — sent by bot itself`);
      return;
    }
    if (evt.notice_type !== "add_comment" && evt.notice_type !== "add_reply") {
      log.debug(`comment ${evt.comment_id} skipped — unsupported notice_type=${evt.notice_type}`);
      return;
    }
    if (
      evt.from_open_id &&
      !isUserAllowed(this.opts.config, evt.from_open_id)
    ) {
      log.info(`drop comment from=${evt.from_open_id} (not allowlisted)`);
      return;
    }
    if (
      !evt.from_open_id &&
      this.opts.config.allowedSenderOpenIds.length
    ) {
      log.info(`drop comment with unknown sender (allowlist active)`);
      return;
    }

    const queueKey = `doc:${evt.file_token}`;
    const previous = this.docInflight.get(queueKey) ?? Promise.resolve();
    const work = previous.then(() => this.dispatchComment(evt));
    this.docInflight.set(queueKey, work);
    try {
      await work;
    } finally {
      if (this.docInflight.get(queueKey) === work) this.docInflight.delete(queueKey);
    }
  }

  private async dispatchComment(evt: LarkCommentEvent): Promise<void> {
    let thread: CommentThread;
    try {
      thread = await this.comments.fetchThread(evt.file_token, evt.comment_id, evt.file_type);
    } catch (err) {
      log.warn(`comment fetch failed: ${(err as Error).message}`);
      return;
    }

    // Prefer the exact reply that triggered the event; fall back to the latest
    // reply only for top-level comment events or older payloads without reply_id.
    let targetReply = findTargetCommentReply(thread.replies, evt.reply_id);
    if (!targetReply && evt.reply_id) {
      await sleep(500);
      try {
        thread = await this.comments.fetchThread(evt.file_token, evt.comment_id, evt.file_type);
        targetReply = findTargetCommentReply(thread.replies, evt.reply_id);
      } catch (err) {
        log.warn(`comment refetch failed: ${(err as Error).message}`);
        return;
      }
    }
    if (!targetReply) {
      log.warn(`comment thread ${evt.comment_id} has no readable replies`);
      return;
    }
    const question = stripCommentMentions(targetReply.text, this.botOpenId, targetReply.mentions);
    if (!question) {
      log.info(`comment ${evt.comment_id} mention had no question text`);
      return;
    }

    const docUrl = buildDocUrl(this.credentials?.brand ?? "feishu", evt.file_type, evt.file_token);
    const promptText = buildCommentPrompt({
      question,
      quote: thread.quote,
      fileType: evt.file_type,
      docUrl,
    });

    const chatKey = `doc:${evt.file_token}`;
    const rt = this.getRt(chatKey);

    const ensureDocSession = async () => {
      let sid = this.sessions.getSession(chatKey);
      if (!sid) {
        const created = await this.client.createSession(
          `lark-doc:${evt.file_token}`,
          this.opts.config.defaultCwd,
        );
        sid = created.id;
        this.sessions.setSession(chatKey, sid);
        log.info(`created opencode session ${sid} for doc ${evt.file_token}`);
      }
      return sid;
    };

    const doPrompt = async (sid: string) => {
      const result = await this.client.prompt({
        sessionId: sid,
        parts: [{ type: "text", text: promptText }],
        agent: rt.agent,
        model: rt.model,
        tools: PROMPT_TOOLS,
      });
      const replyText = (result.text || "(opencode returned an empty response)").slice(0, 2000);
      await this.comments.postReply(evt.file_token, evt.comment_id, evt.file_type, replyText);
      log.info(`replied to comment ${evt.comment_id} on ${evt.file_type}/${evt.file_token}`);
    };

    let sessionId = await ensureDocSession();

    try {
      await doPrompt(sessionId);
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        log.warn(`stale session ${sessionId} for doc ${chatKey} — clearing and retrying`);
        this.sessions.clearSession(chatKey);
        sessionId = await ensureDocSession();
        try {
          await doPrompt(sessionId);
          return;
        } catch (retryErr) {
          err = retryErr;
        }
      }
      const msg = (err as Error).message ?? String(err);
      log.error(`comment prompt/reply failed: ${msg}`);
      try {
        await this.comments.postReply(
          evt.file_token,
          evt.comment_id,
          evt.file_type,
          `[bridge error] ${msg}`.slice(0, 500),
        );
      } catch {
        // best effort
      }
    }
  }

  private getRt(chatId: string): PerChatRuntime {
    let rt = this.perChat.get(chatId);
    if (!rt) {
      rt = {};
      this.perChat.set(chatId, rt);
    }
    return rt;
  }

  /** User text plus quoted/replied message content when present. */
  private async buildPromptText(evt: LarkMessageEvent, userText: string): Promise<string> {
    const quoteId = evt.reply_to_message_id;
    if (!quoteId) return userText;

    const quoted = await this.fetchQuotedMessageText(quoteId);
    if (!quoted) {
      log.info(`quoted message ${quoteId} has no extractable text`);
      return userText;
    }
    log.info(`included quoted message ${quoteId} (${quoted.length} chars)`);
    const parts = [`[引用消息]\n${quoted}`];
    if (userText) parts.push(`[用户消息]\n${userText}`);
    return parts.join("\n\n");
  }

  private async fetchQuotedMessageText(messageId: string): Promise<string | null> {
    const fromSdk = await this.consumer?.fetchMessageText(messageId);
    if (fromSdk) return fromSdk;
    return this.attach.fetchMessageText(messageId);
  }
}

function extractTextContent(evt: LarkMessageEvent): string {
  const c = evt.content?.trim() ?? "";
  if (!c) return "";
  if (c.startsWith("{")) {
    try {
      const parsed = JSON.parse(c) as Record<string, unknown>;
      if (typeof parsed.text === "string") return parsed.text;
    } catch {
      // fall through
    }
  }
  return c;
}

function stripMentions(text: string, mentions: LarkMessageEvent["mentions"]): string {
  let result = text;
  for (const m of mentions) {
    if (m.key && result.includes(m.key)) {
      result = result.split(m.key).join(""); // remove all occurrences
    }
  }
  return result.trim();
}

function findTargetCommentReply(replies: CommentReply[], replyId: string): CommentReply | undefined {
  if (replyId) {
    return replies.find((reply) => reply.reply_id === replyId);
  }
  return replies[replies.length - 1];
}

function stripCommentMentions(
  text: string,
  botOpenId: string | null,
  mentions: CommentReply["mentions"] = [],
): string {
  if (!text) return text;
  let result = text.trim();
  for (const mention of mentions) {
    if (botOpenId && mention.open_id && mention.open_id !== botOpenId) continue;
    for (const token of mentionTokens(mention)) {
      result = result.replace(new RegExp(`^\\s*${escapeRegex(token)}\\s*`, "u"), "");
      if (botOpenId && mention.open_id === botOpenId) {
        result = result.split(token).join("");
      }
    }
  }
  if (botOpenId) {
    result = result.replace(new RegExp(`@${escapeRegex(botOpenId)}`, "g"), "");
  }
  // Strip Lark's @-prefix tokens like "@xxx ", which we synthesised when
  // flattening element-rich content earlier. Conservative: drop "@<name>" at
  // the head of the string.
  result = result.replace(/^(?:@[^\s@]+\s+)+/, "");
  return result.trim();
}

function mentionTokens(mention: CommentReply["mentions"][number]): string[] {
  const tokens: string[] = [];
  if (mention.key) tokens.push(mention.key);
  if (mention.name) tokens.push(`@${mention.name}`);
  return tokens;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildDocUrl(brand: string, fileType: string, fileToken: string): string {
  const host = brand === "lark" ? "larksuite.com" : "feishu.cn";
  const pathByType: Record<string, string> = {
    doc: "docs",
    docx: "docx",
    sheet: "sheets",
    bitable: "base",
    slides: "slides",
    file: "file",
  };
  const seg = pathByType[fileType] ?? fileType;
  return `https://${host}/${seg}/${fileToken}`;
}

/**
 * Build the Lark group name for a spawned chat. We prefix with `[opencode]`
 * so users can recognise these chats in their sidebar at a glance — this is
 * the closest thing Lark has to a public "chat tag". Lark caps names at 60
 * chars; clip() (inside lark/chats.ts) handles the actual truncation but we
 * keep the topic short here to leave room for the prefix.
 */
function formatGroupName(topic: string): string {
  const prefix = "[opencode] ";
  const room = 60 - prefix.length;
  const clipped = topic.length > room ? topic.slice(0, room - 1) + "…" : topic;
  return prefix + clipped;
}

/**
 * Render a friendlier error when `chat-create` fails. We special-case the
 * most common failure — Lark's generic `99991672 Permission denied` — and
 * walk the user through how to fix it instead of dumping the raw JSON.
 */
function formatChatCreateError(err: Error): string {
  const msg = err.message ?? String(err);
  const isPermissionDenied =
    msg.includes("99991672") ||
    /Permission denied/i.test(msg);
  if (isPermissionDenied) {
    return [
      "**创建群聊失败：机器人缺少「创建群」的权限**",
      "",
      "修复步骤：",
      "1. 打开飞书开放平台 → 你的应用 → **权限管理**",
      "2. 申请权限点 `im:chat`（群组：获取与更新群组信息 / 创建/解散群组 / 邀请/移除用户）",
      "3. **版本管理与发布** → 创建新版本并发布（自建应用还需管理员审批）",
      "4. 重启 bridge 后再次执行 `/spawn`",
      "",
      "也可以先用以下命令直接验证权限是否到位：",
      "`lark-cli api POST /open-apis/im/v1/chats --as bot --data '{\"name\":\"opencode test\",\"chat_mode\":\"group\",\"chat_type\":\"private\"}'`",
    ].join("\n");
  }
  return `创建群聊失败：${msg}`;
}

/**
 * Group description for every chat spawned via `/spawn`. Visible to all
 * members — used as both an inline cheat-sheet and the "opencode tag"
 * (Lark has no public chat-tag API). Capped at 100 chars by Lark.
 *
 * Bridge-side recognition of spawned chats is done via the persisted
 * `SessionStore.spawned` map, not by parsing this string.
 */
const SPAWN_GROUP_DESCRIPTION =
  "[opencode] 群内直接发消息无需 @；常用：/help /new /status /stop /models /cd /undo";

function buildCommentPrompt(args: {
  question: string;
  quote?: string;
  fileType: string;
  docUrl: string;
}): string {
  const lines: string[] = [];
  lines.push(`You're answering a comment on a Lark ${args.fileType} document: ${args.docUrl}`);
  if (args.quote) {
    lines.push(`The comment is anchored to this excerpt:`);
    lines.push("");
    lines.push("> " + args.quote.replace(/\n/g, "\n> "));
  }
  lines.push("");
  lines.push(`Question from the comment:`);
  lines.push(args.question);
  lines.push("");
  lines.push(
    "Reply concisely (plain text under 2000 chars). The reader sees this as a Lark comment reply, so avoid markdown formatting.",
  );
  return lines.join("\n");
}
