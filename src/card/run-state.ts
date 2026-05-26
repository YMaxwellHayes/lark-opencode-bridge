import type { AgentEvent } from "./agent-event.js";

export type ToolStatus = "running" | "done" | "error";

export interface ToolEntry {
  id: string;
  name: string;
  status: ToolStatus;
  output?: string;
  /** Raw tool input params (useful for displaying the `question` tool's prompt). */
  input?: Record<string, unknown>;
}

export type Block =
  | { kind: "text"; content: string; streaming: boolean }
  | { kind: "tool"; tool: ToolEntry };

export type FooterStatus = "thinking" | "tool_running" | "streaming" | null;
export type Terminal = "running" | "done" | "interrupted" | "error";

export interface RunState {
  blocks: Block[];
  reasoning: { content: string; active: boolean };
  footer: FooterStatus;
  terminal: Terminal;
  errorMsg?: string;
}

export const initialState: RunState = {
  blocks: [],
  reasoning: { content: "", active: false },
  footer: "thinking",
  terminal: "running",
};

function closeStreamingText(blocks: Block[]): Block[] {
  return blocks.map((b) => (b.kind === "text" && b.streaming ? { ...b, streaming: false } : b));
}

export function reduce(state: RunState, evt: AgentEvent): RunState {
  switch (evt.type) {
    case "text": {
      const last = state.blocks[state.blocks.length - 1];
      if (last && last.kind === "text" && last.streaming) {
        return {
          ...state,
          blocks: [...state.blocks.slice(0, -1), { ...last, content: last.content + evt.delta }],
          reasoning: { ...state.reasoning, active: false },
          footer: "streaming",
        };
      }
      return {
        ...state,
        blocks: [...state.blocks, { kind: "text", content: evt.delta, streaming: true }],
        reasoning: { ...state.reasoning, active: false },
        footer: "streaming",
      };
    }

    case "thinking":
      return {
        ...state,
        reasoning: { content: state.reasoning.content + evt.delta, active: true },
        footer: "thinking",
      };

    case "tool_use": {
      const tool: ToolEntry = { id: evt.id, name: evt.name, status: "running", input: evt.input };
      return {
        ...state,
        blocks: [...closeStreamingText(state.blocks), { kind: "tool", tool }],
        reasoning: { ...state.reasoning, active: false },
        footer: "tool_running",
      };
    }

    case "tool_result": {
      const blocks = state.blocks.map((b) => {
        if (b.kind !== "tool" || b.tool.id !== evt.id) return b;
        return {
          ...b,
          tool: {
            ...b.tool,
            status: evt.isError ? ("error" as const) : ("done" as const),
            output: evt.output || undefined,
          },
        };
      });
      return { ...state, blocks };
    }

    case "error":
      return { ...state, terminal: "error", errorMsg: evt.message, footer: null };

    case "done":
      return {
        ...state,
        blocks: closeStreamingText(state.blocks),
        reasoning: { ...state.reasoning, active: false },
        terminal: "done",
        footer: null,
      };

    default:
      return state;
  }
}

export function markInterrupted(state: RunState): RunState {
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: "interrupted",
    footer: null,
  };
}

export function finalizeIfRunning(state: RunState): RunState {
  if (state.terminal !== "running") return state;
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: "done",
    footer: null,
  };
}
