import type { LarkChannel } from "@larksuiteoapi/node-sdk";
import { createLogger } from "../log.js";

const log = createLogger("lark.keepalive");

export interface KeepaliveOptions {
  channel: () => LarkChannel | null;
  intervalMs?: number;
  /** Called when the WS appears disconnected for longer than staleMs. */
  onStale?: () => void;
  staleMs?: number;
}

/**
 * Periodically inspect LarkChannel.getConnectionStatus() and log warnings
 * when the WebSocket has been unhealthy for too long.
 */
export class WsKeepalive {
  private timer: ReturnType<typeof setInterval> | null = null;
  private staleSince: number | null = null;

  constructor(private readonly opts: KeepaliveOptions) {}

  start(): void {
    const intervalMs = this.opts.intervalMs ?? 30_000;
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const ch = this.opts.channel();
    if (!ch) return;
    const status = ch.getConnectionStatus();
    if (!status) return;

    const state = status.state ?? "unknown";
    const healthy = state === "connected";
    if (healthy) {
      this.staleSince = null;
      return;
    }

    const now = Date.now();
    if (!this.staleSince) {
      this.staleSince = now;
      log.warn(`websocket unhealthy: state=${state}`);
      return;
    }

    const staleMs = this.opts.staleMs ?? 120_000;
    if (now - this.staleSince >= staleMs) {
      log.error(`websocket stale for ${Math.round((now - this.staleSince) / 1000)}s`);
      this.opts.onStale?.();
      this.staleSince = now; // throttle onStale
    }
  }
}
