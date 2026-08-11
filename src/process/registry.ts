import fs from "node:fs/promises";
import { spawnSync } from "./exec.js";
import { PROCESSES_PATH, ensureHome } from "../paths.js";
import { createLogger } from "../log.js";

const log = createLogger("process");

export interface ProcessEntry {
  pid: number;
  startedAt: string;
  appId?: string;
  label: string;
}

interface ProcessRegistryFile {
  entries: ProcessEntry[];
}

// Serialise mutations through a single in-process promise chain so two async
// callers in the same bridge don't trample each other. Cross-process is
// handled by writing atomically via a temp file + rename.
let mutationQueue: Promise<unknown> = Promise.resolve();

function mutate<T>(fn: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(() => fn());
  // Swallow the result for the queue; T is returned to the caller.
  mutationQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function registerProcess(entry: Omit<ProcessEntry, "startedAt"> & { startedAt?: string }): Promise<void> {
  await ensureHome();
  await mutate(async () => {
    const reg = await readRegistry();
    reg.entries = reg.entries.filter((e) => isAlive(e.pid));
    reg.entries.push({
      pid: entry.pid,
      startedAt: entry.startedAt ?? new Date().toISOString(),
      appId: entry.appId,
      label: entry.label,
    });
    await writeRegistry(reg);
  });
}

export async function unregisterProcess(pid: number): Promise<void> {
  await mutate(async () => {
    const reg = await readRegistry();
    reg.entries = reg.entries.filter((e) => e.pid !== pid);
    await writeRegistry(reg);
  });
}

export async function listProcesses(): Promise<ProcessEntry[]> {
  return mutate(async () => {
    const reg = await pruneDead(await readRegistry());
    await writeRegistry(reg);
    return reg.entries;
  });
}

export async function findConflicts(appId?: string): Promise<ProcessEntry[]> {
  const alive = await listProcesses();
  if (!appId) return alive.filter((e) => e.pid !== process.pid);
  return alive.filter((e) => e.appId === appId && e.pid !== process.pid);
}

export function isAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = the process exists but we lack permission to signal it —
    // treating it as dead would let a second instance start alongside it.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function killProcess(pid: number, signal: NodeJS.Signals = "SIGTERM"): Promise<boolean> {
  if (!isAlive(pid)) return false;
  // Windows has no signals or process groups: process.kill is an immediate
  // TerminateProcess on the one pid, leaving children (e.g. an opencode serve
  // spawned via a cmd wrapper) orphaned. taskkill /T kills the whole tree.
  if (process.platform === "win32") {
    const res = spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { encoding: "utf8" });
    if (res.status === 0) return true;
    log.warn(`taskkill ${pid} failed: ${(res.stderr || res.stdout || "").trim()}`);
    return false;
  }
  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    log.warn(`kill ${pid} failed: ${(err as Error).message}`);
    return false;
  }
}

async function readRegistry(): Promise<ProcessRegistryFile> {
  await ensureHome();
  try {
    const raw = await fs.readFile(PROCESSES_PATH, "utf8");
    const parsed = JSON.parse(raw) as ProcessRegistryFile;
    return { entries: parsed.entries ?? [] };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { entries: [] };
    }
    throw err;
  }
}

async function writeRegistry(reg: ProcessRegistryFile): Promise<void> {
  // Atomic: write to a temp file in the same dir, then rename. rename(2) is
  // atomic on POSIX within the same filesystem, so concurrent readers never
  // see a half-written JSON.
  const tmp = `${PROCESSES_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(reg, null, 2) + "\n", "utf8");
  try {
    await fs.rename(tmp, PROCESSES_PATH);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

async function pruneDead(reg: ProcessRegistryFile): Promise<ProcessRegistryFile> {
  return { entries: reg.entries.filter((e) => isAlive(e.pid)) };
}
