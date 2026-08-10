# Changelog

All notable changes to **lark-opencode-bridge** are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [0.1.15] - 2026-08-10

### Fixed
- **向导安装 lark-cli 时"假死"**：`npm install -g @larksuite/cli` 原先把输出全部吞掉，慢网络下用户面对黑屏干等；现在交互模式直接透传 npm 自己的下载进度，并加 15 分钟超时兜底（超时报错会提示检查网络/registry）。
- 刚装完 `@latest` 不再多余地 `npm view` 查一次"是否需要升级"（这一步无超时且无输出，是第二个假死点）；升级检查本身也加了 20 秒超时，查不到就沿用当前版本。

## [0.1.14] - 2026-08-10

### Fixed
- `--version` 一直输出硬编码的 `0.1.5`——版本号现在运行时从 `package.json` 读取，随发版自动正确。
- 新增 `-v` 短选项（`lark-opencode-bridge -v`）；原 commander 默认的 `-V` 由 `-v` 取代。

## [0.1.13] - 2026-08-10

### Fixed
- **Windows：检测/安装 lark-cli 必失败**（`安装 @larksuite/cli 失败：unknown error`）。所有外部命令（`lark-cli` / `npm` / `opencode`）此前用 `node:child_process` 直接 spawn，而 Windows 上 npm 全局命令是 `.cmd` 垫片——无 shell 的 spawn 直接 `ENOENT`（新版 Node 因 CVE-2024-27980 还会拒绝执行 `.cmd`）。即使 lark-cli 已装好也检测不到，继而 `npm install -g` 兜底同样失败。现统一走 `cross-spawn`（`src/process/exec.ts`），正确解析垫片并转义参数。
- Windows 上 `resolveOnPath` 优先返回 `.exe`/`.cmd`/`.bat` 匹配（`where` 会把不可执行的无扩展名 sh 垫片排在最前）。
- `npm install -g @larksuite/cli` 失败时的报错现在带上真实原因（如 spawn `ENOENT`），不再是空的 "unknown error"。

### Added
- 扫码向导在 **Windows** 也会自动打开授权页 / 开放平台页面（`rundll32 url.dll,FileProtocolHandler`），权限清单支持复制到 Windows 剪贴板（`clip`）；此前这两处仅支持 macOS / Linux。

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
