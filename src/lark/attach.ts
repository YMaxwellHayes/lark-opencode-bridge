import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "../log.js";
import { MEDIA_DIR } from "../paths.js";

const log = createLogger("lark.attach");

export interface AttachmentRef {
  /** Local filesystem path of the downloaded file. */
  filePath: string;
  /** file:// URL that opencode can read. */
  url: string;
  filename: string;
  mime: string;
  size?: number;
}

export interface AttachmentOptions {
  larkCliPath?: string;
  identity: "bot" | "user";
}

export class LarkAttachmentFetcher {
  constructor(private readonly opts: AttachmentOptions) {}

  /**
   * For a Lark message that is `image` or `file` (or post with attachments),
   * resolve the raw content, download each resource into MEDIA_DIR/<msgId>/,
   * and return FilePartInput-ready references.
   *
   * Returns an empty array for unsupported message types or on any failure
   * — callers should still process the text content even if attachments fail.
   */
  /**
   * Fetch plain text from a message by id. Used when the user quotes/replies
   * to another message so we can include the quoted content in the prompt.
   */
  async fetchMessageText(messageId: string): Promise<string | null> {
    try {
      const raw = await this.mget(messageId);
      const text = extractTextFromRawMessage(raw);
      return text.trim() || null;
    } catch (err) {
      log.warn(`mget ${messageId} failed: ${(err as Error).message}`);
      return null;
    }
  }

  async fetch(messageId: string, messageType: string): Promise<AttachmentRef[]> {
    if (!isSupported(messageType)) return [];
    let raw: RawMessage;
    try {
      raw = await this.mget(messageId);
    } catch (err) {
      log.warn(`mget ${messageId} failed: ${(err as Error).message}`);
      return [];
    }

    const refs = collectResourceRefs(raw, messageType);
    if (!refs.length) return [];

    const outDir = path.join(MEDIA_DIR, messageId);
    await fs.mkdir(outDir, { recursive: true });

    const results: AttachmentRef[] = [];
    for (const ref of refs) {
      try {
        const local = await this.download(messageId, ref, outDir);
        results.push(local);
      } catch (err) {
        log.warn(`download ${ref.fileKey} failed: ${(err as Error).message}`);
      }
    }
    return results;
  }

  private async mget(messageId: string): Promise<RawMessage> {
    const args = [
      "im",
      "+messages-mget",
      "--message-ids",
      messageId,
      "--format",
      "json",
      "--as",
      this.opts.identity,
    ];
    const out = await run(this.opts.larkCliPath ?? "lark-cli", args);
    const json = safeJson(out);
    const msg = extractMessage(json);
    if (!msg) {
      log.warn(`mget ${messageId}: could not parse response envelope`);
      return {};
    }
    return msg;
  }

  private async download(
    messageId: string,
    ref: ResourceRef,
    outDir: string,
  ): Promise<AttachmentRef> {
    const filename = sanitiseName(ref.fileName ?? ref.fileKey);
    const safeName = filename || ref.fileKey;
    // lark-cli requires a relative path and rejects absolute paths / '..'.
    // We run the command from a temp cwd = outDir's parent, then write into
    // the message-id subdir; the relative path is `${messageId}/<filename>`.
    const relOut = path.posix.join(path.basename(outDir), safeName);
    const cwd = path.dirname(outDir);

    const args = [
      "im",
      "+messages-resources-download",
      "--message-id",
      messageId,
      "--file-key",
      ref.fileKey,
      "--type",
      ref.type,
      "--output",
      relOut,
      "--as",
      this.opts.identity,
    ];
    await run(this.opts.larkCliPath ?? "lark-cli", args, cwd);

    const absPath = path.join(outDir, safeName);
    const stat = await fs.stat(absPath).catch(() => null);
    return {
      filePath: absPath,
      url: `file://${absPath}`,
      filename: safeName,
      mime: inferMime(safeName, ref.type),
      size: stat?.size,
    };
  }
}

type ResourceType = "image" | "file";

interface ResourceRef {
  fileKey: string;
  type: ResourceType;
  fileName?: string;
}

interface RawMessage {
  message_id?: string;
  msg_type?: string;
  /** lark-cli mget renders plain text here. */
  content?: string;
  body?: { content?: string };
  [key: string]: unknown;
}

function isSupported(type: string): boolean {
  return type === "image" || type === "file" || type === "post";
}

