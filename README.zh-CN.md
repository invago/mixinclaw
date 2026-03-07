# MixinClaw

将 [Mixin Messenger](https://mixin.one/messenger) 接入 [OpenClaw](https://openclaw.ai)。

**[English Documentation](README.md)**

## 概览

MixinClaw 是一个 OpenClaw 频道插件。它运行在 OpenClaw Gateway 同一进程中，使用 Mixin Blaze WebSocket 接收消息，并通过 Mixin HTTP API 发送消息。

重要说明：

- 插件需要安装在 OpenClaw Gateway 所在的机器上。
- OpenClaw 配置文件是 `openclaw.json`，需要手动编辑。
- OpenClaw 配置文件是 JSON5 格式，支持注释和尾逗号。
- 这里配置的代理只作用于这个插件，不影响其他插件。

## 推荐安装方式

优先使用 OpenClaw 官方插件安装命令：

```bash
openclaw plugins install @invago/mixinclaw
```

`@invago/mixinclaw` 是发布后的安装标识，包内的运行时/插件名称仍然是 `mixin`。

安装后可用以下命令确认：

```bash
openclaw plugins list
openclaw plugins info mixin
```

## 本地开发安装

如果你是在本地开发，先克隆仓库并安装依赖：

```bash
git clone https://github.com/invago/mixinclaw.git
cd mixinclaw
npm install
```

然后通过本地路径安装到 OpenClaw：

```bash
openclaw plugins install .
```

## 创建 Mixin Bot

前往 [Mixin Developers Dashboard](https://developers.mixin.one/dashboard)，创建机器人并记录以下凭证：

- `appId`
- `sessionId`
- `serverPublicKey`
- `sessionPrivateKey`

## 配置

手动编辑 `openclaw.json`，同时添加频道配置和插件启用配置：

```json
{
  "channels": {
    "mixin": {
      "enabled": true,
      "appId": "你的 App ID",
      "sessionId": "你的 Session ID",
      "serverPublicKey": "服务端公钥 Base64",
      "sessionPrivateKey": "会话私钥 Base64",
      "allowFrom": ["授权用户 UUID"],
      "proxy": {
        "enabled": true,
        "url": "socks5://127.0.0.1:10808",
        "username": "proxy-user",
        "password": "proxy-pass"
      }
    }
  },
  "plugins": {
    "allow": ["mixin"],
    "entries": {
      "mixin": {
        "enabled": true
      }
    }
  }
}
```

说明：

- `channels.mixin` 负责配置这个频道本身。
- `plugins.allow` 和 `plugins.entries.mixin.enabled` 也需要配置，否则 OpenClaw 不会加载这个插件。
- 当前插件使用 `allowFrom` 作为发送者白名单，不要直接套用其他 OpenClaw 通用 DM 策略字段，除非插件明确支持。
- 如果 `proxy.url` 已经包含认证信息，可以不再填写 `proxy.username` 和 `proxy.password`。

## 避免跨通道串会话

Mixin 群聊本身会按频道隔离，但私聊会话是否独立，取决于 OpenClaw 的 `session.dmScope` 配置。如果保持默认的 `main`，Mixin 私聊可能会和飞书等其它通道共用同一个主会话。

推荐这样配置：

```json
{
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

如果你同时运行多个 Mixin 账号，并且希望私聊按“账号 + 频道”进一步隔离，可以改用 `per-account-channel-peer`。

## 配置参数

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | 否 | `true` | 是否启用该频道账号 |
| `appId` | 是 | - | Mixin 应用 UUID |
| `sessionId` | 是 | - | 会话 UUID |
| `serverPublicKey` | 是 | - | 服务端公钥 Base64 |
| `sessionPrivateKey` | 是 | - | 会话私钥 Ed25519 Base64 |
| `allowFrom` | 否 | `[]` | 授权用户 UUID 白名单 |
| `requireMentionInGroup` | 否 | `true` | 群聊是否要求触发词 |
| `debug` | 否 | `false` | 调试模式 |
| `proxy.enabled` | 否 | `false` | 是否启用插件级代理 |
| `proxy.url` | 启用时必填 | - | 代理地址，例如 `http://127.0.0.1:7890` 或 `socks5://127.0.0.1:10808` |
| `proxy.username` | 否 | - | 代理用户名 |
| `proxy.password` | 否 | - | 代理密码 |

## 代理

- Mixin 的 HTTP 请求和 Blaze WebSocket 都会走同一个代理。
- 常见代理地址格式包括 `http://...`、`https://...`、`socks5://...`。
- 代理软件或代理服务器需要你自己提供，插件只负责使用代理。

## 使用方式

- 私聊：`/status` 或 `你好`
- 群聊：`@Bot 你的问题`，并带上 `?` 或 `help` 等触发词

## 运维

常用 OpenClaw 命令：

```bash
openclaw plugins list
openclaw plugins info mixin
openclaw channels status --probe
openclaw status
```

插件内诊断命令：

- 发送 `/mixin-outbox` 可查看当前待发队列数量、下次重试时间和最近错误。

## 投递与重试行为

- 回复消息会先写入本地 outbox，再由后台 worker 发送。
- 发送失败会自动重试，直到发送成功。
- 插件重启后，未完成的消息仍会继续补发。
- 入站 Blaze 消息会在分发前尽快 ACK，尽量减少 Mixin 的重复推送。

## 显式回复模板

如果你希望 Mixin 回复严格按指定形式发送，而不是依赖自动判断，可以让 agent 只输出一个 fenced code block 模板。

文本：

```text
```mixin-text
简短纯文本回复
```
```

长文：

```text
```mixin-post
# 发布说明

- 条目 1
- 条目 2
```
```

按钮组：

```text
```mixin-buttons
{
  "intro": "请选择操作",
  "buttons": [
    { "label": "打开文档", "action": "https://docs.openclaw.ai" },
    { "label": "打开 Mixin", "action": "https://developers.mixin.one" }
  ]
}
```
```

卡片：

```text
```mixin-card
{
  "title": "OpenClaw 文档",
  "description": "打开官方文档站点。",
  "action": "https://docs.openclaw.ai",
  "coverUrl": "https://example.com/cover.png",
  "shareable": true
}
```
```

规则：

- 显式模板优先级高于自动识别。
- 回复里只要出现表格或 fenced code block，默认就会走 `mixin-post` 长文。
- `mixin-buttons` 和 `mixin-card` 只接受 JSON。
- 按钮和卡片链接必须使用 `http://` 或 `https://`。
- Mixin 客户端可能要求目标域名已加入机器人应用的 `Resource Patterns` 白名单。

## 多账号示例

```json
{
  "channels": {
    "mixin": {
      "accounts": {
        "bot1": {
          "name": "客服机器人",
          "appId": "...",
          "sessionId": "...",
          "serverPublicKey": "...",
          "sessionPrivateKey": "...",
          "allowFrom": ["..."]
        },
        "bot2": {
          "name": "技术支持机器人",
          "appId": "...",
          "sessionId": "...",
          "serverPublicKey": "...",
          "sessionPrivateKey": "...",
          "proxy": {
            "enabled": true,
            "url": "http://127.0.0.1:7890"
          }
        }
      }
    }
  },
  "plugins": {
    "allow": ["mixin"],
    "entries": {
      "mixin": {
        "enabled": true
      }
    }
  }
}
```

## 故障排查

| 问题 | 检查项 |
|------|--------|
| 插件未加载 | 运行 `openclaw plugins list` 和 `openclaw plugins info mixin` |
| 频道未启动 | 检查 `channels.mixin` 是否存在，凭证是否完整 |
| 插件未启用 | 检查 `plugins.allow` 和 `plugins.entries.mixin.enabled` |
| 收不到消息 | 检查 `allowFrom`、触发词和 Blaze 连通性 |
| 消息发不出去 | 检查代理是否可达、outbox 堆积情况和 `/mixin-outbox` 输出 |
| 入站消息重复推送 | 检查 Blaze 连通性，并确认 ACK 是否正常发送 |

## 安全提示

- 妥善保管 `sessionPrivateKey`
- 生产环境务必配置 `allowFrom`
- outbox 文件会保存待发送消息正文，不要暴露 `data/` 目录

## 相关链接

- [OpenClaw 文档](https://openclaw.ai)
- [OpenClaw 插件文档](https://docs.openclaw.ai/tools/plugin)
- [OpenClaw 插件 CLI](https://docs.openclaw.ai/cli/plugins)
- [OpenClaw 配置说明](https://docs.openclaw.ai/gateway/configuration)
- [OpenClaw 配置参考](https://docs.openclaw.ai/gateway/configuration-reference)
- [Mixin Developers Dashboard](https://developers.mixin.one/dashboard)
- [Mixin Bot API 文档](https://developers.mixin.one/docs/bot-api)
