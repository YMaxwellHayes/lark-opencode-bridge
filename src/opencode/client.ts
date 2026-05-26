import { createLogger } from "../log.js";

const log = createLogger("opencode.cli");

export interface ClientOptions {
  baseUrl: string;
  /** Default agent name (e.g. "build"). */
  agent?: string;
  /** Default model id, formatted "providerID/modelID". */
  model?: string;
  /** Request timeout for prompt RPC; opencode runs can take a while. */
  requestTimeoutMs?: number;
}

export interface SessionInfo {
  id: string;
  title?: string;
  directory?: string;
}

export type PromptPart = TextPromptPart | FilePromptPart;

export interface TextPromptPart {
  type: "text";
  text: string;
}

export interface FilePromptPart {
  type: "file";
  mime: string;
  url: string;
  filename?: string;
}

export interface ModelRef {
  providerID: string;
  modelID: string;
}

export interface ProviderModelInfo {
  /** Model id (the part after the `/`). */
  id: string;
  /** Human-readable name; falls back to `id` when missing. */
  name: string;
}

export interface ProviderInfo {
  /** Provider id (the part before the `/`). */
  id: string;
  /** Human-readable provider name; falls back to `id` when missing. */
  name: string;
  models: ProviderModelInfo[];
  /** Default model id for this provider, when reported by opencode. */
  defaultModelId?: string;
}

export interface AgentInfo {
  name: string;
  /** "primary" or "subagent" — kept loose so we tolerate future modes. */
  mode?: string;
  description?: string;
}

export interface MessageSummary {
  id: string;
  /** "user" / "assistant" / etc.; left as string to tolerate future roles. */
  role?: string;
}

export interface PromptOptions {
  sessionId: string;
  parts: PromptPart[];
  agent?: string;
  /** "providerID/modelID" — parsed and forwarded to opencode. */
  model?: string;
  /** Per-prompt tool toggles. Maps tool name → enabled. */
  tools?: Record<string, boolean>;
  /** Abort signal forwarded to fetch. */
  signal?: AbortSignal;
}

export interface PromptResult {
  /** Best-effort plain text reply assembled from text parts. */
  text: string;
  /** Raw response body (assistant message + parts) for debugging. */
  raw: unknown;
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
  }
}

export class OpencodeClient {
  constructor(private readonly opts: ClientOptions) {}

  /**
   * List all opencode sessions visible to this server (the cwd-scoped
   * `GET /session`, not the cross-project `/experimental/session`).
   */
  async listSessions(): Promise<SessionInfo[]> {
    const res = await this.fetchJson("GET", "/session");
    if (!Array.isArray(res)) return [];
    const out: SessionInfo[] = [];
    for (const s of res) {
      if (!s || typeof s !== "object") continue;
      const id = pickString(s, ["id"]);
      if (!id) continue;
      out.push({
        id,
        title: pickString(s, ["title"]),
        directory: pickString(s, ["directory"]),
      });
    }
    return out;
  }

  /** List available agents (`GET /agent`). */
  async listAgents(): Promise<AgentInfo[]> {
    const res = await this.fetchJson("GET", "/agent");
    if (!Array.isArray(res)) return [];
    const out: AgentInfo[] = [];
    for (const a of res) {
      if (!a || typeof a !== "object") continue;
      const name = pickString(a, ["name"]);
      if (!name) continue;
      out.push({
        name,
        mode: pickString(a, ["mode"]),
        description: pickString(a, ["description"]),
      });
    }
    return out;
  }

  /**
   * Compact (a.k.a. `/summarize` in the TUI) the given session. opencode
   * requires the provider/model to use for the summary pass — we resolve it
   * from the chat's current model selection.
   */
  async summarizeSession(
    sessionId: string,
    model: ModelRef,
  ): Promise<void> {
    await this.fetchJson(
      "POST",
      `/session/${encodeURIComponent(sessionId)}/summarize`,
      { providerID: model.providerID, modelID: model.modelID },
    );
  }

  /**
   * Initialise (or refresh) AGENTS.md for the session's cwd. Returns the
   * messageID we asked the server to anchor against, so the caller can show
   * progress / poll for completion.
   */
  async initSession(
    sessionId: string,
    model: ModelRef,
    messageID: string,
  ): Promise<void> {
    await this.fetchJson(
      "POST",
      `/session/${encodeURIComponent(sessionId)}/init`,
      { providerID: model.providerID, modelID: model.modelID, messageID },
    );
  }

  /** Create a public share link for the session; returns the URL when known. */
  async shareSession(sessionId: string): Promise<string | undefined> {
    const res = await this.fetchJson(
      "POST",
      `/session/${encodeURIComponent(sessionId)}/share`,
    );
    return extractShareUrl(res);
  }

