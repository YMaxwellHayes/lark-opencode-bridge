# lark-opencode-bridge

[![CI](https://github.com/rorschachachxd/lark-opencode-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/rorschachachxd/lark-opencode-bridge/actions/workflows/ci.yml)

把飞书 / Lark 消息和本地 **opencode** CLI 打通的轻量 bot：一条命令起服务，扫码绑应用，在飞书里和 AI 对话、让它读图 / 改代码。

[English README](./README.md)

## 能干什么

- 私聊直接发；群里 `@bot`（`/spawn` 拉群后群内无需 @）
- **流式卡片**：opencode 输出实时更新到同一张卡片
- **会话延续**：每个 chat 独立 session
- **多工作空间**：`/workspaces`（别名 `/ws`）切换项目
- **图片 / 文件 / 富文本**：下载到本地后交给 opencode
- **云文档评论**：在文档评论里 `@bot` 可提问并自动回帖

## 前置条件

- Node.js **≥ 20**
- [`opencode`](https://opencode.ai) 已安装并在 `$PATH` 中（无需单独登录）
- 一个飞书 / Lark 应用（**首次 `run` 的扫码向导可帮你创建**）

## 安装

```bash
# 发布后
npm i -g lark-opencode-bridge
lark-opencode-bridge run

# 或从源码开发
git clone <this-repo> && cd lark-opencode-bridge
npm install && npm run build && npm link
```

## 首次启动

```bash
lark-opencode-bridge run
# 或直接
lark-opencode-bridge
```

第一次跑若检测到**没有飞书应用配置**，会**自动进入扫码向导**（并自动检测 / 安装最新版 **lark-cli**）：

1. 终端渲染二维码
2. 用飞书 App 扫码
3. 选择 / 创建应用（PersonalAgent 流程）
4. 凭据写入 `~/.lark-cli/config.json`，app secret 写入 `~/.lark-opencode-bridge/secrets.json`
5. 引导打开权限页并复制推荐 scope JSON（需在开发者后台批量导入并发布版本）

之后再次 `run` 会直接启动 bridge。

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

见 [English README — In-chat commands](./README.md#in-chat-commands)。常用：`/help` `/new` `/status` `/stop` `/spawn` `/workspaces` **`/config`** `/doctor` `/reconnect` `/timeout`。

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
