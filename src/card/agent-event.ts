import type { NormalizedEvent } from "../opencode/events.js";

/** Normalized agent event consumed by RunState's reduce() function. */
export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_use"; id: string; name: string; input?: Record<string, unknown> }
  | { type: "tool_result"; id: string; output: string; isError: boolean }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * Translates opencode SSE events (cumulative full-text updates) into
 * stream-of-deltas AgentEvents consumed by RunState's reduce().
 *
 * Only emits events for assistant-role messages. Parts that arrive before
 * their parent message.updated event are buffered until the role is known.
 */
export class OpencodeAgentAdapter {
  private readonly textVersions = new Map<string, string>();
  private readonly seenTools = new Set<string>();
  private sawBusy = false;
  /** messageID → role (populated by message.updated SSE events) */
  private readonly messageRoles = new Map<string, string>();
  /** messageID → buffered AgentEvents (role not yet known) */
  private readonly pendingParts = new Map<string, AgentEvent[]>();

  translate(evt: NormalizedEvent, sessionID: string): AgentEvent[] {
    if (evt.kind === "status") {
      if (evt.sessionID !== sessionID) return [];
      if (evt.status === "busy") {
        this.sawBusy = true;
        return [];
      }
      if (this.sawBusy && evt.status === "idle") return [{ type: "done" }];
      return [];
    }
    if (evt.kind === "error") {
      return [{ type: "error", message: evt.message ?? "unknown error" }];
    }
    if (evt.kind === "message" && evt.sessionID === sessionID) {
      this.messageRoles.set(evt.messageID, evt.role);
      if (evt.role === "assistant") {
        // Drain any parts that arrived before this message.updated event.
        const buffered = this.pendingParts.get(evt.messageID) ?? [];
        this.pendingParts.delete(evt.messageID);
        return buffered;
      }
      // User / system message — discard any buffered parts for it.
      this.pendingParts.delete(evt.messageID);
      return [];
    }
    if (evt.kind === "part" && evt.sessionID === sessionID) {
      const role = this.messageRoles.get(evt.messageID);
      if (role === undefined) {
        // Role not yet known — buffer translated events until message.updated arrives.
        const translated = this.translatePart(evt);
        if (translated.length > 0) {
          const buf = this.pendingParts.get(evt.messageID) ?? [];
          buf.push(...translated);
          this.pendingParts.set(evt.messageID, buf);
        }
        return [];
      }
      if (role !== "assistant") return [];
      return this.translatePart(evt);
    }
    return [];
  }

  private translatePart(evt: Extract<NormalizedEvent, { kind: "part" }>): AgentEvent[] {
    const { partID, partType, text = "", delta, toolName, toolState } = evt;

    if (partType === "text" || partType === "reasoning") {
      // Prefer the SSE delta field; fall back to computing delta from cumulative text.
      let d = delta ?? "";
      if (!d) {
        const prev = this.textVersions.get(partID) ?? "";
        d = text.startsWith(prev) ? text.slice(prev.length) : text;
      }
      this.textVersions.set(partID, text);
      if (!d) return [];
      return [{ type: partType === "text" ? "text" : "thinking", delta: d }];
    }

    if (partType === "tool") {
      const events: AgentEvent[] = [];
      if (!this.seenTools.has(partID)) {
        this.seenTools.add(partID);
        events.push({ type: "tool_use", id: partID, name: toolName ?? "tool", input: evt.toolInput });
      }
      const isDone =
        toolState === "done" || toolState === "completed" || toolState === "success";
      const isError = toolState === "error" || toolState === "failed";
      if (isDone || isError) {
        events.push({ type: "tool_result", id: partID, output: text, isError });
      }
      return events;
    }

    return [];
  }
}
