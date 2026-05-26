import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { createLogger } from "../log.js";

const log = createLogger("opencode.srv");

export interface ServeOptions {
  port: number;
  host: string;
  /** Override the opencode binary on $PATH. */
  opencodePath?: string;
  /** Max ms to wait for the server to accept TCP connections after spawn. */
  readyTimeoutMs?: number;
}

/**
 * Manages a child `opencode serve` process. Use `start()` to spawn and wait
 * for the HTTP listener to be ready before returning.
 */
export class OpencodeServer {
  private proc: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private stopped = false;
  /** True when we attached to an already-running serve (did not spawn). */
  private reused = false;

  constructor(private readonly opts: ServeOptions) {}

  get baseUrl(): string {
    return `http://${this.opts.host}:${this.opts.port}`;
  }

  async start(): Promise<void> {
    if (this.proc || this.reused) return;

    if (await this.isReachable()) {
      this.reused = true;
      log.info(`reusing existing opencode serve at ${this.baseUrl}`);
      return;
    }

    const bin = this.opts.opencodePath ?? "opencode";
    const args = ["serve", "--port", String(this.opts.port), "--hostname", this.opts.host];
    log.info(`spawn ${bin} ${args.join(" ")}`);
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    this.proc = proc;

    proc.stdout.on("data", (c: Buffer) => log.debug(c.toString("utf8").trim()));
    proc.stderr.on("data", (c: Buffer) => log.warn(c.toString("utf8").trim()));
    proc.on("exit", (code, signal) => {
      log.warn(`opencode serve exited (code=${code}, signal=${signal})`);
      this.proc = null;
      if (!this.stopped) {
        log.error("opencode serve died unexpectedly — bridge will exit");
        process.exit(1);
      }
    });
    proc.on("error", (err) => {
      log.error(`opencode serve error: ${err.message}`);
    });

    await this.waitForReady();
  }

  stop(): void {
    this.stopped = true;
    if (this.reused) return;
    if (this.proc && !this.proc.killed) {
      this.proc.kill("SIGTERM");
    }
    this.proc = null;
  }

  private async isReachable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/doc`, { signal: AbortSignal.timeout(2000) });
      return res.ok || res.status === 404;
    } catch {
      return false;
    }
  }

  private async waitForReady(): Promise<void> {
    const deadline = Date.now() + (this.opts.readyTimeoutMs ?? 15_000);
    while (Date.now() < deadline) {
      if (await this.isReachable()) {
        log.info(`opencode serve ready at ${this.baseUrl}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(
      `opencode serve did not become ready at ${this.baseUrl} (is port ${this.opts.port} in use?)`,
    );
  }
}
