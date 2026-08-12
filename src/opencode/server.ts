import { type ChildProcessByStdio } from "node:child_process";
import { spawn, spawnSync } from "../process/exec.js";
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
const CRASH_WINDOW_MS = 5 * 60_000;
const MAX_CRASHES_PER_WINDOW = 3;
const RESTART_DELAYS_MS = [2_000, 5_000, 15_000];

export class OpencodeServer {
  private proc: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private stopped = false;
  /** True when we attached to an already-running serve (did not spawn). */
  private reused = false;
  /** Timestamps of recent unexpected exits, for crash-loop detection. */
  private crashes: number[] = [];

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

    this.spawnServe();
    await this.waitForReady();
  }

  private spawnServe(): void {
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
      if (!this.stopped) this.handleUnexpectedExit();
    });
    proc.on("error", (err) => {
      log.error(`opencode serve error: ${err.message}`);
    });
  }

  /**
   * opencode serve can be killed by the environment (OOM, or on Windows a
   * crash of the Bun runtime — e.g. endpoint-security DLLs injected into the
   * process are a known segfault cause, oven-sh/bun#20014). Restart with
   * backoff instead of taking the whole bridge down; only give up on a
   * genuine crash loop.
   */
  private handleUnexpectedExit(): void {
    const now = Date.now();
    this.crashes = this.crashes.filter((t) => now - t < CRASH_WINDOW_MS).concat(now);
    if (this.crashes.length >= MAX_CRASHES_PER_WINDOW) {
      log.error(
        `opencode serve crashed ${this.crashes.length} times in ${CRASH_WINDOW_MS / 60_000} min — giving up. ` +
          `这通常是 opencode 自身在本机崩溃（Windows 上常见诱因：终端安全/审计软件注入 DLL 导致 Bun 段错误）。` +
          `请先单独运行 \`opencode serve\` 确认能稳定启动。`,
      );
      process.exit(1);
    }
    const delay = RESTART_DELAYS_MS[Math.min(this.crashes.length - 1, RESTART_DELAYS_MS.length - 1)]!;
    log.warn(`opencode serve died unexpectedly — restarting in ${delay / 1000}s (attempt ${this.crashes.length}/${MAX_CRASHES_PER_WINDOW})`);
    setTimeout(() => {
      if (this.stopped) return;
      this.spawnServe();
      void this.waitForReady()
        .then(() => log.info("opencode serve restarted"))
        .catch((err) => log.error(`opencode serve restart failed: ${(err as Error).message}`));
    }, delay).unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.reused) return;
    if (this.proc && !this.proc.killed) {
      if (process.platform === "win32" && this.proc.pid) {
        // The spawned process may be a cmd wrapper around a .cmd shim; kill
        // the whole tree so `opencode serve` doesn't survive as an orphan
        // holding the port.
        spawnSync("taskkill", ["/pid", String(this.proc.pid), "/t", "/f"], { stdio: "ignore" });
      } else {
        this.proc.kill("SIGTERM");
      }
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
