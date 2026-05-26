import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { LOG_DIR } from "./paths.js";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const LOG_RETENTION_DAYS = Math.max(
  1,
  Number(process.env.LARK_OPENCODE_LOG_DAYS ?? 7) || 7,
);

export interface JsonLogEntry {
  ts: string;
  level: Level;
  scope: string;
  msg: string;
  extra?: unknown;
}

function currentLevel(): number {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase() as Level;
  return LEVEL_ORDER[raw] ?? LEVEL_ORDER.info;
}

function nowIso(): string {
  return new Date().toISOString();
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── JSONL file writer (full audit log, no level filter) ──────────────────────

let stream: WriteStream | null = null;
let streamDate: string | null = null;

function getStream(): WriteStream | null {
  const today = ymd(new Date());
  if (stream && streamDate === today) return stream;
  if (stream) {
    try {
      stream.end();
    } catch {
      // ignore
    }
  }
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    stream = createWriteStream(path.join(LOG_DIR, `${today}.log`), { flags: "a" });
    streamDate = today;
    return stream;
  } catch {
    return null;
  }
}

function appendJsonLog(entry: JsonLogEntry): void {
  const s = getStream();
  if (!s) return;
  try {
    s.write(JSON.stringify(entry) + "\n");
  } catch {
    // silent — logging must never crash the bridge
  }
}

/**
 * Remove log files older than LOG_RETENTION_DAYS (default 7, override via
 * LARK_OPENCODE_LOG_DAYS env var). Call on startup; best-effort.
 */
export async function pruneOldLogs(): Promise<void> {
  try {
    const files = await readdir(LOG_DIR);
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 86_400_000;
    for (const f of files) {
      if (!/^\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const fileTime = new Date(`${f.slice(0, 10)}T00:00:00Z`).getTime();
      if (Number.isFinite(fileTime) && fileTime < cutoff) {
        await rm(path.join(LOG_DIR, f), { force: true }).catch(() => undefined);
      }
    }
  } catch {
    // best effort
  }
}

/**
 * Read the last `limit` JSONL entries from today's and yesterday's log
 * files. Optionally filter by level. Used by /doctor.
 */
export async function recentLogEntries(
  limit = 200,
  levelFilter?: ReadonlySet<Level>,
): Promise<JsonLogEntry[]> {
  const today = ymd(new Date());
  const yesterday = ymd(new Date(Date.now() - 86_400_000));
  const entries: JsonLogEntry[] = [];
  for (const day of [yesterday, today]) {
    try {
      const raw = await readFile(path.join(LOG_DIR, `${day}.log`), "utf8");
      for (const line of raw.split("\n")) {
        if (!line) continue;
        try {
          const e = JSON.parse(line) as JsonLogEntry;
          if (!levelFilter || levelFilter.has(e.level)) entries.push(e);
        } catch {
          // skip non-JSON lines
        }
      }
    } catch {
      // file doesn't exist — skip
    }
  }
  return entries.slice(-limit);
}

// ─── stdout / stderr writer ───────────────────────────────────────────────────

function write(level: Level, scope: string, msg: string, extra?: unknown): void {
  const entry: JsonLogEntry = { ts: nowIso(), level, scope, msg };
  if (extra !== undefined) entry.extra = extra;
  appendJsonLog(entry);

  if (LEVEL_ORDER[level] < currentLevel()) return;
  const line = `[${entry.ts}] ${level.toUpperCase().padEnd(5)} ${scope.padEnd(14)} ${msg}`;
  const out = level === "error" || level === "warn" ? process.stderr : process.stdout;
  out.write(line + "\n");
  if (extra !== undefined) {
    out.write(typeof extra === "string" ? extra + "\n" : JSON.stringify(extra) + "\n");
  }
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => write("debug", scope, msg, extra),
    info: (msg: string, extra?: unknown) => write("info", scope, msg, extra),
    warn: (msg: string, extra?: unknown) => write("warn", scope, msg, extra),
    error: (msg: string, extra?: unknown) => write("error", scope, msg, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;
