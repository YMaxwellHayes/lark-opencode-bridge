/**
 * Manual smoke test for OpencodeClient against a running `opencode serve`.
 * Not wired into the build — invoke with `node --experimental-strip-types`
 * or compile and run dist artefact, e.g.:
 *
 *   /Users/dojo/.opencode/bin/opencode serve --port 4096 &
 *   npm run build
 *   node -e "import('./dist/cli.js')"  # just to confirm bundle loads
 *
 * For the real check (creates a session, then deletes it):
 *
 *   PATH=$HOME/.opencode/bin:$PATH node --import tsx src/scripts/smoke-client.ts
 */
import { OpencodeClient } from "../opencode/client.js";

async function main(): Promise<void> {
  const baseUrl = process.env.OPENCODE_URL ?? "http://127.0.0.1:4096";
  const client = new OpencodeClient({ baseUrl, requestTimeoutMs: 30_000 });

  console.log(`→ creating session against ${baseUrl}`);
  const session = await client.createSession("smoke-test", process.cwd());
  console.log("✓ session:", session);

  console.log("→ deleting session");
  await client.deleteSession(session.id);
  console.log("✓ deleted");
}

main().catch((err) => {
  console.error("✗", err);
  process.exit(1);
});