  /** Remove the share link. */
  async unshareSession(sessionId: string): Promise<void> {
    await this.fetchJson(
      "DELETE",
      `/session/${encodeURIComponent(sessionId)}/share`,
    );
  }

  /**
   * Revert (undo) the most recent user message. opencode requires the
   * messageID of the message we want to roll back to — we look it up via
   * `/session/{id}/message` and use the last user message.
   */
  async revertSession(sessionId: string, messageID: string): Promise<void> {
    await this.fetchJson(
      "POST",
      `/session/${encodeURIComponent(sessionId)}/revert`,
      { messageID },
    );
  }

  /** Restore all previously reverted messages. */
  async unrevertSession(sessionId: string): Promise<void> {
    await this.fetchJson(
      "POST",
      `/session/${encodeURIComponent(sessionId)}/unrevert`,
    );
  }

  /**
   * Pull the message list for a session, used by `/undo` to find the latest
   * user message id.
   */
  async listMessages(sessionId: string): Promise<MessageSummary[]> {
    const res = await this.fetchJson(
      "GET",
      `/session/${encodeURIComponent(sessionId)}/message`,
    );
    if (!Array.isArray(res)) return [];
    const out: MessageSummary[] = [];
    for (const item of res) {
      if (!item || typeof item !== "object") continue;
      // opencode wraps each entry as { info: { id, role, ... }, parts: [...] }
      const info = (item as Record<string, unknown>).info;
      const target = (info && typeof info === "object" ? info : item) as Record<string, unknown>;
      const id = pickString(target, ["id"]);
      const role = pickString(target, ["role"]);
      if (!id) continue;
      out.push({ id, role });
    }
    return out;
  }

  async createSession(title?: string, directory?: string): Promise<SessionInfo> {
    const search = directory ? `?directory=${encodeURIComponent(directory)}` : "";
    const body = title ? { title } : {};
    const res = await this.fetchJson("POST", `/session${search}`, body);
    const id = pickString(res, ["id"]);
    if (!id) {
      throw new Error(
        `opencode createSession: no id in response: ${JSON.stringify(res).slice(0, 300)}`,
      );
    }
    return {
      id,
      title: pickString(res, ["title"]),
      directory: pickString(res, ["directory"]),
    };
  }

  async deleteSession(id: string): Promise<void> {
    await this.fetchJson("DELETE", `/session/${encodeURIComponent(id)}`);
  }

  async abortSession(id: string): Promise<void> {
    try {
      await this.fetchJson("POST", `/session/${encodeURIComponent(id)}/abort`);
    } catch (err) {
      log.warn(`abort failed: ${(err as Error).message}`);
    }
  }

  /**
   * Enumerate the providers and models opencode currently has configured.
   * Maps to `GET /config/providers`, whose response is:
   *
   * ```json
   * {
   *   "providers": [
   *     { "id": "ccapi", "name": "ccapiv1",
   *       "models": { "qwen3.7-max": { "id": "qwen3.7-max", "name": "qwen3.7-max" } } }
   *   ],
   *   "default": { "ccapi": "qwen3.7-max" }
   * }
   * ```
   */
  async listProviders(): Promise<ProviderInfo[]> {
    const res = await this.fetchJson("GET", "/config/providers");
    if (!res || typeof res !== "object") return [];
    const obj = res as Record<string, unknown>;
    const rawProviders = Array.isArray(obj.providers) ? obj.providers : [];
    const defaults =
      obj.default && typeof obj.default === "object"
        ? (obj.default as Record<string, unknown>)
        : {};

    const result: ProviderInfo[] = [];
    for (const p of rawProviders) {
      if (!p || typeof p !== "object") continue;
      const provider = p as Record<string, unknown>;
      const id = typeof provider.id === "string" ? provider.id : undefined;
      if (!id) continue;
      const name = typeof provider.name === "string" ? provider.name : id;
      const modelsField =
        provider.models && typeof provider.models === "object"
          ? (provider.models as Record<string, unknown>)
          : {};
      const models: ProviderModelInfo[] = [];
      for (const [modelKey, m] of Object.entries(modelsField)) {
        if (!m || typeof m !== "object") {
          models.push({ id: modelKey, name: modelKey });
          continue;
        }
        const mi = m as Record<string, unknown>;
        const modelId = typeof mi.id === "string" ? mi.id : modelKey;
        const modelName = typeof mi.name === "string" ? mi.name : modelId;
        models.push({ id: modelId, name: modelName });
      }
      models.sort((a, b) => a.id.localeCompare(b.id));
      const def = defaults[id];
      result.push({
        id,
        name,
        models,
        defaultModelId: typeof def === "string" ? def : undefined,
      });
    }
    result.sort((a, b) => a.id.localeCompare(b.id));
    return result;
  }

