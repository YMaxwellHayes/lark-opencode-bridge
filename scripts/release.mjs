#!/usr/bin/env node
// One-shot release: bump → test → build → commit → tag → push (all remotes)
// → GitHub Release → npm publish → Feishu group card broadcast.
//
// Usage:
//   npm run release -- patch          # 0.1.10 → 0.1.11
//   npm run release -- minor          # 0.1.10 → 0.2.0
//   npm run release -- major          # 0.1.10 → 1.0.0
//   npm run release -- 0.3.0          # explicit version
//   npm run release -- patch --dry    # print the plan, change nothing
//   npm run release -- patch --no-card # skip the Feishu group broadcast
//
// Precondition: the working tree is clean AND CHANGELOG.md already has a
// `## [<new-version>]` section (release notes are pulled from it). The script
// refuses to run otherwise, so notes stay human-written and consistent.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "YMaxwellHayes/lark-opencode-bridge";
const REMOTES = ["origin", "gitlab"]; // pushed to every one that exists

// Feishu announcement (broadcast a release card to the group after publishing).
// Sent as the opencode-bot itself (TAT): the bot must be a MEMBER of the group.
// User-token (UAT) sending is not allowed for external/cross-tenant chats, so a
// bot-in-the-group is the only reliable path for the public 交流群.
const FEISHU_GROUP = "oc_4b18b1462f152295d66b48a7e190e286"; // lark-opencode-bridge 交流群
const FEISHU_PROFILE = "opencode-bot"; // app that owns the group's bot (cli_aa9941...)
const FEISHU_IDENTITY = "bot"; // bot must be added to the group first
const KB_URL = "https://liulishuo.feishu.cn/wiki/ZahKwFsJQiGnYVkHw76crxVPnUL";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const NO_CARD = args.includes("--no-card");
const bumpArg = args.find((a) => !a.startsWith("-"));

function die(msg) {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
}
function step(msg) {
  console.log(`\x1b[36m▶ ${msg}\x1b[0m`);
}
function run(cmd, opts = {}) {
  if (DRY) {
    console.log(`  [dry] ${cmd}`);
    return "";
  }
  return execSync(cmd, { cwd: ROOT, stdio: "inherit", ...opts });
}
function capture(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
}

if (!bumpArg) die("missing bump arg — use: patch | minor | major | x.y.z");

// ── resolve next version ───────────────────────────────────────────────────
const pkgPath = join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const cur = pkg.version;

function bump(v, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [maj, min, pat] = v.split(".").map(Number);
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  if (kind === "patch") return `${maj}.${min}.${pat + 1}`;
  die(`invalid bump "${kind}"`);
}
const next = bump(cur, bumpArg);
const tag = `v${next}`;
console.log(`\nRelease: \x1b[1m${cur} → ${next}\x1b[0m  (tag ${tag})${DRY ? "  [DRY RUN]" : ""}\n`);

// ── preconditions ──────────────────────────────────────────────────────────
function check(cond, msg) {
  if (!cond) return;
  if (DRY) console.warn(`  \x1b[33m! ${msg} (ignored in --dry)\x1b[0m`);
  else die(msg);
}

step("checking working tree is clean");
check(capture("git status --porcelain"), "working tree not clean — commit or stash first");

step(`checking tag ${tag} does not already exist`);
check(capture("git tag --list").split("\n").includes(tag), `tag ${tag} already exists`);

// ── pull release notes from CHANGELOG ──────────────────────────────────────
step(`extracting CHANGELOG section for ${next}`);
const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
const lines = changelog.split("\n");
const startIdx = lines.findIndex((l) => l.startsWith(`## [${next}]`));
if (startIdx === -1) {
  die(`CHANGELOG.md has no "## [${next}]" section — add it before releasing`);
}
let endIdx = lines.findIndex((l, i) => i > startIdx && l.startsWith("## ["));
if (endIdx === -1) endIdx = lines.length;
const rawBlock = lines.slice(startIdx + 1, endIdx); // keeps ### sub-headers (used by the card)
const body = rawBlock
  .filter((l) => !l.startsWith("### ")) // flatten Added/Fixed/Docs to match release style
  .join("\n")
  .trim();
if (!body) die(`CHANGELOG section for ${next} is empty`);

const notes = `## Changes\n\n${body}\n\n## Install\n\n\`\`\`bash\nnpm i -g lark-opencode-bridge@latest\n\`\`\`\n`;
console.log("\n--- release notes preview ---\n" + notes + "-----------------------------\n");

