import fs from "node:fs/promises";
import path from "node:path";
import { createLogger } from "../log.js";
import { MEDIA_DIR } from "../paths.js";

const log = createLogger("media.cleanup");

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Remove message attachment dirs under MEDIA_DIR older than maxAgeMs
 * (default 24h). Best-effort; never throws.
 */
export async function pruneOldMedia(maxAgeMs = DEFAULT_MAX_AGE_MS): Promise<number> {
  let removed = 0;
  try {
    const entries = await fs.readdir(MEDIA_DIR, { withFileTypes: true });
    const cutoff = Date.now() - maxAgeMs;
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const dir = path.join(MEDIA_DIR, ent.name);
      try {
        const stat = await fs.stat(dir);
        if (stat.mtimeMs < cutoff) {
          await fs.rm(dir, { recursive: true, force: true });
          removed++;
        }
      } catch {
        // skip
      }
    }
    if (removed) log.info(`pruned ${removed} media dir(s) older than ${maxAgeMs / 3600000}h`);
  } catch {
    // MEDIA_DIR may not exist yet
  }
  return removed;
}