  /**
   * Answer a pending permission request. Leave `directory` unset for the global
   * permission queue emitted by `/event`; it may not be scoped to the session cwd.
   */
  async replyPermission(
    requestID: string,
    reply: "once" | "always" | "reject",
    directory?: string,
  ): Promise<void> {
    const qs = directory ? `?directory=${encodeURIComponent(directory)}` : "";
    await this.fetchJson(
      "POST",
      `/permission/${encodeURIComponent(requestID)}/reply${qs}`,
      { reply },
    );
  }


  async prompt(o: PromptOptions): Promise<PromptResult> {
    const body = this.buildPromptBody(o);
    const path = `/session/${encodeURIComponent(o.sessionId)}/message`;
    const res = await this.fetchJson("POST", path, body, o.signal);
    return { text: extractText(res), raw: res };
  }

  /**
   * Kick off a prompt without holding the HTTP connection open for the
   * lifetime of the run. opencode returns 204 immediately. Callers should
   * watch SSE `/event` for `session.status: idle` to know when the run is
   * complete. Use this for card-mode streaming so a long-running prompt
   * (e.g. one that triggers the `question` tool) doesn't blow Node fetch's
   * default 5-minute idle timeout.
   */
  async promptAsync(o: PromptOptions): Promise<void> {
    const body = this.buildPromptBody(o);
    const path = `/session/${encodeURIComponent(o.sessionId)}/prompt_async`;
    await this.fetchJson("POST", path, body, o.signal);
  }

  private buildPromptBody(o: PromptOptions): Record<string, unknown> {
    const body: Record<string, unknown> = { parts: o.parts };
    const agent = o.agent ?? this.opts.agent;
    const model = parseModel(o.model ?? this.opts.model);
    if (agent) body.agent = agent;
    if (model) body.model = model;
    if (o.tools) body.tools = o.tools;
    return body;
  }

  private async fetchJson(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = `${this.opts.baseUrl}${path}`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (signal) {
      init.signal = signal;
    } else if (this.opts.requestTimeoutMs) {
      init.signal = AbortSignal.timeout(this.opts.requestTimeoutMs);
    }

    log.debug(`${method} ${path}`);
    const res = await fetch(url, init);
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 404 && text.includes("Session not found")) {
        throw new SessionNotFoundError(path);
      }
      throw new Error(
        `opencode ${method} ${path} failed: ${res.status} ${res.statusText} — ${text.slice(0, 400)}`,
      );
    }
    if (!text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { _rawText: text };
    }
  }
}

/**
 * Parse "providerID/modelID" into the structured {providerID, modelID} that
 * opencode expects. Returns undefined if no model is configured.
 */
export function parseModel(input?: string): ModelRef | undefined {
  if (!input) return undefined;
  const idx = input.indexOf("/");
  if (idx <= 0 || idx === input.length - 1) {
    throw new Error(`invalid model "${input}" — expected "providerID/modelID"`);
  }
  return { providerID: input.slice(0, idx), modelID: input.slice(idx + 1) };
}

/**
 * Pull the public URL out of an opencode Session response after `POST share`.
 * The schema is `{share?: {url?: string, ...}, ...}` — we accept either the
 * nested form or a top-level `url` field as a fallback.
 */
function extractShareUrl(res: unknown): string | undefined {
  if (!res || typeof res !== "object") return undefined;
  const r = res as Record<string, unknown>;
  if (r.share && typeof r.share === "object") {
    const u = (r.share as Record<string, unknown>).url;
    if (typeof u === "string") return u;
  }
  if (typeof r.url === "string") return r.url;
  return undefined;
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

/**
 * The prompt response is {info: AssistantMessage, parts: Part[]} where each
 * Part has a discriminated `type`. We collect all `text`-typed parts.
 */
function extractText(res: unknown): string {
  if (!res || typeof res !== "object") return "";
  const partsField = (res as Record<string, unknown>).parts;
  if (!Array.isArray(partsField)) return "";
  const buckets: string[] = [];
  for (const part of partsField) {
    if (
      part &&
      typeof part === "object" &&
      (part as Record<string, unknown>).type === "text" &&
      typeof (part as Record<string, unknown>).text === "string"
    ) {
      buckets.push((part as Record<string, unknown>).text as string);
    }
  }
  return buckets.join("").trim();
}