// ── build the Feishu broadcast card from the CHANGELOG section ──────────────
const SECTION_LABEL = {
  Added: "🆕 新增 · Added",
  Changed: "🔧 变更 · Changed",
  Fixed: "🐛 修复 · Fixed",
  Removed: "🗑️ 移除 · Removed",
  Deprecated: "⚠️ 废弃 · Deprecated",
  Security: "🔒 安全 · Security",
  Docs: "📖 文档 · Docs",
};
function buildCard() {
  // group raw CHANGELOG lines into ### sections of `•` bullets
  const sections = [];
  let cur = null;
  for (const raw of rawBlock) {
    const line = raw.replace(/\s+$/, "");
    const h = line.match(/^###\s+(.+)$/);
    if (h) {
      cur = { title: SECTION_LABEL[h[1].trim()] ?? h[1].trim(), bullets: [] };
      sections.push(cur);
      continue;
    }
    if (!line.trim()) continue;
    if (!cur) { cur = { title: null, bullets: [] }; sections.push(cur); }
    const b = line.match(/^[-*]\s+(.*)$/);
    if (b) cur.bullets.push("• " + b[1].trim());
    else if (cur.bullets.length) cur.bullets[cur.bullets.length - 1] += " " + line.trim();
    else cur.bullets.push(line.trim());
  }
  const elements = [];
  sections.forEach((s, i) => {
    if (i > 0) elements.push({ tag: "hr" });
    const head = s.title ? `**${s.title}**\n\n` : "";
    elements.push({ tag: "div", text: { tag: "lark_md", content: head + s.bullets.join("\n") } });
  });
  elements.push({ tag: "hr" });
  elements.push({
    tag: "action",
    actions: [
      { tag: "button", type: "primary", text: { tag: "plain_text", content: "📦 查看 GitHub Release" }, url: `https://github.com/${REPO}/releases/tag/${tag}` },
      { tag: "button", type: "default", text: { tag: "plain_text", content: "📚 知识库文档" }, url: KB_URL },
    ],
  });
  elements.push({
    tag: "note",
    elements: [{ tag: "lark_md", content: `升级： \`npm i -g lark-opencode-bridge@latest\`　·　${new Date().toISOString().slice(0, 10)}` }],
  });
  return {
    config: { wide_screen_mode: true },
    header: { template: "blue", title: { tag: "plain_text", content: `🚀 lark-opencode-bridge v${next}` } },
    elements,
  };
}

// ── verify ─────────────────────────────────────────────────────────────────
step("npm test (typecheck + unit tests)");
run("npm test");
step("npm run build");
run("npm run build");

// ── bump + commit + tag ────────────────────────────────────────────────────
step(`writing package.json version → ${next}`);
if (!DRY) {
  pkg.version = next;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

const branch = capture("git rev-parse --abbrev-ref HEAD");
step(`commit + tag ${tag} on ${branch}`);
run(`git add -A`);
run(`git commit -m "Release ${tag}"`);
run(`git tag ${tag}`);

// ── push to every configured remote ────────────────────────────────────────
const existing = capture("git remote").split("\n");
for (const r of REMOTES) {
  if (!existing.includes(r)) {
    console.log(`  (skip remote "${r}" — not configured)`);
    continue;
  }
  step(`push ${r} ${branch} + ${tag}`);
  run(`git push ${r} ${branch} ${tag}`);
}

// ── GitHub Release ─────────────────────────────────────────────────────────
step(`gh release create ${tag} (latest)`);
if (DRY) {
  console.log(`  [dry] gh release create ${tag} --latest --title ${tag} --notes <…>`);
} else {
  // write notes to a temp file to avoid shell-escaping issues
  const notesFile = join(ROOT, `.release-notes-${next}.md`);
  writeFileSync(notesFile, notes);
  try {
    run(`gh release create ${tag} -R ${REPO} --latest --title ${tag} --notes-file "${notesFile}"`);
  } finally {
    run(`rm -f "${notesFile}"`);
  }
}

// ── npm publish ────────────────────────────────────────────────────────────
step("npm publish");
run("npm publish");

// ── Feishu group card broadcast (best-effort — release is already done) ──────
if (NO_CARD) {
  console.log("  (skip Feishu broadcast — --no-card)");
} else {
  step(`Feishu card → ${FEISHU_GROUP}`);
  const card = JSON.stringify(buildCard());
  if (DRY) {
    console.log(`  [dry] lark-cli im +messages-send --chat-id ${FEISHU_GROUP} --msg-type interactive --as ${FEISHU_IDENTITY} --profile ${FEISHU_PROFILE} --content <card>`);
    console.log("  [dry] card:\n" + JSON.stringify(buildCard(), null, 2).split("\n").map((l) => "    " + l).join("\n"));
  } else {
    const cardFile = join(ROOT, `.release-card-${next}.json`);
    writeFileSync(cardFile, card);
    try {
      run(
        `lark-cli im +messages-send --chat-id ${FEISHU_GROUP} --msg-type interactive ` +
          `--as ${FEISHU_IDENTITY} --profile ${FEISHU_PROFILE} --content "$(cat '${cardFile}')"`,
      );
    } catch {
      // never fail the release for a broadcast hiccup (e.g. token needs re-login)
      console.warn(`  \x1b[33m! Feishu broadcast failed — release is published; send the card manually if needed\x1b[0m`);
    } finally {
      run(`rm -f "${cardFile}"`);
    }
  }
}

console.log(`\n\x1b[32m✓ Released ${tag}\x1b[0m`);
console.log(`  https://github.com/${REPO}/releases/tag/${tag}`);
console.log(`  npm i -g lark-opencode-bridge@${next}\n`);
