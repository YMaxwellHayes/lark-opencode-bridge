import type { Client } from "@larksuiteoapi/node-sdk";
import { createLogger } from "../log.js";
import { createFeishuAppClient } from "./feishu-app-client.js";
import type { LarkCredentials } from "./credentials.js";

const log = createLogger("lark.comm");

export interface CommentFetcherOptions {
  /** Resolved after bridge start — same app as LarkChannel WS. */
  credentials?: LarkCredentials;
}

export interface CommentReply {
  reply_id: string;
  user_id?: string;
  open_id?: string;
  text: string;
  mentions: Array<{ key: string; open_id?: string; name?: string }>;
  raw?: unknown;
}

export interface CommentThread {
  file_token: string;
  comment_id: string;
  quote?: string;
  replies: CommentReply[];
}

const SUPPORTED_FILE_TYPES = new Set(["doc", "docx", "sheet", "file"]);

interface ResolvedTarget {
  fileToken: string;
  fileType: string;
}

interface RawReply {
  reply_id?: string;
  id?: string;
  user_id?: string;
  open_id?: string;
  content?: { elements?: unknown[] };
}

/**
 * Fetch / reply to cloud-doc comment threads via the Feishu SDK (same app as WS).
 */
export class CommentFetcher {
  private client: Client | null = null;

  constructor(private readonly opts: CommentFetcherOptions = {}) {
    if (opts.credentials) this.client = createFeishuAppClient(opts.credentials);
  }

  setCredentials(credentials: LarkCredentials): void {
    this.client = createFeishuAppClient({ ...credentials, quiet: true });
  }

  async fetchThread(
    fileToken: string,
    commentId: string,
    fileType: string,
  ): Promise<CommentThread> {
    const client = this.requireClient();
    const target = await resolveCommentTarget(client, fileToken, fileType);
    return fetchThreadForTarget(client, target, commentId);
  }

  async postReply(
    fileToken: string,
    commentId: string,
    fileType: string,
    text: string,
  ): Promise<void> {
    const client = this.requireClient();
    const target = await resolveCommentTarget(client, fileToken, fileType);
    const url =
      `/open-apis/drive/v1/files/${encodeURIComponent(target.fileToken)}` +
      `/comments/${encodeURIComponent(commentId)}/replies` +
      `?file_type=${encodeURIComponent(target.fileType)}`;
    try {
      await client.request({
        method: "POST",
        url,
        data: {
          content: {
            elements: [{ type: "text_run", text_run: { text } }],
          },
        },
      });
      return;
    } catch (err) {
      const code = apiErrorCode(err);
      if (code !== 1069302) throw err;
      log.warn(`comment ${commentId} rejects thread reply (1069302), posting top-level`);
    }
    await client.request({
      method: "POST",
      url: `/open-apis/drive/v1/files/${encodeURIComponent(target.fileToken)}/comments`,
      params: { file_type: target.fileType },
      data: {
        reply_list: {
          replies: [{ content: { elements: [{ type: "text_run", text_run: { text } }] } }],
        },
      },
    });
  }

  private requireClient(): Client {
    if (!this.client) {
      throw new Error("CommentFetcher not initialized — bridge credentials missing");
    }
    return this.client;
  }
}

async function resolveCommentTarget(
  client: Client,
  fileToken: string,
  fileType: string,
): Promise<ResolvedTarget> {
  const normalized = fileType.trim().toLowerCase();
  if (!SUPPORTED_FILE_TYPES.has(normalized) && normalized !== "wiki") {
    throw new Error(`unsupported file_type=${fileType}`);
  }
  // Only resolve wiki node tokens — docx/doc tokens are already obj_tokens.
  if (normalized === "wiki") {
    const res = await client.wiki.v2.space.getNode({
      params: { token: fileToken, obj_type: "wiki" },
    });
    const node = res.data?.node;
    const objToken = node?.obj_token;
    const objType = node?.obj_type?.toLowerCase();
    if (objToken && objType && SUPPORTED_FILE_TYPES.has(objType)) {
      log.info(`wiki node ${fileToken} → ${objType}/${objToken}`);
      return { fileToken: objToken, fileType: objType };
    }
    throw new Error(`wiki node ${fileToken} could not be resolved to a supported doc type`);
  }
  return { fileToken, fileType: normalized };
}

