import { createLogger } from "../log.js";
import type { LarkMessageEvent } from "../lark/types.js";

const log = createLogger("queue");

export interface PendingQueueOptions {
  /** Ms to wait after the last message before flushing a batch. */
  batchMs: number;
  onFlush: (events: LarkMessageEvent[]) => Promise<void>;
  /** Called when a new message arrives while a run is in-flight. */
  onPreempt?: () => void;
}

/**
 * Per-chat message batching. Rapid messages within batchMs are merged into
 * one dispatch; each new arrival while waiting resets the timer and triggers
 * preempt so the in-flight opencode run is aborted once, not N times.
 */
export class ChatPendingQueue {
  private pending: LarkMessageEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  constructor(private readonly opts: PendingQueueOptions) {}

  enqueue(evt: LarkMessageEvent): void {
    this.pending.push(evt);
    if (this.opts.onPreempt) this.opts.onPreempt();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.opts.batchMs);
  }

  /** Immediately flush any pending messages (e.g. on shutdown). */
  async drain(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  private async flush(): Promise<void> {
    this.timer = null;
    if (this.flushing || !this.pending.length) return;
    this.flushing = true;
    const batch = this.pending.splice(0);
    log.info(`flushing batch of ${batch.length} message(s)`);
    try {
      await this.opts.onFlush(batch);
    } catch (err) {
      log.error(`batch flush failed: ${(err as Error).message}`);
    } finally {
      this.flushing = false;
      if (this.pending.length) void this.flush();
    }
  }
}
