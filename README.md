# lark-opencode-bridge

[![CI](https://github.com/YMaxwellHayes/lark-opencode-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/YMaxwellHayes/lark-opencode-bridge/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/lark-opencode-bridge.svg)](https://www.npmjs.com/package/lark-opencode-bridge)

> 🌉 **TL;DR:** Drive the [opencode](https://opencode.ai) AI coding agent already running on your laptop from inside Feishu / Lark — over your phone, with collaborators, persistent group sessions, and native doc-comment + attachment integration.
>
> No model in the cloud, no code uploaded, no new account to sign up for — your code and execution stay 100% local.

```bash
npm i -g lark-opencode-bridge@latest
lark-opencode-bridge run
```

[中文](./README.zh.md) · [GitHub](https://github.com/YMaxwellHayes/lark-opencode-bridge) · [npm](https://www.npmjs.com/package/lark-opencode-bridge)

---

## Contents

- [What it is](#what-it-is)
- [What it is not](#what-it-is-not)
- [Pain points it solves](#pain-points-it-solves)
- [Flagship: `/spawn` workspace groups](#flagship-spawn-workspace-groups)
- [Other capabilities](#other-capabilities)
- [Typical use cases](#typical-use-cases)
- [Prerequisites & fit](#prerequisites--fit)
- [Getting started (step by step)](#getting-started-step-by-step)
- [In-chat slash commands](#in-chat-slash-commands)
- [Configuration](#configuration)
- [Data directories](#data-directories)
- [How it works](#how-it-works)
- [Project layout](#project-layout)
- [FAQ](#faq)
- [License](#license)

---

## What it is

You send a message in Feishu — the bridge forwards it to the `opencode` process running on your computer; opencode works inside the project directory you point it at (reads code, edits files, runs commands, drives LSP), and the process + result is streamed back as **a single auto-refreshing Lark card**.

No model in the cloud, no code hosting, no new account. Code and execution stay on your machine; Feishu only carries the messages and the card.

![Data flow: Feishu message → bridge → local opencode → streaming card](./docs/img/en/data-flow.svg)

---

## What it is not

The most common confusion. Here's the positioning, plainly:

| Category | Examples | Difference |
|---|---|---|
| **General-purpose personal agent** | OpenClaw / Hermes | Generalist; not deep enough for serious coding work |
| **Claude-Code-to-Feishu bridge** | Most similar projects bind to Claude Code | This one bridges to **opencode** — bring-your-own-model, no vendor lock-in |
| **Plain terminal opencode** | opencode TUI | Can't go mobile, can't collaborate, gone when terminal closes. This brings it into Feishu's collab fabric. |

> ✅ **One-line positioning:** A bridge that brings **a specialised coding agent (opencode)** into Feishu — not yet another general-purpose chatbot.

---

## Pain points it solves

You're already using opencode, but it has natural limits:

| Pain | Plain opencode | With this bridge |
|---|---|---|
| Tied to the desktop | Locked to your terminal | Drive it from any device that runs Feishu (phone, tablet, browser) |
| Solo work | Context is locked inside your head | Pull others into a group around the same agent |
| Sessions vanish | Close the terminal and context is gone | `/spawn` pins a session to a Lark group — come back any time |
| Awkward to feed material | Manually paste paths / code | Drop files / screenshots; @mention the bot in doc comments |

---

## Flagship: `/spawn` workspace groups

`/spawn` is the headline feature. It materialises *"one of your opencode sessions"* into a Feishu group: **one group = one session = one project context.**

| 💾 Session persistence | 👥 Built-in collaboration | 🔁 P2P → P2A2P |
|---|---|---|
| Want to keep working on a project? Walk back into its group — context is still there, no re-briefing needed. | Pull product / engineering / QA into the same group. They share the agent's context. No `@` mention needed inside the group. | Upgrades collaboration from "brain → brain" to "person → agent → person", with the agent carrying context between people. |

![P2P vs P2A2P collaboration model](./docs/img/en/spawn-collaboration.svg)

> 📝 **Concrete example:** When a new feature is shipping, the PM briefs opencode inside a `/spawn` group — background, goals, constraints — and asks it to read the relevant code. Engineers join the same group and, instead of re-reading the PRD, simply ask the agent *"what's the context here / how far along are we / why is this designed this way?"*. The agent becomes the shared, always-on "context hub" between roles.

---

## Other capabilities

- **QR onboarding** — first run shows a QR code; scan in Feishu to bind an app. No copying App Secret out of the dev console.
- **Streaming card** — opencode's thinking, tool calls, and text all stream into a single Lark card; hit "Stop" any time.
- **Doc-comment @mentions** — @mention the bot inside a Feishu doc / sheet comment; the agent reads the comment thread + the underlying code and **answers back into the comment thread**.
- **Direct attachments** — drop screenshots or files at the bot; the agent reads the local file. Send an error screenshot or a log and let it dig in.
- **Named workspaces** — `/workspaces` (alias `/ws`) switches across project directories; each one has its own isolated session.
- **Manageable as a service** — supports a background daemon (start on login, auto-restart on crash) so the bot stays online.

---

## Typical use cases

| Use case | Description |
|---|---|
| 📱 **On-the-go coding** | While commuting / travelling, use Feishu on your phone to drive opencode on your office machine — fix bugs, look up logic, add tests. |
| 🤝 **Cross-role collaboration** | `/spawn` a project group; PM briefs requirements, engineering implements — both centred on the same agent. |
| 📄 **Doc-driven development** | @mention the bot in a tech-design / API doc; let it answer comment threads grounded in the actual repository code. |
| 🔍 **Ad-hoc debugging** | Drop an error screenshot or log file in chat; the agent reads it alongside the code and pinpoints the root cause. |

---

## Prerequisites & fit

**Before you start, you need:**

1. opencode installed locally with at least one model provider configured (Anthropic / OpenAI / Gemini / OpenRouter, etc.)
2. Node.js ≥ 20
3. A Feishu / Lark account (first-time QR wizard creates the app for you)

| ✅ Good fit for | ❌ Not for |
|---|---|
| People doing real coding work who already use opencode (or want to) and want to extend it into Feishu and their team. | People who want a "talk-to-it-about-anything" general assistant (that's OpenClaw / Hermes territory) or who don't want opencode locally. |

---

## Getting started (step by step)

> **First time?** Follow the steps in order. **Don't skip ahead.** The first run must happen in the foreground (`run`) to scan the QR code — **do not** jump straight to `start` (background daemon).

![Four steps: install opencode → install bridge → scan QR → message in Feishu](./docs/img/en/quick-start.svg)

### Step 0 — Node.js

Node.js **≥ 20** required:

```bash
node -v   # should print v20.x or higher
```

No Node? Get LTS from [nodejs.org](https://nodejs.org/), or use Homebrew: `brew install node`.

### Step 1 — Install opencode

The bridge spawns `opencode serve` locally (no separate login), but the `opencode` binary must be on `$PATH`.

```bash
# Option A — official script (recommended on macOS / Linux)
curl -fsSL https://opencode.ai/install | bash

# Option B — Homebrew
brew install anomalyco/tap/opencode

# Option C — npm
npm install -g opencode-ai@latest
```

Verify in a **new terminal**:

```bash
opencode --version
```

Configure models / API keys per [opencode docs](https://opencode.ai/docs). Without a model the bot can still respond to `/help`, but real AI prompts may fail — send `/models` in a P2P chat to list providers.

### Step 2 — Install Feishu CLI (lark-cli)

Outgoing Lark actions go through the official **`@larksuite/cli`** package (the unrelated npm package literally named `lark-cli` is **not** this tool):

```bash
npm install -g @larksuite/cli@latest
lark-cli --version
```

> The bridge can auto-install lark-cli on first `run`, but installing manually first avoids PATH surprises.

### Step 3 — Install the bridge

```bash
npm install -g lark-opencode-bridge@latest
lark-opencode-bridge --version
lark-opencode-bridge doctor
```

Both `lark-cli` and `opencode` should report **ok**.

### Step 4 — First foreground run + QR setup

```bash
lark-opencode-bridge run
# equivalent to:
lark-opencode-bridge
```

You'll see a QR code in the terminal (macOS also tries to open a browser):

1. Scan with the **Feishu app**
2. Pick or create an app (PersonalAgent flow)
3. Credentials land in `~/.lark-cli/config.json`; the app secret is written to `~/.lark-opencode-bridge/secrets.json`
4. The terminal prompts you to open **Permissions** in the dev console and copies the recommended permission JSON

When you see **`bridge ready — listening for IM messages`** in the log, the bridge is up. **Leave this terminal window open** for easier debugging.

### Step 5 — Feishu developer console (required)

In [open.feishu.cn](https://open.feishu.cn/), open the app the wizard created:

| Task | Notes |
|---|---|
| **App capabilities → Bot** | Enable the bot |
| **Permissions** | The wizard copies a JSON. You can also run `lark-opencode-bridge scopes --copy` locally and "batch import" in the console |
| **Event subscriptions** | Choose **"Persistent connection"** (NOT webhook) |
| **Versions** | Create a new version and **publish it** (self-built apps also need admin approval) |

Local helper to auto-configure events + card callbacks:

```bash
lark-opencode-bridge configure
```

> **The most commonly missed step:** adding permissions but **not publishing** a version. The bot will appear online but receive no messages.

### Step 6 — Verify in Feishu

1. Open the bot in Feishu and **start with a P2P chat**
2. Send `/help`
   - Reply? You're good
   - No reply? See the troubleshooting table below, or check `~/.lark-opencode-bridge/logs/`
3. In **normal groups** you must `@bot`. Use `/spawn <topic>` to create a dedicated workspace group where the @ is no longer needed.

### Step 7 (optional) — Background daemon

Only **after Step 6 works**, switch to the background (macOS / Linux only):

```bash
# Stop the foreground run with Ctrl+C first
lark-opencode-bridge start
lark-opencode-bridge status
```

Logs: `~/.lark-opencode-bridge/logs/`.

> Daemon mode requires a **global** install (`npm i -g`). Don't use `npx`.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| P2P `/help` no reply | App version not published / events not on persistent connection | Redo Step 5 |
| No reply in groups | Bot wasn't `@`-mentioned | `@bot` in group, or use `/spawn` |
| Still no reply after `start` | QR not scanned, or opencode not on PATH | Run `run` to scan first; `doctor` to diagnose |
| AI doesn't respond but `/help` works | opencode has no model configured | Set up an API key; `/models` in P2P |
| `doctor` reports opencode / lark-cli MISSING | Not installed or not on PATH | Redo Steps 1 / 2, then **open a new terminal** |

---

## In-chat slash commands

In any Feishu chat, send a **single line starting with `/`** (or end a multi-line message with the command on the last line). Slash commands are handled **locally by the bridge** — they don't go through opencode and respond instantly.

**How to send messages**

| Context | Usage |
|---|---|
| P2P chat with the bot | Send text directly; `/help` for everything |
| Normal group | `@bot` first (or `@bot` followed by a command) |
| `/spawn` workspace group | **No `@` needed** — talk to the bot directly |
| Images / files / rich text | Send normally; the bridge downloads attachments and feeds them to opencode |
| Doc comments | `@bot` inside a comment; the answer is posted back into the comment thread |

**Aliases** (case-insensitive):

- `/clear` → `/new`
- `/summarize` → `/compact`
- `/resume`, `/continue` → `/sessions`
- `/model` → `/models`, `/agent` → `/agents`, `/ws` → `/workspaces`
- `/group`, `/拉群` → `/spawn`

**Admin-only** (🔒): once you set `adminOpenIds` via `/config`, the marked commands are restricted to admins.

### Session & task

| Command | Aliases | Description |
|---|---|---|
| `/help` | — | Show the full help (same content as this README) |
| `/new` | `/clear` | Reset **this chat's** opencode session, clearing context |
| `/init` | — | Have opencode analyse the cwd and create / update root `AGENTS.md` |
| `/sessions` | `/resume`, `/continue` | List opencode's existing sessions (debug) |
| `/compact` | `/summarize` | Compact the current session's history, preserving key points |
| `/share` | — | Create a public share link for the current session |
| `/unshare` | — | Revoke the share link |
| `/undo` | — | Revert the last user message and its file changes |
| `/redo` | — | Restore content reverted by `/undo` |
| `/stop` | — | **Abort** the in-flight prompt (equivalent to ESC) |

### Model & agent

| Command | Aliases | Description |
|---|---|---|
| `/models` | `/model` | List opencode's available providers and models |
| `/models <provider/model>` | `/model …` | Switch the model for **this chat**; the provider prefix auto-completes when unambiguous |
| `/agents` | `/agent` | List available agents (e.g. `build`, `plan`) |
| `/agents <name>` | `/agent …` | Switch the agent for **this chat** |

### Directory, status, workspace groups

| Command | Aliases | Description |
|---|---|---|
| `/cd <absolute-path>` | — | Set **this chat's** working directory (rebuilds the session) 🔒 |
| `/status` | — | Show session id, cwd, agent, model, WebSocket state, idle timeout |
| `/spawn <topic>` | `/group`, `/拉群` | **P2P only.** Create a group named `[opencode] <topic>`, invite you, bind a fresh session; **no `@` needed inside** 🔒 |
| `/workspaces list` | `/ws list` | List named workspaces 🔒 |
| `/workspaces save <name> [path]` | `/ws save …` | Save a workspace (defaults to current cwd) 🔒 |
| `/workspaces use <name>` | `/ws use …` | Switch to a saved workspace (rebuilds the session) 🔒 |
| `/workspaces rm <name>` | `/ws rm …` | Delete a workspace 🔒 |

### Ops & preferences

| Command | Aliases | Description |
|---|---|---|
| `/reconnect` | — | Manually reconnect the Feishu WebSocket (when messages stop arriving) 🔒 |
| `/timeout [minutes]` | — | No args: show per-chat / global idle timeout. `/timeout 30` aborts when opencode is silent for 30 min. `/timeout 0` disables. |
| `/doctor [note]` | — | Hand recent bridge logs to opencode for **self-diagnosis** (optional description) 🔒 |
| `/config` | — | Open the interactive **preferences card** (reply style, allowlists, group-`@` policy, doc comments, ...) 🔒 |

`/config` can change:

- **reply / card** — plain markdown reply vs streaming interactive card
- **idle timeout & message-batching window**
- **whether to process doc comments**, **whether groups need `@`**
- **allowed user / chat IDs**, **admin IDs**

Submitted changes write `~/.lark-opencode-bridge/config.json` immediately; **no restart needed**.

**Examples**

```text
/help
/status
/models anthropic/claude-sonnet-4
/agents build
/cd /Users/me/my-project
/spawn refactor login module
/workspaces save main /Users/me/my-project
/workspaces use main
/timeout 45
/doctor P2P works but no reply when @-mentioned in groups
```

**Anything else (plain text, images, files) is forwarded to opencode** as a normal prompt; conversations are isolated per `chat_id`.

### Host CLI

```
lark-opencode-bridge              Foreground (default = run)
lark-opencode-bridge run          Run the bot in the foreground
lark-opencode-bridge start        Install + start the background daemon (macOS / Linux)
lark-opencode-bridge stop         Stop the daemon
lark-opencode-bridge restart      Restart the daemon
lark-opencode-bridge unregister   Remove the service registration
lark-opencode-bridge setup        QR wizard only (don't start the bridge)
lark-opencode-bridge configure    Auto-configure app name, persistent events, card callbacks
lark-opencode-bridge scopes       Print the recommended permission JSON
lark-opencode-bridge doctor       Self-check dependencies and configuration
lark-opencode-bridge ps           List bridge processes on this machine
lark-opencode-bridge status       Show daemon + config summary
lark-opencode-bridge service install|start|stop|uninstall  (equivalent to start/stop)
```

> Daemon is **macOS / Linux only**. `start` etc. require a **global install** (`npm i -g`) — not `npx`.

---

## Configuration

`~/.lark-opencode-bridge/config.json`:

```json
{
  "opencodePort": 4096,
  "opencodeHost": "127.0.0.1",
  "manageOpencodeServer": true,
  "larkIdentity": "bot",
  "allowedSenderOpenIds": [],
  "allowedChatIds": [],
  "replyStyle": "card",
  "handleDocComments": true,
  "defaultCwd": "/Users/me/repo",
  "agent": "build",
  "model": "anthropic/claude-sonnet-4"
}
```

- `model` is split on the first `/` into `{providerID, modelID}` (what opencode expects).
- `defaultCwd` becomes the `directory` parameter when the bridge creates a session for a chat. Changing cwd via `/cd` rebuilds the session because opencode binds `directory` at session creation.
- `allowedSenderOpenIds` / `allowedChatIds` — empty array = unrestricted. Add `ou_…` / `oc_…` IDs to restrict.
- `replyStyle` — `"card"` (default, streaming interactive card) or `"reply"` (plain markdown reply).
- `handleDocComments` — `true` enables Feishu doc-comment `@`-mention handling.
- `manageOpencodeServer` — set to `false` to point at an externally running `opencode serve`.

Friendlier: send `/config` in Feishu for an interactive settings card.

### Reply modes

`config.replyStyle`:

- **`card`** (default) — bridge immediately sends a "thinking…" card, subscribes to opencode's SSE event stream, and PATCHes the card every ~800 ms with the latest text. Only parts of messages with `role: assistant` are rendered, so the user's own message is never echoed back.
- **`reply`** — bridge waits for the prompt to complete, then posts a single threaded markdown reply.

---

## Data directories

| Path | Content |
|---|---|
| `~/.lark-opencode-bridge/config.json` | Bridge configuration (port, cwd, replyStyle, ...) |
| `~/.lark-opencode-bridge/secrets.json` | App secret (written by setup; mode 600) |
| `~/.lark-opencode-bridge/sessions.json` | chat → opencode session map + spawned-group set |
| `~/.lark-opencode-bridge/workspaces.json` | Named workspaces |
| `~/.lark-opencode-bridge/media/` | Downloaded attachments (auto-pruned after 24h) |
| `~/.lark-opencode-bridge/logs/` | JSONL logs, rotated daily, kept 7 days by default |
| `~/.lark-opencode-bridge/processes.json` | Local bridge process registry |

`~/.lark-cli/config.json` is maintained by lark-cli / the QR wizard (app id, profile, ...).

Env vars:

- `LARK_OPENCODE_HOME` — override the default data directory
- `LARK_OPENCODE_LOG_DAYS` — log retention in days (default 7)

---

## How it works

1. `bridge run` starts `opencode serve` as a child process (unless `manageOpencodeServer=false`) and waits for `http://127.0.0.1:4096` to listen.
2. Establishes a persistent Feishu WebSocket via `@larksuiteoapi/node-sdk` and subscribes to `im.message.receive_v1` + `drive.notice.comment_add_v1` + card-action callbacks.
3. Each event is deduped by `event_id`, filtered against the allowlist, and (for normal groups) verified to contain an `@bot` mention — `/spawn` groups bypass this check.
4. Text whose first line starts with `/` → handled locally by the bridge. Otherwise:
   - Lazily create one opencode session per `chat_id` (persisted to disk).
   - `POST /session/{id}/prompt_async` and subscribe to the SSE event stream.
   - Card mode: render SSE deltas into a Lark card, PATCH every ~800 ms.
   - Reply mode: wait until the session goes idle, then post one markdown reply.
5. **Batch + preempt**: rapid messages in the same chat are coalesced into one prompt; a new message mid-run cancels the previous run.

### Doc comment flow

```
Feishu doc comment / reply @bot ───► drive.notice.comment_add_v1 (WSClient)
                                  │ is_mentioned: true
                                  ▼
                               fetchThread() (GET /open-apis/drive/v1/files/.../comments/...)
                                  │ extract triggering reply text + anchored quote
                                  ▼
                               opencode session keyed by `doc:<file_token>`
                                  │ session.prompt with question + quote + doc URL
                                  ▼
                               postReply() (POST .../comments/{commentId}/replies)
```

- Each doc keeps its own opencode session (keyed by `file_token`), so a follow-up comment thread retains context.
- Replies are plain text, capped at 2000 characters (Lark comment limit).

### Attachment flow

When an `image` / `file` / `post` message arrives:

1. `lark-cli im +messages-mget` fetches the structured message (the event payload's `content` is pre-rendered text and lacks `image_key` / `file_key`).
2. For each `image_key` / `file_key`, `+messages-resources-download` downloads it to `~/.lark-opencode-bridge/media/<message_id>/`.
3. The local file is handed to opencode as a `FilePartInput` (`file://` URL + best-effort `mime` from the extension).

`post` messages are recursively walked for `tag: img` / `tag: file` nodes.

---

## Project layout

```
src/
├── cli.ts                # commander entry (run/start/stop/doctor/config/...)
├── config.ts             # config.json schema
├── session.ts            # chat_id → opencode session_id + cwd + spawned set
├── workspace.ts          # named workspace store
├── slash.ts              # slash-command parser
├── paths.ts              # filesystem paths
├── log.ts                # JSONL logging + daily rotation + recentLogEntries
├── preflight.ts          # startup dependency check
│
├── core/
│   ├── bridge.ts         # main orchestrator (routing, prompt, card, comments, /spawn)
│   ├── pending-queue.ts  # message coalescing + preempt queue
│   └── idle-watchdog.ts  # idle-timeout watchdog
│
├── card/
│   ├── run-state.ts      # RunState state machine
│   ├── run-renderer.ts   # streaming card renderer (schema 2.0)
│   ├── agent-event.ts    # opencode SSE → AgentEvent adapter
│   └── tool-render.ts    # tool block markdown
│
├── lark/
│   ├── ws-consumer.ts    # LarkChannel WebSocket entry
│   ├── sender.ts         # send / patch card
│   ├── chats.ts          # group create / rename (/spawn)
│   ├── attach.ts         # attachment downloader
│   ├── comments.ts       # comment thread fetch + reply
│   ├── credentials.ts    # credentials resolver
│   ├── wizard.ts         # QR onboarding wizard
│   ├── keepalive.ts      # WS health-check + auto-reconnect
│   └── ...               # scopes / app-setup / install helpers
│
├── opencode/
│   ├── server.ts         # spawn / supervise opencode serve
│   ├── client.ts         # HTTP client
│   └── events.ts         # SSE event normalisation
│
├── process/
│   ├── registry.ts       # atomic read/write of processes.json
│   └── conflicts.ts      # multi-instance detection for the same app
│
├── service/
│   └── daemon.ts         # launchd (macOS) / systemd (Linux)
│
└── media/
    └── cleanup.ts        # periodic media cleanup (24h)
```

---

## FAQ

**Q: How is this different from OpenClaw / Hermes?**
Those are general-purpose agents that do a bit of everything. This is specifically a bridge for a **specialised coding agent** (opencode). Use the specialist for real coding work.

**Q: Can I use it without opencode?**
No. This is the *bridge*, not the agent. It drives opencode running on your machine.

**Q: Does it upload my code?**
No. Code and execution stay local; Feishu only sees the message text and the rendered card.

**Q: Why opencode and not Claude Code?**
opencode is open source, terminal-native, and **model-agnostic** — you pick the model per task, control cost, and aren't locked to one vendor. If you already use opencode, this bridge lets it live inside Feishu.

**Q: The bot doesn't reply in groups?**
Normal groups require `@bot`. Use `/spawn <topic>` to create a dedicated workspace group where `@` is not needed.

**Q: Does it work on Windows?**
Foreground `run` works; the background daemon is macOS / Linux only.

---

## License

[MIT](./LICENSE)
