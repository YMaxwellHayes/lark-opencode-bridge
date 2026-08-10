/**
 * Cross-platform child-process helpers.
 *
 * Every spawn of a PATH-resolved external command (`lark-cli`, `npm`,
 * `opencode`, …) MUST go through this module instead of `node:child_process`.
 * On Windows, npm global binaries are `.cmd` shims: plain `spawn()` fails with
 * ENOENT (and modern Node refuses `.cmd` without a shell — CVE-2024-27980).
 * `cross-spawn` resolves the shim and escapes arguments correctly.
 */
import crossSpawn from "cross-spawn";
import type { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process";

// cross-spawn is a drop-in replacement for node's spawn/spawnSync, but its
// type declarations drop the stdio-tuple overloads — restore node's signatures.
export const spawn = crossSpawn as unknown as typeof nodeSpawn;
export const spawnSync = crossSpawn.sync as unknown as typeof nodeSpawnSync;

/** Resolve a command on PATH: `which` on POSIX, `where` on Windows. */
export function resolveOnPath(name: string): string | undefined {
  const isWin = process.platform === "win32";
  const finder = isWin ? "where" : "which";
  const res = spawnSync(finder, [name], { encoding: "utf8", env: process.env });
  if (res.status !== 0) return undefined;
  const lines = (res.stdout ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (isWin) {
    // `where` lists the extensionless sh shim before the .cmd — the shim is
    // not runnable by Windows, so prefer an actually executable match.
    const exec = lines.find((l) => /\.(exe|cmd|bat|com)$/i.test(l));
    return exec ?? lines[0];
  }
  return lines[0];
}
