# Changelog

All notable changes to **lark-opencode-bridge** are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [0.1.16] - 2026-08-11

### Fixed
- **Windows：几乎所有回复都会发送失败**。npm 全局的 `lark-cli` 是 `.cmd` 垫片，spawn 时被 cmd.exe 包装——参数里的换行被当作命令分隔符（多行 markdown 全被截断报错）、命令行被限制在 8191 字符（流式卡片必超）。现在直接定位并调用 @larksuite/cli 包内的原生 `lark-cli.exe`，完全绕开 cmd.exe。
- **Windows：图片/文件附件全部失效**——`file://${absPath}` 拼出的 URL 对 `C:\...` 是非法的，改用 `pathToFileURL`。
- **Windows：`/cd` 拒绝一切盘符路径、已保存的工作目录被静默丢弃**——两处 `startsWith("/")` 绝对路径判断改为 `path.isAbsolute`（后者更隐蔽：`/workspaces use` 显示切换成功但实际静默回退默认目录）。
- **Windows：中文系统上后台服务状态判断/幂等停止失效**——schtasks 输出是本地化+OEM 编码的，无法文本匹配；任务存在性改用退出码判断，运行状态改用 PowerShell `Get-ScheduledTask`（枚举值恒为英文）。
- **Windows：停止桥接时 `opencode serve` 变孤儿进程占住端口**——Windows 无进程组信号，改用 `taskkill /T /F` 杀整棵进程树（旧实例清理同理）；`process.kill(pid, 0)` 遇 EPERM 误判"已死"也已修正。
- **向导在 `lark-cli profile add` 失败时丢失刚建应用的凭证**：现在扫码拿到 appId/appSecret 后**先落盘**到 `~/.lark-opencode-bridge/secrets.json` 再写 lark-cli profile——即使 profile add 失败，也不需要重跑向导重新扫码（那会重复建应用），按报错里给出的命令手动补一条 profile 即可。
- profile add 失败的报错现在带全量诊断（退出码 / spawn 错误 / 完整 stdout+stderr）；手动命令提示按平台区分（Windows cmd 的 `echo <secret>|` 不能加引号、`|` 前不能有空格）。
- 流式卡片的正文块加 8000 字符截断——飞书本身约 30KB 拒收卡片，lark-cli 降级路径还受 Windows 命令行长度限制，长回答降级为截断而不是每次 patch 全部失败。
- 卡片里工具调用入参一直为空——opencode 把入参放在 `part.state.input`，原代码读的是 `part.input`。
- 附件文件名防 Windows 保留设备名（`nul.txt` 之类会被重定向到设备）；解析命令输出统一按 `\r?\n` 切行；`start` 命令输出的日志路径按平台使用正确分隔符。

### Compatibility
- **opencode 1.18.16（最新）**：桥接器依赖的全部 16 个 HTTP 端点、SSE 事件结构、`serve` 启动参数经源码 diff（1.16.2→1.18.16）+ 隔离实例真机验证，全部兼容，无需改动。
- **飞书 CLI @larksuite/cli 1.0.85（最新）**：`profile add/use`、`api`、`im +messages-send/reply/mget/resources-download`、`+chat-create/update` 全部参数逐一核对存在且语义未变。

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