async function fetchThreadForTarget(
  client: Client,
  target: ResolvedTarget,
  commentId: string,
): Promise<CommentThread> {
  // LIST is more reliable for docx inline comments; GET often returns 1069307.
  const fromList = await findCommentViaList(client, target, commentId);
  if (fromList) {
    log.debug(`thread ${commentId}: ${fromList.replies.length} reply/replies (via list)`);
    return {
      file_token: target.fileToken,
      comment_id: commentId,
      quote: fromList.quote,
      replies: fromList.replies,
    };
  }

  const res = await client.drive.v1.fileComment.get({
    params: { file_type: target.fileType as "doc" | "docx" | "sheet" | "file" },
    path: { file_token: target.fileToken, comment_id: commentId },
  });
  const replies = mapReplies(res.data?.reply_list?.replies);
  log.debug(`thread ${commentId}: ${replies.length} reply/replies (via get)`);
  return {
    file_token: target.fileToken,
    comment_id: commentId,
    quote: typeof res.data?.quote === "string" ? res.data.quote : undefined,
    replies,
  };
}

async function findCommentViaList(
  client: Client,
  target: ResolvedTarget,
  commentId: string,
): Promise<{ quote?: string; replies: CommentReply[] } | null> {
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await client.drive.v1.fileComment.list({
      params: {
        file_type: target.fileType as "doc" | "docx" | "sheet" | "file",
        page_size: 100,
        ...(pageToken ? { page_token: pageToken } : {}),
      },
      path: { file_token: target.fileToken },
    });
    const items = res.data?.items ?? [];
    const hit = items.find((it) => it.comment_id === commentId);
    if (hit) {
      return {
        quote: typeof hit.quote === "string" ? hit.quote : undefined,
        replies: mapReplies(hit.reply_list?.replies),
      };
    }
    if (!res.data?.has_more || !res.data.page_token) break;
    pageToken = res.data.page_token;
  }
  return null;
}

function mapReplies(raw: RawReply[] | undefined): CommentReply[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => flattenReply(r));
}

function flattenReply(r: RawReply): CommentReply {
  const replyId = typeof r.reply_id === "string" ? r.reply_id : typeof r.id === "string" ? r.id : "";
  const content = r.content ?? {};
  const elements = Array.isArray(content.elements) ? content.elements : [];

  const parts: string[] = [];
  const mentions: CommentReply["mentions"] = [];
  for (const el of elements) {
    if (!el || typeof el !== "object") continue;
    const rec = el as Record<string, unknown>;
    if (rec.type === "text_run") {
      const tr = rec.text_run as Record<string, unknown> | undefined;
      parts.push(typeof tr?.text === "string" ? tr.text : "");
    } else if (rec.type === "at") {
      const at = rec.at as Record<string, unknown> | undefined;
      const openId = typeof at?.user_id === "string" ? at.user_id : undefined;
      const name = typeof at?.name === "string" ? at.name : undefined;
      const key = typeof at?.key === "string" ? at.key : "@user";
      mentions.push({ key, open_id: openId, name });
      parts.push(name ? `@${name}` : "@");
    } else if (rec.type === "docs_link") {
      const link = rec.docs_link as Record<string, unknown> | undefined;
      parts.push(typeof link?.url === "string" ? link.url : "");
    }
  }

  return {
    reply_id: replyId,
    user_id: typeof r.user_id === "string" ? r.user_id : undefined,
    open_id: typeof r.open_id === "string" ? r.open_id : undefined,
    text: parts.join("").trim(),
    mentions,
    raw: r,
  };
}

function apiErrorCode(err: unknown): number | undefined {
  const rec = err as { response?: { data?: { code?: number } } };
  return rec.response?.data?.code;
}
