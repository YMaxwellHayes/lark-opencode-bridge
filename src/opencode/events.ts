import { EventEmitter } from "node:events";
import { createLogger } from "../log.js";

const log = createLogger("opencode.evt");

/** Raw envelope emitted by opencode's `GET /event` SSE stream. */
export interface RawOpencodeEvent {
  type: string;
  properties: Record<string, unknown>;
}

/** Normalized events the bridge cares about (one per SSE message). */
export type NormalizedEvent =
  | { kind: "connected" }
  | {
      kind: "message";
      sessionID: string;
      messageID: string;
      role: "user" | "assistant" | string;
    }
  | {
      kind: "part";
      sessionID: string;
      messageID: string;
      partID: string;
      partType: string;
      text?: string;
      delta?: string;
      toolName?: string;
      toolState?: string;
      toolInput?: Record<string, unknown>;
    }
  | { kind: "status"; sessionID: string; status: string }
  | {
      /** Fired when a tool call needs the user to approve / reject. */
      kind: "permission";
      sessionID: string;
      requestID: string;
    }
  | { kind: "error"; sessionID?: string; message: string }
  | { kind: "raw"; envelope: RawOpencodeEvent };

export interface SubscribeOptions {
  baseUrl: string;
  /** When set, only events whose payload mentions this sessionID are forwarded. */
  sessionID?: string;
  /** Forward all events unfiltered (overrides sessionID filter). */
  noFilter?: boolean;
}

/**
 * Subscribes to opencode's SSE event stream. Use `.on("event", fn)` for
 * normalized events and `.on("raw", env)` for everything. Call `close()` to
 * abort.
 */
export class OpencodeEventStream extends EventEmitter {
  private controller = new AbortController();
  private closed = false;

  constructor(private readonly opts: SubscribeOptions) {
    super();
  }

  async start(): Promise<void> {
    const url = `${this.opts.baseUrl}/event`;
    log.debug(`SSE → ${url} (session=${this.opts.sessionID ?? "*"})`);
    const res = await fetch(url, {
      headers: { accept: "text/event-stream" },
      signal: this.controller.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`opencode SSE ${url} failed: ${res.status} ${res.statusText}`);
    }
    void this.pump(res.body);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
  }

  private async pump(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf8");
    let buffer = "";
    try {
      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        // SSE messages are delimited by double newlines.
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          this.handleBlock(block);
        }
      }
    } catch (err: unknown) {
      if (!this.closed) {
        const msg = (err as Error)?.message ?? String(err);
        log.warn(`SSE pump error: ${msg}`);
        this.emit("event", { kind: "error", message: msg } satisfies NormalizedEvent);
      }
    } finally {
      this.emit("close");
    }
  }

  private handleBlock(block: string): void {
    const lines = block.split("\n");
    let dataLine: string | null = null;
    for (const raw of lines) {
      const line = raw.replace(/^\r$|\r$/g, "");
      if (line.startsWith("data:")) {
        dataLine = (dataLine ?? "") + line.slice(5).trimStart();
      }
    }
    if (!dataLine) return;
    if (dataLine === "[DONE]") return;
    let envelope: RawOpencodeEvent;
    try {
      envelope = JSON.parse(dataLine) as RawOpencodeEvent;
    } catch {
      log.debug(`non-JSON SSE: ${dataLine.slice(0, 100)}`);
      return;
    }
    this.emit("raw", envelope);
    const norm = normalize(envelope);
    if (!norm) return;
    if (!this.opts.noFilter && this.opts.sessionID && !this.matchesSession(norm)) {
      return;
    }
    this.emit("event", norm);
  }

  private matchesSession(evt: NormalizedEvent): boolean {
    const target = this.opts.sessionID;
    if (!target) return true;
    switch (evt.kind) {
      case "message":
      case "part":
      case "status":
      case "permission":
        return evt.sessionID === target;
      case "error":
        return !evt.sessionID || evt.sessionID === target;
      case "connected":
      case "raw":
        return true;
    }
  }
}

function normalize(env: RawOpencodeEvent): NormalizedEvent | null {
  if (env.type === "server.connected") return { kind: "connected" };

  if (env.type === "message.updated") {
    const info = (env.properties as { info?: Record<string, unknown> }).info;
    if (!info) return null;
    const sessionID = typeof info.sessionID === "string" ? info.sessionID : undefined;
    const messageID = typeof info.id === "string" ? info.id : undefined;
    const role = typeof info.role === "string" ? info.role : undefined;
    if (!sessionID || !messageID || !role) return null;
    return { kind: "message", sessionID, messageID, role };
  }

  if (env.type === "session.status") {
    const sessionID = pickString(env.properties, ["sessionID"]);
    const status =
      pickString(env.properties, ["status", "type"]) ??
      pickString(env.properties, ["status"]) ??
      "unknown";
    if (!sessionID) return null;
    return { kind: "status", sessionID, status };
  }

  if (env.type === "session.error" || env.type === "error") {
    const sessionID = pickString(env.properties, ["sessionID"]);
    const message =
      pickString(env.properties, ["error", "message"]) ??
      pickString(env.properties, ["message"]) ??
      JSON.stringify(env.properties).slice(0, 200);
    return { kind: "error", sessionID, message };
  }

  if (env.type === "permission.asked") {
    const props = env.properties as Record<string, unknown>;
    const sessionID = typeof props.sessionID === "string" ? props.sessionID : undefined;
    const requestID = typeof props.id === "string" ? props.id : undefined;
    const permission = typeof props.permission === "string" ? props.permission : "(unknown)";
    log.info(`permission.asked: requestID=${requestID} permission=${permission}`);
    if (!sessionID || !requestID) return null;
    return { kind: "permission", sessionID, requestID };
  }

  if (env.type === "message.part.updated") {
    const part = (env.properties as { part?: Record<string, unknown> }).part;
    if (!part) return null;
    const sessionID = typeof part.sessionID === "string" ? part.sessionID : undefined;
    const messageID = typeof part.messageID === "string" ? part.messageID : undefined;
    const partID = typeof part.id === "string" ? part.id : undefined;
    const partType = typeof part.type === "string" ? part.type : undefined;
    if (!sessionID || !messageID || !partID || !partType) return null;
    const toolInput = part.input ?? part.args ?? part.params;
    return {
      kind: "part",
      sessionID,
      messageID,
      partID,
      partType,
      text: typeof part.text === "string" ? part.text : undefined,
      delta: pickString(env.properties, ["delta"]),
      toolName: pickString(part, ["tool"]),
      toolState: pickString(part, ["state", "status"]) ?? pickString(part, ["state"]),
      toolInput: toolInput && typeof toolInput === "object" ? toolInput as Record<string, unknown> : undefined,
    };
  }

  return { kind: "raw", envelope: env };
}

function pickString(obj: unknown, path: string[]): string | undefined {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur && typeof cur === "object" && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}
