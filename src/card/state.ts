import type { NormalizedEvent } from "../opencode/events.js";

export type RunStatus = "thinking" | "working" | "done" | "error" | "cancelled";

interface TextPartView {
  partID: string;
  text: string;
}

interface ToolPartView {
  partID: string;
  name: string;
  state: string;
}

/**
 * Mutable state assembled from streaming opencode SSE events. The bridge polls
 * `render()` on a throttle to PATCH the underlying Lark card.
 */
export class CardState {
  private status: RunStatus = "thinking";
  private textParts: TextPartView[] = [];
  private reasoningParts: TextPartView[] = [];
  private toolParts: ToolPartView[] = [];
  private errorMsg: string | null = null;
  private startedAt = Date.now();
  private endedAt: number | null = null;
  private dirty = true;
  /** Message IDs known to be from the assistant. We only render parts for these. */
  private readonly assistantMessageIDs = new Set<string>();
  /** Buffer parts that arrive before we learn the message's role. */
  private readonly pendingParts = new Map<string, Extract<NormalizedEvent, { kind: "part" }>[]>();

  constructor(
    private readonly meta: {
      sessionID: string;
      title: string;
      agent?: string;
      model?: string;
    },
  ) {}

  isDirty(): boolean {
    return this.dirty;
  }

  consume(evt: NormalizedEvent): void {
    switch (evt.kind) {
      case "status":
        if (evt.status === "busy") {
          if (this.status === "thinking") this.status = "working";
        } else if (evt.status === "idle" && this.status !== "error" && this.status !== "cancelled") {
          this.status = "done";
          this.endedAt = Date.now();
        }
        this.dirty = true;
        return;
      case "error":
        this.status = "error";
        this.errorMsg = evt.message;
        this.endedAt = Date.now();
        this.dirty = true;
        return;
      case "message":
        if (evt.role === "assistant") {
          this.assistantMessageIDs.add(evt.messageID);
          const pending = this.pendingParts.get(evt.messageID);
          if (pending) {
            for (const p of pending) this.consumePart(p);
            this.pendingParts.delete(evt.messageID);
          }
        }
        return;
      case "part":
        this.consumePart(evt);
        return;
      default:
        return;
    }
  }

  markCancelled(): void {
    this.status = "cancelled";
    this.endedAt = Date.now();
    this.dirty = true;
  }

  finalize(text?: string): void {
    if (this.status !== "error" && this.status !== "cancelled") {
      this.status = "done";
    }
    this.endedAt = this.endedAt ?? Date.now();
    if (text && this.assembledText().length === 0) {
      this.textParts = [{ partID: "final", text }];
    }
    this.dirty = true;
  }

  assembledText(): string {
    return this.textParts.map((p) => p.text).join("");
  }

  render(): unknown {
    this.dirty = false;
    const body = this.bodyMarkdown();
    const headerTemplate = ({
      thinking: "blue",
      working: "blue",
      done: "green",
      error: "red",
      cancelled: "grey",
    } as const)[this.status];

    const elements: unknown[] = [
      {
        tag: "markdown",
        content: body || "_thinking…_",
      },
    ];

    if (this.toolParts.length) {
      elements.push({ tag: "hr" });
      elements.push({
        tag: "markdown",
        content: this.toolParts
          .map((t) => `• \`${t.name}\` _(${t.state})_`)
          .join("\n"),
      });
    }

    const footer = this.footer();
    if (footer) {
      elements.push({ tag: "hr" });
      elements.push({
        tag: "note",
        elements: [{ tag: "plain_text", content: footer }],
      });
    }

    return {
      config: { wide_screen_mode: true },
      header: {
        template: headerTemplate,
        title: { tag: "plain_text", content: this.meta.title },
      },
      elements,
    };
  }

  private bodyMarkdown(): string {
    if (this.status === "error" && this.errorMsg) {
      return `**Error:** ${this.errorMsg}`;
    }
    const lines: string[] = [];
    if (this.reasoningParts.length) {
      const reasoning = this.reasoningParts.map((p) => p.text).join("");
      if (reasoning.trim()) {
        lines.push(`_💭 ${truncate(reasoning, 600)}_`);
        lines.push("");
      }
    }
    const text = this.assembledText();
    if (text) lines.push(text);
    return lines.join("\n");
  }

  private footer(): string {
    const tags: string[] = [];
    if (this.meta.agent) tags.push(`agent: ${this.meta.agent}`);
    if (this.meta.model) tags.push(`model: ${this.meta.model}`);
    const elapsed = this.endedAt
      ? `${((this.endedAt - this.startedAt) / 1000).toFixed(1)}s`
      : `${((Date.now() - this.startedAt) / 1000).toFixed(1)}s…`;
    tags.push(`status: ${this.status}`);
    tags.push(`took: ${elapsed}`);
    return tags.join("  ·  ");
  }

  private consumePart(evt: Extract<NormalizedEvent, { kind: "part" }>): void {
    // Only render parts that belong to assistant messages — opencode emits
    // part events for the user's own echoed message too. If we haven't seen
    // the role yet, buffer until the matching `message.updated` arrives.
    if (!this.assistantMessageIDs.has(evt.messageID)) {
      const buf = this.pendingParts.get(evt.messageID) ?? [];
      buf.push(evt);
      this.pendingParts.set(evt.messageID, buf);
      return;
    }
    if (this.status === "thinking") this.status = "working";
    const text = evt.text ?? "";
    if (evt.partType === "text") {
      this.upsertText(this.textParts, evt.partID, text);
    } else if (evt.partType === "reasoning") {
      this.upsertText(this.reasoningParts, evt.partID, text);
    } else if (evt.partType === "tool") {
      const existing = this.toolParts.find((t) => t.partID === evt.partID);
      const name = evt.toolName ?? "tool";
      const state = evt.toolState ?? "running";
      if (existing) {
        existing.name = name;
        existing.state = state;
      } else {
        this.toolParts.push({ partID: evt.partID, name, state });
      }
    } else {
      // step-start, step-finish, snapshot, etc. — ignored for rendering.
      return;
    }
    this.dirty = true;
  }

  private upsertText(arr: TextPartView[], partID: string, text: string): void {
    const existing = arr.find((p) => p.partID === partID);
    if (existing) {
      existing.text = text;
    } else {
      arr.push({ partID, text });
    }
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}
