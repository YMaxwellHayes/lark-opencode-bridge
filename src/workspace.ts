import fs from "node:fs/promises";
import path from "node:path";
import { ensureHome, WORKSPACES_PATH } from "./paths.js";

export interface Workspace {
  name: string;
  path: string;
  createdAt: string;
}

interface WorkspaceFile {
  workspaces: Record<string, Omit<Workspace, "name">>;
}

const EMPTY: WorkspaceFile = { workspaces: {} };

export class WorkspaceStore {
  private state: WorkspaceFile = EMPTY;
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  async load(): Promise<void> {
    if (this.loaded) return;
    await ensureHome();
    try {
      const raw = await fs.readFile(WORKSPACES_PATH, "utf8");
      const parsed = JSON.parse(raw) as Partial<WorkspaceFile>;
      this.state = { workspaces: parsed.workspaces ?? {} };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
      this.state = { workspaces: {} };
    }
    this.loaded = true;
  }

  list(): Workspace[] {
    return Object.entries(this.state.workspaces)
      .map(([name, info]) => ({ name, ...info }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): Workspace | undefined {
    const entry = this.state.workspaces[name];
    return entry ? { name, ...entry } : undefined;
  }

  save(name: string, dir: string): Workspace {
    const resolved = path.resolve(dir);
    const next: Omit<Workspace, "name"> = {
      path: resolved,
      createdAt: this.state.workspaces[name]?.createdAt ?? new Date().toISOString(),
    };
    this.state.workspaces[name] = next;
    this.flush();
    return { name, ...next };
  }

  remove(name: string): boolean {
    if (!(name in this.state.workspaces)) return false;
    delete this.state.workspaces[name];
    this.flush();
    return true;
  }

  private flush(): void {
    const snapshot = JSON.stringify(this.state, null, 2) + "\n";
    this.writeQueue = this.writeQueue
      .then(() => fs.writeFile(WORKSPACES_PATH, snapshot, "utf8"))
      .catch(() => undefined);
  }
}

const NAME_RE = /^[A-Za-z0-9._-]{1,40}$/;

/**
 * Validate a workspace name. Throws if invalid.
 */
export function validateWorkspaceName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(
      `invalid workspace name "${name}" — use 1–40 chars of letters/digits/._-`,
    );
  }
}
