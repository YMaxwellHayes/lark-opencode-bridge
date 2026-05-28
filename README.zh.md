# lark-opencode-bridge

[![CI](https://github.com/YMaxwellHayes/lark-opencode-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/YMaxwellHayes/lark-opencode-bridge/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/lark-opencode-bridge.svg)](https://www.npmjs.com/package/lark-opencode-bridge)

> 🌉 **一句话：** 把你本地已经在用的 [opencode](https://opencode.ai) 编程 agent 接进飞书。手机也能驱动、能拉群协作、会话能留存、飞书文档与附件原生打通。
>
> 云端不跑模型、不托管你的代码、不要你再注册任何账号——代码和执行始终在你本机。

```bash
npm i -g lark-opencode-bridge@latest
lark-opencode-bridge run
```

[English](./README.md) · [GitHub](https://github.com/YMaxwellHayes/lark-opencode-bridge) · [npm](https://www.npmjs.com/package/lark-opencode-bridge)

---

## 目录

- [这是什么](#这是什么)
- [它和谁都不一样](#它和谁都不一样)
- [解决的痛点](#解决的痛点)
- [招牌能力：`/spawn` 工作群](#招牌能力spawn-工作群)
- [其他核心能力](#其他核心能力)
- [典型场景](#典型场景)
- [前提与适用边界](#前提与适用边界)
- [从零开始（推荐操作顺序）](#从零开始推荐操作顺序)
- [飞书内斜杠命令](#飞书内斜杠命令)
- [配置](#配置)
- [数据目录](#数据目录)
- [运行原理](#运行原理)
- [项目结构](#项目结构)
- [FAQ](#faq)
- [License](#license)

---

## 这是什么

你在飞书里发一条消息——桥把它转发给你电脑上跑着的 opencode；opencode 在你指定的项目目录里干活（读代码、改文件、跑命令、调用 LSP），过程和结果以**一张实时刷新的飞书卡片**回传。

云端不跑模型、不托管你的代码、不要你再注册任何账号。代码和执行始终在你本机；飞书侧只负责"传话"和"展示"。

![数据流：飞书消息 → 桥 → 本机 opencode → 流式卡片回传](./docs/img/data-flow.svg)

---

## 它和谁都不一样

新用户最容易混淆的地方。先把定位讲清楚：

| 类型 | 代表 | 差异 |
|---|---|---|
| **通用个人 agent** | OpenClaw / Hermes | 什么都沾一点；做严肃 coding 项目时深度不够 |
| **Claude Code 飞书桥** | 同类项目大多绑 Claude Code | 本项目接的是 **opencode**，自带模型自由、不锁定厂商 |
| **直接终端用 opencode** | opencode TUI | 不能移动、不能协作、关掉就散；本项目把它延伸到飞书生态 |

> ✅ **一句话定位：** 把一个**专业编程 agent（opencode）**接进飞书，而不是又造一个通用助手。

---

## 解决的痛点

你已经在用 opencode，但它有几个天生的不便：

| 痛点 | 直接用 opencode | 用这座桥 |
|---|---|---|
| 只能坐电脑前 | 终端锁死本机 | 手机/平板/任意设备的飞书都能发指令 |
| 单人作战 | 上下文锁在你一人脑里 | 拉群协作，多人围着同一个 agent |
| 会话易丢 | 关终端上下文就散 | `/spawn` 把会话钉成群，随时回去接着聊 |
| 喂材料麻烦 | 手动贴路径/代码 | 直接发飞书文件/截图、@机器人评论云文档 |

---

## 招牌能力：`/spawn` 工作群

`/spawn` 是本项目最值得讲的功能。它把"你与 opencode 的一次会话"实体化成一个飞书群：**一个群 = 一个独立 session = 一份项目上下文**。

| 💾 会话即留存 | 👥 会话即协作 | 🔁 P2P → P2A2P |
|---|---|---|
| 想继续哪个项目，回到对应群就行——上下文都在，不用重讲背景。 | 拉产品/研发/测试进同一个群，共享 agent 上下文，群里发消息即用（无需 @）。 | 从"人脑→人脑"升级到"人→agent→人"，agent 居中传递上下文。 |

![P2P vs P2A2P 协作模型对比](./docs/img/spawn-collaboration.svg)

> 📝 **举个例子：** 新功能上线时，产品在 `/spawn` 群里把背景、目标、边界讲给 opencode 并让它结合代码库理解；研发进同一个群，不必从头啃 PRD，直接问 agent "这块上下文是什么 / 做到哪了 / 为什么这么设计"。agent 成为双方共享、始终在线的"上下文中枢"。

---

## 其他核心能力

- **扫码即用** — 首次运行弹二维码，飞书一扫完成应用绑定。无需去开放平台手抄 App Secret。
- **流式卡片** — opencode 的思考、工具调用、文本输出实时更新在**同一张卡片**上，跑偏可随时点"终止"。
- **云文档评论** — 在飞书文档/表格里 @机器人写评论，agent 结合代码库读评论 + 上下文后把答案**回填到评论区**。
- **附件直传** — 截图、文件直接发给机器人，agent 读取本机下载的文件。报错截图让它定位、丢日志让它分析都行。
- **多工作空间** — `/workspaces`（别名 `/ws`）在多个项目目录间切换，每个目录各自独立 session 互不串台。
- **可托管** — 支持后台守护进程（开机自启、崩溃自拉起），长期挂着随时响应。

---

## 典型场景

| 场景 | 说明 |
|---|---|
| 📱 **移动办公** | 通勤/出差时用手机飞书让公司电脑跑 opencode——改 bug、查逻辑、补测试。 |
| 🤝 **跨角色协作** | `/spawn` 一个项目群，产品交代需求、研发推进，都围着同一个 agent。 |
| 📄 **文档驱动开发** | 技术方案/接口文档里 @机器人，让它对照真实代码回答评论疑问。 |
| 🔍 **随手排障** | 报错截图或日志发给机器人，agent 边看图边读代码定位根因。 |

---

## 前提与适用边界

**用之前你需要：**

1. 本机装好 opencode 并配好至少一个模型 provider（支持 Anthropic / OpenAI / Gemini / OpenRouter 等）
2. Node.js ≥ 20
3. 一个飞书账号（首次扫码绑定，向导引导建应用）

| ✅ 适合谁 | ❌ 不适合谁 |
|---|---|
| 有真实 coding 需求、本机在用或愿意用 opencode、想把能力延伸到飞书与团队的人。 | 想要"什么都能聊"的通用助手（那是 OpenClaw / Hermes 的领域），或不想本机装 opencode 的人。 |

---

## 从零开始（推荐操作顺序）

> **给第一次用的人**：请严格按下面顺序做，**不要跳步**。第一次必须在前台跑 `run` 完成扫码；**不要**一上来就 `start` 开后台。

![四步流程：装 opencode → 装桥 → 扫码 → 飞书发消息](./docs/img/quick-start.svg)

### 第 0 步：安装 Node.js

需要 **Node.js ≥ 20**：

```bash
node -v   # 应显示 v20.x 或更高
```

没有 Node？去 [nodejs.org](https://nodejs.org/) 下载 LTS，或用 Homebrew：`brew install node`。

### 第 1 步：安装 opencode

bridge 会调用本机的 `opencode` 命令（会自动起 `opencode serve`），**无需单独登录**，但必须先装好并在 PATH 里。

```bash
# 方式 A — 官方脚本（macOS / Linux 推荐）
curl -fsSL https://opencode.ai/install | bash

# 方式 B — Homebrew
brew install anomalyco/tap/opencode

# 方式 C — npm
npm install -g opencode-ai@latest
```

装完后**新开一个终端**，验证：

```bash
opencode --version
```

还要配置好 opencode 的模型 / API（按 [opencode 文档](https://opencode.ai/docs) 操作）。没配模型的话，机器人能收到消息但 AI 可能不回或报错；私聊发 `/models` 可查看可用模型。

### 第 2 步：安装飞书 CLI（lark-cli）

发消息、回消息、调开放平台 API 都靠它。请装官方包 **`@larksuite/cli`**（npm 上另一个叫 `lark-cli` 的包**不是**这个）。

```bash
npm install -g @larksuite/cli@latest
lark-cli --version
```

> 首次 `lark-opencode-bridge run` 时也会尝试自动安装/升级 lark-cli，但**建议先手动装好**，少踩 PATH 的坑。

### 第 3 步：安装 lark-opencode-bridge

```bash
npm install -g lark-opencode-bridge@latest
lark-opencode-bridge --version
lark-opencode-bridge doctor
```

`doctor` 里 `lark-cli`、`opencode` 都应是 **ok**。

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

### 第 6 步：在飞书里验证

1. 在飞书里找到你的机器人，**先私聊**
2. 发送：`/help`
   - 有回复 → 链路通了
   - 没回复 → 看下方「常见问题」，或终端 / `~/.lark-opencode-bridge/logs/` 里的日志
3. **普通群**里说话必须 **`@机器人`**；或用 `/spawn 主题` 建专用工作群（群内不用 @）

### 第 7 步（可选）：后台常驻

**确认第 6 步私聊 `/help` 正常后**，再开后台（仅 macOS / Linux）：

```bash
# 先 Ctrl+C 停掉前台 run
lark-opencode-bridge start
lark-opencode-bridge status
```

日志：`~/.lark-opencode-bridge/logs/`

> 后台服务必须用 **`npm i -g` 全局安装**，不要用 `npx`。

### 常见问题

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 私聊 `/help` 无回复 | 应用版本未发布 / 事件未开长连接 | 重做第 5 步 |
| 群里说话不回 | 没 @ 机器人 | 群里 `@机器人` 再发，或 `/spawn` 建群 |
| `start` 后仍不回 | 没先完成扫码，或 PATH 缺 opencode | 先 `run` 扫码；`doctor` 检查 |
| AI 不回但 `/help` 正常 | opencode 未配模型 | 配 API；私聊发 `/models` |
| `doctor` 报 opencode / lark-cli MISSING | 未安装或不在 PATH | 重做第 1、2 步，**新开终端**再试 |

---

## 飞书内斜杠命令

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

### 会话与任务

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

### 模型与 Agent

| 命令 | 别名 | 说明 |
|---|---|---|
| `/models` | `/model` | 列出 opencode 可用的 provider 与模型 |
| `/models <provider/model>` | `/model …` | 切换**本聊天**使用的模型；只写模型名时会尝试自动补全 provider |
| `/agents` | `/agent` | 列出可用 agent（如 `build`、`plan`） |
| `/agents <name>` | `/agent …` | 切换**本聊天**使用的 agent |

### 目录、状态与工作群

| 命令 | 别名 | 说明 |
|---|---|---|
| `/cd <绝对路径>` | — | 设置**本聊天**的工作目录（会重建会话） 🔒 |
| `/status` | — | 查看 session id、cwd、agent、模型、WebSocket 状态、空闲超时等 |
| `/spawn <主题>` | `/group`、`/拉群` | **仅 P2P 私聊可用**。创建名为 `[opencode] <主题>` 的群，拉你进群并绑定新 session；**群内无需 @** 🔒 |
| `/workspaces list` | `/ws list` | 列出已保存的命名工作目录 🔒 |
| `/workspaces save <名> [路径]` | `/ws save …` | 保存工作目录（默认当前 cwd） 🔒 |
| `/workspaces use <名>` | `/ws use …` | 切换到已保存的工作目录（会重建会话） 🔒 |
| `/workspaces rm <名>` | `/ws rm …` | 删除已保存的工作目录 🔒 |

### 运维与设置

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

---

## 配置

`~/.lark-opencode-bridge/config.json`：

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

- `model` 字符串以第一个 `/` 切分为 `{providerID, modelID}`（opencode 期望的结构）
- `defaultCwd` 在创建 session 时作为 `directory` 参数传入；`/cd` 切换 cwd 会重建该聊天的 session（opencode 在 session 创建时绑定 directory）
- `allowedSenderOpenIds` / `allowedChatIds` — 空数组 = 不限。填 `ou_…` / `oc_…` 限制
- `replyStyle` — `"card"`（默认，流式交互卡片）或 `"reply"`（普通 markdown 回复）
- `handleDocComments` — `true` 启用云文档评论 @ 回复
- `manageOpencodeServer` — `false` 时指向外部已跑的 `opencode serve`

更友好的方式：飞书里发 `/config` 用卡片改设置。

### 回复模式

`config.replyStyle`：

- **`card`**（默认）— bridge 立即发出"思考中…"卡片，订阅 opencode 的 SSE 事件流，每 ~800ms PATCH 卡片更新文本。仅渲染 `role: assistant` 的 parts，**不会回显用户自己的消息**。
- **`reply`** — bridge 等 prompt 完成后回单条 markdown 消息。

---

## 数据目录

| 路径 | 内容 |
|---|---|
| `~/.lark-opencode-bridge/config.json` | bridge 运行配置（端口、cwd、replyStyle 等） |
| `~/.lark-opencode-bridge/secrets.json` | app secret（setup 写入，权限 600） |
| `~/.lark-opencode-bridge/sessions.json` | chat → opencode session 映射 + spawned 群集合 |
| `~/.lark-opencode-bridge/workspaces.json` | 命名工作空间 |
| `~/.lark-opencode-bridge/media/` | 下载的附件（24h 自动清理） |
| `~/.lark-opencode-bridge/logs/` | 运行日志（JSONL，按天轮转，默认保留 7 天） |
| `~/.lark-opencode-bridge/processes.json` | 本机 bridge 进程注册表 |

`~/.lark-cli/config.json` 由 lark-cli / 扫码向导维护（app id、profile 等）。

环境变量：

- `LARK_OPENCODE_HOME` — 覆盖默认数据目录
- `LARK_OPENCODE_LOG_DAYS` — 日志保留天数（默认 7）

---

## 运行原理

1. `bridge run` 启动 `opencode serve` 子进程（除非 `manageOpencodeServer=false`），等待 `http://127.0.0.1:4096` 可用
2. 通过 `@larksuiteoapi/node-sdk` 建立飞书 WebSocket 长连接，订阅 `im.message.receive_v1` + `drive.notice.comment_add_v1` + 卡片回调
3. 每条事件按 `event_id` 去重，过白名单，群聊验 `@` 标记（`/spawn` 群除外）
4. 文本里第一行是斜杠命令 → bridge 本地处理；否则：
   - 按 `chat_id` 懒创建 opencode session（持久化到磁盘）
   - `POST /session/{id}/prompt_async`，订阅 SSE 流式更新
   - 卡片模式：把 SSE 增量渲染到飞书卡片，每 ~800ms patch 一次
   - 回复模式：等 session idle 后整条 markdown 回复
5. **消息合并 + 抢占**：短时间内连续发的多条消息会合并成一次 prompt；中途发新消息会抢占当前 run

### 文档评论流

```
飞书文档评论/回复 @机器人 ───► drive.notice.comment_add_v1 (WSClient)
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

- 每篇文档自己一个 opencode session（按 `file_token`），评论 thread 上下文连续
- 回复纯文本，截到 2000 字符（飞书评论上限）

### 附件流

收到 `image` / `file` / `post` 类型消息时：

1. `lark-cli im +messages-mget` 拉结构化消息（事件 payload 的 `content` 是渲染后的纯文本，不含 `image_key`/`file_key`）
2. 对每个 `image_key`/`file_key` 调 `+messages-resources-download` 下载到 `~/.lark-opencode-bridge/media/<message_id>/`
3. 以 `FilePartInput`（`file://` URL + 根据扩展名推断的 `mime`）传给 opencode

`post` 消息递归遍历 `tag: img` / `tag: file` 节点。

---

## 项目结构

```
src/
├── cli.ts                # commander 入口（run/start/stop/doctor/config/...)
├── config.ts             # config.json schema
├── session.ts            # chat_id → opencode session_id + cwd + spawned 集合
├── workspace.ts          # 命名工作空间
├── slash.ts              # 斜杠命令解析
├── paths.ts              # 文件系统路径
├── log.ts                # JSONL 日志 + 按天轮转 + recentLogEntries
├── preflight.ts          # 启动前依赖自检
│
├── core/
│   ├── bridge.ts         # 主编排（消息路由、prompt、卡片、评论、/spawn）
│   ├── pending-queue.ts  # 消息合并 + 抢占队列
│   └── idle-watchdog.ts  # 空闲超时看门狗
│
├── card/
│   ├── run-state.ts      # RunState 状态机
│   ├── run-renderer.ts   # 流式卡片渲染器（schema 2.0）
│   ├── agent-event.ts    # opencode SSE → AgentEvent 适配
│   └── tool-render.ts    # 工具块 markdown
│
├── lark/
│   ├── ws-consumer.ts    # LarkChannel WebSocket 事件入口
│   ├── sender.ts         # 发消息 / patch 卡片
│   ├── chats.ts          # 群组创建 / 改名（/spawn）
│   ├── attach.ts         # 附件下载
│   ├── comments.ts       # 评论拉取 + 回复
│   ├── credentials.ts    # 凭据解析
│   ├── wizard.ts         # 扫码向导
│   ├── keepalive.ts      # WS 健康检查 + 自动重连
│   └── ...               # scopes/app-setup/install 等
│
├── opencode/
│   ├── server.ts         # opencode serve 子进程管理
│   ├── client.ts         # HTTP 客户端
│   └── events.ts         # SSE 流式事件归一化
│
├── process/
│   ├── registry.ts       # processes.json 原子读写
│   └── conflicts.ts      # 同 app 多实例检测
│
├── service/
│   └── daemon.ts         # launchd（macOS）/ systemd（Linux）
│
└── media/
    └── cleanup.ts        # media 目录 24h 周期清理
```

---

## FAQ

**Q：和 OpenClaw / Hermes 区别？**
那是通用全能 agent；本项目专注把**专业编程 agent**（opencode）接进飞书。认真写代码用专业的。

**Q：没装 opencode 能用吗？**
不能。这是"桥"不是"agent"，驱动的是你本机的 opencode。

**Q：会上传我的代码吗？**
不会。代码与执行都在本机，飞书侧只过消息和卡片。

**Q：为什么是 opencode 不是 Claude Code？**
opencode 开源、终端原生、**模型自由**——按任务挑模型、控成本、不被单一厂商锁定。如果你已经在用 opencode，这座桥让它直接长在飞书里。

**Q：群里说话机器人不回？**
普通群必须 `@机器人`。或者用 `/spawn <主题>` 建专用工作群，群内无需 @。

**Q：Windows 能用吗？**
前台 `run` 能用；后台 daemon 只支持 macOS / Linux。

---

## License

[MIT](./LICENSE)
