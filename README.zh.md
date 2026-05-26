# lark-opencode-bridge

[![CI](https://github.com/rorschachachxd/lark-opencode-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/rorschachachxd/lark-opencode-bridge/actions/workflows/ci.yml)

**在飞书里远程指挥本机 opencode** — 一条命令安装，扫码绑应用；私聊或 @ 机器人即可改代码。支持流式卡片、图片附件、云文档评论、一键 `/spawn` 工作群，算力在本地、对话在手机上。

```bash
npm i -g lark-opencode-bridge@latest
lark-opencode-bridge run
```

[English README](./README.md)

## 从零开始（推荐操作顺序）

> **给第一次用的人**：请严格按下面顺序做，**不要跳步**。  
> 第一次必须在前台跑 `run` 完成扫码；**不要**一上来就 `start` 开后台。

### 第 0 步：安装 Node.js

需要 **Node.js ≥ 20**。

```bash
node -v   # 应显示 v20.x 或更高
```

没有 Node？去 [nodejs.org](https://nodejs.org/) 下载 LTS，或用 Homebrew：`brew install node`。

---

### 第 1 步：安装 opencode

bridge 会调用本机的 `opencode` 命令（会自动起 `opencode serve`），**无需单独登录**，但必须先装好并在 PATH 里。

**方式 A — 官方脚本（macOS / Linux 推荐）**

```bash
curl -fsSL https://opencode.ai/install | bash
```

**方式 B — Homebrew**

```bash
brew install anomalyco/tap/opencode
```

**方式 C — npm**

```bash
npm install -g opencode-ai@latest
```

装完后**新开一个终端**，验证：

```bash
opencode --version
```

还要配置好 opencode 的模型 / API（按 [opencode 文档](https://opencode.ai/docs) 操作）。没配模型的话，机器人能收到消息但 AI 可能不回或报错；私聊发 `/models` 可查看可用模型。

---

### 第 2 步：安装飞书 CLI（lark-cli）

发消息、回消息、调开放平台 API 都靠它。请装官方包 **`@larksuite/cli`**（npm 上另一个叫 `lark-cli` 的包**不是**这个）。

```bash
npm install -g @larksuite/cli@latest
```

验证：

```bash
lark-cli --version
```

> 首次 `lark-opencode-bridge run` 时也会尝试自动安装/升级 lark-cli，但**建议先手动装好**，少踩 PATH 的坑。

---

### 第 3 步：安装 lark-opencode-bridge

```bash
npm install -g lark-opencode-bridge@latest
```

验证：

```bash
lark-opencode-bridge --version
lark-opencode-bridge doctor
```

`doctor` 里 `lark-cli`、`opencode` 都应是 **ok**。

---

### 第 4 步：首次前台启动 + 扫码绑应用

```bash
lark-opencode-bridge run
# 等价于直接敲：
lark-opencode-bridge
```

终端会出现二维码（macOS 还会尝试打开浏览器）：

1. 用**飞书 App** 扫码
2. 选择或创建一个应用（PersonalAgent 流程）
3. 向导会把凭据写入 `~/.lark-cli/config.json`，app secret 写入 `~/.lark-opencode-bridge/secrets.json`
4. 终端会提示打开**权限管理**页，并复制推荐权限 JSON

看到日志里出现 **`bridge ready — listening for IM messages`** 表示 bridge 已跑起来。**这个终端窗口先不要关**，方便排查。

---

### 第 5 步：飞书开放平台 — 权限、事件、发布（必做）

打开 [飞书开放平台](https://open.feishu.cn/) → 进入扫码创建的那个应用：

| 要做的事 | 说明 |
|---|---|
| **应用能力 → 机器人** | 开启机器人 |
| **权限管理** | 终端向导会复制 JSON；也可本地执行 `lark-opencode-bridge scopes --copy`，在后台「批量导入」 |
| **事件订阅** | 订阅方式选 **「使用长连接接收事件」**（不是 Webhook） |
| **版本管理与发布** | 创建新版本并**发布**（自建应用还需管理员审批） |

也可在本机补跑（自动配事件 + 卡片回调）：

```bash
lark-opencode-bridge configure
```

> **最容易漏的一步**：只加了权限但没**发布版本**，机器人会「在线但不收消息」。

---

### 第 6 步：在飞书里验证

1. 在飞书里找到你的机器人，**先私聊**
2. 发送：`/help`  
   - 有回复 → 链路通了  
   - 没回复 → 看下面「常见问题」，或终端 / `~/.lark-opencode-bridge/logs/` 里的日志
3. **普通群**里说话必须 **`@机器人`**；或用 `/spawn 主题` 建专用工作群（群内不用 @）

---

### 第 7 步（可选）：后台常驻

**确认第 6 步私聊 `/help` 正常后**，再开后台（仅 macOS / Linux）：

```bash
# 先 Ctrl+C 停掉前台 run
lark-opencode-bridge start
lark-opencode-bridge status
```

日志：`~/.lark-opencode-bridge/logs/`

> 后台服务必须用 **`npm i -g` 全局安装**，不要用 `npx`。

---

### 常见问题

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 私聊 `/help` 无回复 | 应用版本未发布 / 事件未开长连接 | 重做第 5 步 |
| 群里说话不回 | 没 @ 机器人 | 群里 `@机器人` 再发，或 `/spawn` 建群 |
| `start` 后仍不回 | 没先完成扫码，或 PATH 缺 opencode | 先 `run` 扫码；`doctor` 检查 |
| AI 不回但 `/help` 正常 | opencode 未配模型 | 配 API；私聊发 `/models` |
| `doctor` 报 opencode / lark-cli MISSING | 未安装或不在 PATH | 重做第 1、2 步，**新开终端**再试 |

---

## 能干什么

- 私聊直接发；群里 `@bot`（`/spawn` 拉群后群内无需 @）
- **流式卡片**：opencode 输出实时更新到同一张卡片
- **会话延续**：每个 chat 独立 session
- **多工作空间**：`/workspaces`（别名 `/ws`）切换项目
- **图片 / 文件 / 富文本**：下载到本地后交给 opencode
- **云文档评论**：在文档评论里 `@bot` 可提问并自动回帖

> 详细安装与操作顺序见上文 **[从零开始（推荐操作顺序）](#从零开始推荐操作顺序)**。

## 命令速查

### 宿主 CLI

```
lark-opencode-bridge              前台启动（默认 = run）
lark-opencode-bridge run          前台启动 bot
lark-opencode-bridge start        安装并启动后台 daemon（macOS / Linux）
lark-opencode-bridge stop         停止后台 daemon
lark-opencode-bridge restart      重启后台 daemon
lark-opencode-bridge unregister   撤销后台服务注册
lark-opencode-bridge setup        仅跑扫码向导（不启动 bridge）
lark-opencode-bridge configure    自动配置应用名、长连接事件、卡片回调
lark-opencode-bridge scopes       打印推荐权限 JSON
lark-opencode-bridge doctor       依赖与配置自检
lark-opencode-bridge ps           列出本机 bridge 进程
lark-opencode-bridge status       查看后台服务与配置摘要
lark-opencode-bridge service install|start|stop|uninstall  （与 start/stop 等价）
```

> 后台服务仅支持 **macOS / Linux**。`start` 等命令需 **全局安装**（`npm i -g`），勿用 npx。

### 飞书内斜杠命令

在飞书聊天里**单独发一行**以 `/` 开头的命令即可（也支持多行消息里**最后一行**是命令）。  
斜杠命令由 bridge **本地即时处理**，不经过 opencode，一般秒回。

**怎么发消息**

| 场景 | 用法 |
|---|---|
| 私聊机器人 | 直接发文字；发 `/help` 看全部命令 |
| 普通群 | 必须 **`@机器人`** 再发（或 @ 后带命令） |
| `/spawn` 建的工作群 | **不用 @**，直接发即可 |
| 带图片 / 文件 / 富文本 | 正常发，bridge 会下载附件交给 opencode |
| 云文档评论 | 在评论里 **@机器人** 提问，会自动回帖 |

**别名说明**：命令名不区分大小写。下列写法等价：

- `/clear` → `/new`
- `/summarize` → `/compact`
- `/resume`、`/continue` → `/sessions`
- `/model` → `/models`，`/agent` → `/agents`，`/ws` → `/workspaces`
- `/group`、`/拉群` → `/spawn`

**管理员命令**：若在 `/config` 里设置了「管理员 open_id 列表」，则下表标注 🔒 的命令仅管理员可用；列表为空时所有人可用。

---

#### 会话与任务

| 命令 | 别名 | 说明 |
|---|---|---|
| `/help` | — | 显示完整帮助（与本文一致） |
| `/new` | `/clear` | 重置**本聊天**的 opencode 会话，清空上下文 |
| `/init` | — | 让 opencode 分析当前工作目录，生成或更新根目录 `AGENTS.md` |
| `/sessions` | `/resume`、`/continue` | 列出 opencode 里已有的会话（调试用） |
| `/compact` | `/summarize` | 压缩当前会话历史，保留要点、释放上下文 |
| `/share` | — | 为当前会话生成公开分享链接 |
| `/unshare` | — | 取消当前会话的分享 |
| `/undo` | — | 撤销上一条用户消息及其产生的文件改动 |
| `/redo` | — | 恢复被 `/undo` 掉的内容 |
| `/stop` | — | **中断**当前正在跑的任务（相当于 ESC） |

#### 模型与 Agent

| 命令 | 别名 | 说明 |
|---|---|---|
| `/models` | `/model` | 列出 opencode 可用的 provider 与模型 |
| `/models <provider/model>` | `/model …` | 切换**本聊天**使用的模型；只写模型名时会尝试自动补全 provider |
| `/agents` | `/agent` | 列出可用 agent（如 `build`、`plan`） |
| `/agents <name>` | `/agent …` | 切换**本聊天**使用的 agent |

#### 目录、状态与工作群

| 命令 | 别名 | 说明 |
|---|---|---|
| `/cd <绝对路径>` | — | 设置**本聊天**的工作目录（会重建会话） 🔒 |
| `/status` | — | 查看 session id、cwd、agent、模型、WebSocket 状态、空闲超时等 |
| `/spawn <主题>` | `/group`、`/拉群` | **仅 P2P 私聊可用**。创建名为 `[opencode] <主题>` 的群，拉你进群并绑定新 session；**群内无需 @** 🔒 |
| `/workspaces list` | `/ws list` | 列出已保存的命名工作目录 🔒 |
| `/workspaces save <名> [路径]` | `/ws save …` | 保存工作目录（默认当前 cwd） 🔒 |
| `/workspaces use <名>` | `/ws use …` | 切换到已保存的工作目录（会重建会话） 🔒 |
| `/workspaces rm <名>` | `/ws rm …` | 删除已保存的工作目录 🔒 |

#### 运维与设置

| 命令 | 别名 | 说明 |
|---|---|---|
| `/reconnect` | — | 手动重连飞书 WebSocket（消息收不到时可试） 🔒 |
| `/timeout [分钟]` | — | 不带参数：查看本聊天与全局空闲超时；`/timeout 30` 设 30 分钟无输出则中断；`/timeout 0` 关闭 |
| `/doctor [描述]` | — | 把最近 bridge 日志交给 opencode 做**自诊断**（可附带问题描述） 🔒 |
| `/config` | — | 打开**偏好设置卡片**：回复方式（reply/card）、访问白名单、群 @ 策略、文档评论开关等 🔒 |

`/config` 卡片里可改的主要项：

- **reply / card**：普通 markdown 回复 vs 流式交互卡片
- **空闲超时、消息批处理间隔**
- **是否处理云文档评论**、**群聊是否必须 @**
- **允许发言的用户 / 群 ID**、**管理员 ID**

提交后立即写入 `~/.lark-opencode-bridge/config.json`，**无需重启** bridge。

---

**示例**

```text
/help
/status
/models anthropic/claude-sonnet-4
/agents build
/cd /Users/me/my-project
/spawn 重构登录模块
/workspaces save main /Users/me/my-project
/workspaces use main
/timeout 45
/doctor 私聊有回复但群里 @ 没反应
```

**不是斜杠命令**：除上表外，所有普通文字（以及图片、文件）都会作为 **opencode 对话** 处理；多个会话之间通过「每个 chat_id 独立 session」隔离。

## 数据目录

| 路径 | 内容 |
|---|---|
| `~/.lark-opencode-bridge/config.json` | bridge 运行配置（端口、cwd、replyStyle 等） |
| `~/.lark-opencode-bridge/secrets.json` | app secret（setup 写入，权限 600） |
| `~/.lark-opencode-bridge/sessions.json` | chat → opencode session 映射 |
| `~/.lark-opencode-bridge/workspaces.json` | 命名工作空间 |
| `~/.lark-opencode-bridge/media/` | 下载的附件 |
| `~/.lark-opencode-bridge/logs/` | 运行日志 |

`~/.lark-cli/config.json` 由 lark-cli / 扫码向导维护（app id、profile 等）。

## 许可

[MIT](./LICENSE)
