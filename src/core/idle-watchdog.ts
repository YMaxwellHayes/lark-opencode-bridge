import { createLogger } from "../log.js";

const log = createLogger("idle");

export interface IdleWatchdogOptions {
  /** Minutes without activity before firing. 0 disables. */
  timeoutMinutes: number;
  onTimeout: () => void | Promise<void>;
  /** Poll interval in ms. */
  pollMs?: number;
}

/**
 * Aborts stuck opencode runs when no card/stream activity occurs for
 * timeoutMinutes. Call touch() on every opencode event or card patch.
 */
export class IdleWatchdog {
  private lastActivity = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;

  constructor(private readonly opts: IdleWatchdogOptions) {}

  start(): void {
    if (this.opts.timeoutMinutes <= 0) return;
    this.active = true;
    this.touch();
    const pollMs = this.opts.pollMs ?? 15_000;
    this.timer = setInterval(() => void this.check(), pollMs);
  }

  stop(): void {
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  touch(): void {
    this.lastActivity = Date.now();
  }

  private async check(): Promise<void> {
    if (!this.active || this.opts.timeoutMinutes <= 0) return;
    const limitMs = this.opts.timeoutMinutes * 60_000;
    if (Date.now() - this.lastActivity < limitMs) return;
    log.warn(`idle timeout (${this.opts.timeoutMinutes}m) — aborting run`);
    this.touch(); // avoid re-fire until next run
    await this.opts.onTimeout();
  }
}
