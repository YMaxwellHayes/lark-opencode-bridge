import fs from "node:fs/promises";
import { ensureHome, SESSIONS_PATH } from "./paths.js";

/** chat_id (oc_xxx) → opencode session id */
export interface SessionState {
  sessions: Record<string, string>;
  /** chat_id → working directory override */
  cwds: Record<string, string>;
  /**
   * chat_ids that were created by `/spawn`. We persist these so that across
   * bridge restarts we still know which groups are bridge-managed (and can
   * therefore skip the "must @mention bot" gate and keep syncing titles).
   */
  spawned: Record<string, SpawnedChatMeta>;
}

/** Per-chat metadata for groups created via `/spawn`. */
export interface SpawnedChatMeta {
  /** Whether we've already synced the opencode session title into the group name. */
  titleSynced?: boolean;
}

const EMPTY: SessionState = { sessions: {}, cwds: {}, spawned: {} };

export class SessionStore {
  private state: SessionState = EMPTY;
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  async load(): Promise<void> {
    if (this.loaded) return;
    await ensureHome();
    try {
      const raw = await fs.readFile(SESSIONS_PATH, "utf8");
      const parsed = JSON.parse(raw) as Partial<SessionState>;
      this.state = {
        sessions: parsed.sessions ?? {},
        cwds: parsed.cwds ?? {},
        spawned: parsed.spawned ?? {},
      };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
      this.state = { sessions: {}, cwds: {}, spawned: {} };
    }
    this.loaded = true;
  }

  getSession(chatId: string): string | undefined {
    return this.state.sessions[chatId];
  }

  setSession(chatId: string, sessionId: string): void {
    this.state.sessions[chatId] = sessionId;
    this.flush();
  }

  clearSession(chatId: string): void {
    delete this.state.sessions[chatId];
    this.flush();
  }

  getCwd(chatId: string): string | undefined {
    return this.state.cwds[chatId];
  }

  setCwd(chatId: string, cwd: string): void {
    this.state.cwds[chatId] = cwd;
    this.flush();
  }

  clearCwd(chatId: string): void {
    delete this.state.cwds[chatId];
    this.flush();
  }

  /** True if the chat was created via `/spawn` and is bridge-managed. */
  isSpawned(chatId: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.state.spawned, chatId);
  }

  getSpawnedMeta(chatId: string): SpawnedChatMeta | undefined {
    return this.state.spawned[chatId];
  }

  markSpawned(chatId: string, meta: SpawnedChatMeta = {}): void {
    this.state.spawned[chatId] = { ...this.state.spawned[chatId], ...meta };
    this.flush();
  }

  setSpawnedTitleSynced(chatId: string, synced: boolean): void {
    if (!this.state.spawned[chatId]) return;
    this.state.spawned[chatId].titleSynced = synced;
    this.flush();
  }

  private flush(): void {
    const snapshot = JSON.stringify(this.state, null, 2) + "\n";
    this.writeQueue = this.writeQueue
      .then(() => fs.writeFile(SESSIONS_PATH, snapshot, "utf8"))
      .catch(() => undefined);
  }
}
