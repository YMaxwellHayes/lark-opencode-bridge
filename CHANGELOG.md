# Changelog

All notable changes to **lark-opencode-bridge** are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [0.1.13] - 2026-07-20

### Fixed
- **Topic/thread replies** — card mode no longer posts a brand-new top-level
  message (which becomes a new topic in topic-mode groups like Atlas Agent
  Desk). Agent cards and markdown replies now use `messages-reply` against the
  triggering message, with `--reply-in-thread` for group/topic context so
  `@Tommy` stays in the same thread the user mentioned from. If the chat
  rejects thread replies (`230071`), the bridge retries as a plain reply.

## [0.1.12] - 2026-06-01

### Added
- **Windows background daemon** — `start` / `stop` / `restart` / `status` now work on Windows via a per-user **Task Scheduler** task (logon-triggered, auto-restart on crash), the equivalent of launchd on macOS and systemd `--user` on Linux. The bridge daemon is now supported on all three platforms; foreground `run` already was.

### Changed
- `resolveOnPath` uses `where` on Windows (`which` elsewhere) when resolving `lark-cli` / `opencode` for the service definition.
- `installService` now ensures the log directory exists up front on every platform, so first-run daemon stdout/stderr redirection never fails.
- CLI service-command descriptions and the post-`start` log hint are now Windows-aware (PowerShell `Get-Content` instead of `tail`).

### Docs
- README（中英文）平台支持说明更新为 macOS / Linux / Windows；重写「Windows 能用吗 / Does it work on Windows」FAQ。

## [0.1.11] - 2026-06-01

### Docs
- README（中英文）开头新增「分享与交流 / Community」区块：飞书知识库帮助文档链接、交流群一键加入超链接，以及群二维码（`docs/img/feishu-group-qr.png`）。

## [0.1.10] - 2026-05-29

### Added
- **Doc-comment ack reaction** — when the bot is @mentioned in a cloud-doc
  comment, it now adds a 🧑‍💻 `Typing` (敲代码) reaction to the triggering reply
  as soon as it starts working, and removes the reaction once the answer is
  posted back. This gives commenters a clear "working → done" signal.
  Reaction add/remove are best-effort and never block the reply flow.
  Implemented via `drive.v2.commentReaction.updateReaction`
  (`CommentFetcher.reactToReply`).

## [0.1.9] - 2026-05-28
- GitHub username change `rorschachachxd` → `YMaxwellHayes`.

## [0.1.8]
- English README references the English SVG diagram.

## [0.1.7]
- Ship `docs/img` inside the npm package.

## [0.1.6]
- Daemon, keepalive, registry, and shutdown fixes.

## [0.1.5]
- Updated product copy in README and npm description.

## [0.1.4]
- Complete in-chat slash-command docs in README.

## [0.1.3]
- Beginner step-by-step setup guide in README.

## [0.1.2]
- Daemon PATH fixes and README cleanup.

## [0.1.1]
- Auto-install latest lark-cli during app setup.

## [0.1.0]
- Initial release: Feishu/Lark bot for local opencode — QR setup, streaming
  cards, `/spawn` groups, doc comments & attachments.