function collectResourceRefs(raw: RawMessage, messageType: string): ResourceRef[] {
  const contentStr = messageContentString(raw);
  if (!contentStr) return [];
  let content: unknown;
  try {
    content = JSON.parse(contentStr);
  } catch {
    return [];
  }
  const refs: ResourceRef[] = [];
  if (messageType === "image") {
    const key = pickString(content, ["image_key"]);
    if (key) refs.push({ fileKey: key, type: "image" });
  } else if (messageType === "file") {
    const key = pickString(content, ["file_key"]);
    if (key) {
      refs.push({
        fileKey: key,
        type: "file",
        fileName: pickString(content, ["file_name"]),
      });
    }
  } else if (messageType === "post") {
    walkPost(content, refs);
  }
  return refs;
}

/**
 * Walk a Lark post content tree, pulling out image_keys / file_keys.
 * The structure varies across versions; this is a best-effort traversal.
 */
function walkPost(node: unknown, refs: ResourceRef[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) walkPost(item, refs);
    return;
  }
  if (typeof node !== "object") return;
  const rec = node as Record<string, unknown>;
  if (rec.tag === "img" && typeof rec.image_key === "string") {
    refs.push({ fileKey: rec.image_key, type: "image" });
  }
  if (rec.tag === "file" && typeof rec.file_key === "string") {
    refs.push({
      fileKey: rec.file_key,
      type: "file",
      fileName: pickString(rec, ["file_name"]),
    });
  }
  for (const value of Object.values(rec)) {
    if (typeof value === "object" && value !== null) walkPost(value, refs);
  }
}

function messageContentString(raw: RawMessage): string | undefined {
  if (typeof raw.content === "string" && raw.content) return raw.content;
  if (typeof raw.body?.content === "string" && raw.body.content) return raw.body.content;
  return undefined;
}

export function extractTextFromRawMessage(raw: RawMessage): string {
  const contentStr = messageContentString(raw);
  if (!contentStr) return "";

  // lark-cli mget already expands post/markdown into plain text.
  if (!contentStr.startsWith("{")) return contentStr;

  let content: unknown;
  try {
    content = JSON.parse(contentStr);
  } catch {
    return contentStr;
  }

  if (typeof content === "object" && content !== null) {
    const rec = content as Record<string, unknown>;
    if (typeof rec.text === "string") return rec.text;
  }

  const postText = flattenPostText(content);
  return postText || contentStr;
}

/** Best-effort extraction of visible text from Lark post/rich-text JSON. */
function flattenPostText(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) {
    return node.map(flattenPostText).filter(Boolean).join("");
  }
  if (typeof node !== "object") return "";
  const rec = node as Record<string, unknown>;
  if (typeof rec.text === "string" && (rec.tag === "text" || rec.tag === "a" || rec.tag === "md")) {
    return rec.text;
  }
  const parts: string[] = [];
  for (const value of Object.values(rec)) {
    const t = flattenPostText(value);
    if (t) parts.push(t);
  }
  return parts.join("\n");
}

function extractMessage(json: unknown): RawMessage | null {
  if (!json) return null;

  const pickFirst = (items: unknown): RawMessage | null => {
    if (!Array.isArray(items) || !items[0] || typeof items[0] !== "object") return null;
    return items[0] as RawMessage;
  };

  if (Array.isArray(json)) return pickFirst(json);
  if (typeof json !== "object") return null;

  const rec = json as Record<string, unknown>;
  const direct = pickFirst(rec.items) ?? pickFirst(rec.messages);
  if (direct) return direct;

  if (rec.data && typeof rec.data === "object") {
    const dataRec = rec.data as Record<string, unknown>;
    const nested = pickFirst(dataRec.items) ?? pickFirst(dataRec.messages);
    if (nested) return nested;
  }

  if (rec.body || rec.content || rec.message_id) return rec as RawMessage;
  return null;
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

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sanitiseName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
}

function inferMime(name: string, type: ResourceType): string {
  const ext = path.extname(name).slice(1).toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    log: "text/plain",
    csv: "text/csv",
    zip: "application/zip",
  };
  if (ext && map[ext]) return map[ext]!;
  return type === "image" ? "image/png" : "application/octet-stream";
}

function run(bin: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on("data", (c) => out.push(c));
    proc.stderr.on("data", (c) => err.push(c));
    proc.on("error", reject);
    proc.on("exit", (code) => {
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      if (code === 0) resolve(stdout);
      else reject(new Error(`${bin} ${args[0]} ${args[1]} (code=${code}): ${stderr.trim() || stdout.trim()}`));
    });
  });
}
