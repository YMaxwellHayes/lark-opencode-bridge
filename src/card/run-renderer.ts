import type { Block, FooterStatus, RunState, ToolEntry } from "./run-state.js";
import { toolBodyMd, toolHeaderText } from "./tool-render.js";

const REASONING_MAX = 1000;
const COLLAPSE_TOOL_THRESHOLD = 3;

export interface CardMeta {
  /** Included in the stop button value so the bridge knows which chat to abort. */
  chatId: string;
  agent?: string;
  model?: string;
}

export function renderCard(state: RunState, meta: CardMeta): object {
  const elements: object[] = [];

  if (state.reasoning.content) {
    elements.push(reasoningPanel(state.reasoning.content, state.reasoning.active));
  }

  for (const group of groupBlocks(state.blocks)) {
    if (group.kind === "text") {
      if (group.content.trim()) elements.push(mdEl(group.content));
    } else {
      elements.push(...renderToolGroup(group.tools, state.terminal !== "running"));
    }
  }

  if (state.terminal === "interrupted") {
    elements.push(noteMd("_已中断_"));
  } else if (state.terminal === "error" && state.errorMsg) {
    elements.push(noteMd(`_出错：${state.errorMsg}_`));
  } else if (state.terminal === "done" && elements.length === 0) {
    elements.push(noteMd("_（未返回内容）_"));
  }

  if (state.terminal === "running") {
    if (state.footer) elements.push(footerStatusEl(state.footer));
    elements.push(stopButton(meta.chatId));
  } else {
    const tags: string[] = [];
    if (meta.agent) tags.push(`agent · ${meta.agent}`);
    if (meta.model) tags.push(`model · ${meta.model}`);
    if (tags.length) {
      elements.push({ tag: "hr" });
      elements.push({ tag: "markdown", content: tags.join("    "), text_size: "notation" });
    }
  }

  return {
    schema: "2.0",
    config: {
      streaming_mode: state.terminal === "running",
      summary: { content: summaryText(state) },
    },
    body: { elements },
  };
}

// ─── Block grouping ───────────────────────────────────────────────────────────

interface ToolGroup { kind: "tools"; tools: ToolEntry[] }
interface TextGroup { kind: "text"; content: string }
type Group = ToolGroup | TextGroup;

function* groupBlocks(blocks: Block[]): Generator<Group> {
  let toolBuf: ToolEntry[] = [];
  for (const b of blocks) {
    if (b.kind === "tool") {
      toolBuf.push(b.tool);
    } else {
      if (toolBuf.length > 0) { yield { kind: "tools", tools: toolBuf }; toolBuf = []; }
      yield { kind: "text", content: b.content };
    }
  }
  if (toolBuf.length > 0) yield { kind: "tools", tools: toolBuf };
}

function renderToolGroup(tools: ToolEntry[], finalized: boolean): object[] {
  if (tools.length === 0) return [];
  if (tools.length < COLLAPSE_TOOL_THRESHOLD) return tools.map((t) => toolPanel(t, false));
  if (finalized) return [collapsedToolSummary(tools)];
  const prior = tools.slice(0, -1);
  const latest = tools[tools.length - 1]!;
  return [...(prior.length ? [collapsedToolSummary(prior)] : []), toolPanel(latest, true)];
}

// ─── Panel builders ───────────────────────────────────────────────────────────

function reasoningPanel(content: string, active: boolean): object {
  return collapsiblePanel({
    title: active ? "**正在推理**" : "**思考过程**",
    expanded: active,
    border: "grey",
    body: truncate(content, REASONING_MAX),
  });
}

function toolPanel(tool: ToolEntry, expanded: boolean): object {
  return collapsiblePanel({
    title: toolHeaderText(tool),
    expanded,
    border: tool.status === "error" ? "red" : "grey",
    body: toolBodyMd(tool) || "_无输出_",
  });
}

function collapsedToolSummary(tools: ToolEntry[]): object {
  return {
    tag: "collapsible_panel",
    expanded: false,
    header: panelHeader(`**${tools.length} 个工具调用**`),
    border: { color: "grey", corner_radius: "5px" },
    vertical_spacing: "8px",
    padding: "8px 8px 8px 8px",
    elements: [
      {
        tag: "markdown",
        content: tools.map((t) => `- ${toolHeaderText(t)}`).join("\n"),
        text_size: "notation",
      },
    ],
  };
}

interface PanelOpts { title: string; expanded: boolean; border: "grey" | "red" | "blue"; body: string }

function collapsiblePanel(opts: PanelOpts): object {
  return {
    tag: "collapsible_panel",
    expanded: opts.expanded,
    header: panelHeader(opts.title),
    border: { color: opts.border, corner_radius: "5px" },
    vertical_spacing: "8px",
    padding: "8px 8px 8px 8px",
    elements: [{ tag: "markdown", content: opts.body, text_size: "notation" }],
  };
}

function panelHeader(titleMd: string): object {
  return {
    title: { tag: "markdown", content: titleMd },
    vertical_align: "center",
    icon: { tag: "standard_icon", token: "down-small-ccm_outlined", size: "16px 16px" },
    icon_position: "follow_text",
    icon_expanded_angle: -180,
  };
}

// ─── Leaf elements ────────────────────────────────────────────────────────────

function mdEl(content: string): object { return { tag: "markdown", content }; }
function noteMd(content: string): object { return { tag: "markdown", content, text_size: "notation" }; }

function stopButton(chatId: string): object {
  return {
    tag: "button",
    text: { tag: "plain_text", content: "终止" },
    type: "danger",
    behaviors: [{ type: "callback", value: { cmd: "stop", chatId } }],
  };
}

function footerStatusEl(status: Exclude<FooterStatus, null>): object {
  const text =
    status === "thinking" ? "正在思考"
    : status === "tool_running" ? "正在调用工具"
    : "正在输出";
  return noteMd(`_${text}_`);
}

function summaryText(state: RunState): string {
  if (state.terminal === "interrupted") return "已中断";
  if (state.terminal === "error") return "出错";
  if (state.terminal === "done") return "已完成";
  if (state.footer === "tool_running") return "正在调用工具";
  if (state.footer === "streaming") return "正在输出";
  return "思考中";
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
