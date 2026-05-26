import fs from "node:fs/promises";
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

export async function registerProcess(entry: Omit<ProcessEntry, "startedAt"> & { startedAt?: string }): Promise<void> {
  await ensureHome();
  const reg = await readRegistry();
  reg.entries = reg.entries.filter((e) => isAlive(e.pid));
  reg.entries.push({
    pid: entry.pid,
    startedAt: entry.startedAt ?? new Date().toISOString(),
    appId: entry.appId,
    label: entry.label,
  });
  await writeRegistry(reg);
}

export async function unregisterProcess(pid: number): Promise<void> {
  const reg = await readRegistry();
  reg.entries = reg.entries.filter((e) => e.pid !== pid);
  await writeRegistry(reg);
}

export async function listProcesses(): Promise<ProcessEntry[]> {
  const reg = await pruneDead(await readRegistry());
  await writeRegistry(reg);
  return reg.entries;
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
  } catch {
    return false;
  }
}

export async function killProcess(pid: number, signal: NodeJS.Signals = "SIGTERM"): Promise<boolean> {
  if (!isAlive(pid)) return false;
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
  await fs.writeFile(PROCESSES_PATH, JSON.stringify(reg, null, 2) + "\n", "utf8");
}

async function pruneDead(reg: ProcessRegistryFile): Promise<ProcessRegistryFile> {
  return { entries: reg.entries.filter((e) => isAlive(e.pid)) };
}
