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
openclaw plugins install @invago/mixin
```

`@invago/mixin` 是发布后的 npm 包名，OpenClaw 内部的运行时/插件名称仍然是 `mixin`。

如果插件已经安装过，后续升级请直接用插件 ID：

```bash
openclaw plugins update mixin
```

如果你要首次安装指定版本，也可以直接带版本号：

```bash
openclaw plugins install @invago/mixin@<version>
```

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
      "defaultAccount": "default",
      "appId": "你的 App ID",
      "sessionId": "你的 Session ID",
      "serverPublicKey": "服务端公钥 Base64",
      "sessionPrivateKey": "会话私钥 Base64",
      "dmPolicy": "pairing",
      "allowFrom": ["授权用户 UUID"],
      "requireMentionInGroup": true,
      "mediaBypassMentionInGroup": true,
      "mediaMaxMb": 30,
      "audioSendAsVoiceByDefault": true,
      "audioAutoDetectDuration": true,
      "audioRequireFfprobe": false,
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
- Mixin 现在支持 OpenClaw 官方的私聊 `dmPolicy`，推荐使用 `dmPolicy: "pairing"`。
- `allowFrom` 仍然保留，适合预授权用户或人工补充白名单；配对批准结果会写入 OpenClaw 的 pairing allowlist store。
- 如果 `proxy.url` 已经包含认证信息，可以不再填写 `proxy.username` 和 `proxy.password`。

## 配对模式

私聊推荐配置：

```json
{
  "channels": {
    "mixin": {
      "dmPolicy": "pairing"
    }
  }
}
```

行为说明：

- 未授权的私聊用户会先收到一个 8 位配对码。
- 管理员使用 `openclaw pairing approve mixin <code>` 完成批准。
- 使用 `openclaw pairing list mixin` 查看待批准的配对请求。
- 批准后，该用户会被加入 OpenClaw 的 `mixin` pairing allowlist store。
- `allowFrom` 仍然生效，可以和 pairing 一起使用。

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
| `defaultAccount` | 否 | `default` | 配置了 `accounts` 时默认使用的账号 ID |
| `appId` | 是 | - | Mixin 应用 UUID |
| `sessionId` | 是 | - | 会话 UUID |
| `serverPublicKey` | 是 | - | 服务端公钥 Base64 |
| `sessionPrivateKey` | 是 | - | 会话私钥 Ed25519 Base64 |
| `dmPolicy` | 否 | `pairing` | 私聊策略：`pairing`、`allowlist`、`open`、`disabled` |
| `allowFrom` | 否 | `[]` | 授权用户 UUID 白名单 |
| `groupPolicy` | 否 | 跟随 OpenClaw 默认值 | 群消息策略：`open`、`allowlist`、`disabled` |
| `groupAllowFrom` | 否 | `[]` | 当 `groupPolicy` 走 allowlist 时，允许触发群消息的发送者 UUID 白名单 |
| `requireMentionInGroup` | 否 | `true` | 群聊是否要求触发词 |
| `mediaBypassMentionInGroup` | 否 | `true` | 群里的文件/语音消息是否可绕过文本触发词过滤 |
| `mediaMaxMb` | 否 | `30` | 入站和出站媒体大小上限，单位 MB |
| `audioSendAsVoiceByDefault` | 否 | `true` | OpenClaw 原生音频出站时尽量按 Mixin 语音发送 |
| `audioAutoDetectDuration` | 否 | `true` | 发送原生音频前是否用 `ffprobe` 自动探测时长 |
| `audioRequireFfprobe` | 否 | `false` | 时长探测不可用时是否直接失败，而不是降级为文件发送 |
| `conversations.<conversationId>.enabled` | 否 | `true` | 是否启用某个指定群会话 |
| `conversations.<conversationId>.requireMention` | 否 | 继承账号级配置 | 覆盖该群会话的触发词要求 |
| `conversations.<conversationId>.allowFrom` | 否 | 继承账号级配置 | 覆盖该群会话的发送者白名单 |
| `conversations.<conversationId>.mediaBypassMention` | 否 | 继承账号级配置 | 覆盖该群会话中文件/语音是否绕过触发词过滤 |
| `conversations.<conversationId>.groupPolicy` | 否 | 继承账号级配置 | 覆盖该群会话的群消息策略 |
| `debug` | 否 | `false` | 调试模式 |
| `proxy.enabled` | 否 | `false` | 是否启用插件级代理 |
| `proxy.url` | 启用时必填 | - | 代理地址，例如 `http://127.0.0.1:7890` 或 `socks5://127.0.0.1:10808` |
| `proxy.username` | 否 | - | 代理用户名 |
| `proxy.password` | 否 | - | 代理密码 |

## 代理

- Mixin 的 HTTP 请求和 Blaze WebSocket 都会走同一个代理。
- 常见代理地址格式包括 `http://...`、`https://...`、`socks5://...`。
- 代理软件或代理服务器需要你自己提供，插件只负责使用代理。

## 群聊访问控制

现在除了私聊 `dmPolicy`，Mixin 也支持正式的群聊访问控制：

- `groupPolicy: "open"` 表示群里任何发送者都可以触发。
- `groupPolicy: "allowlist"` 表示只有 `groupAllowFrom` 里的发送者 UUID 可以触发。
- `groupPolicy: "disabled"` 表示整个群会话被禁用。
- `conversations.<conversationId>` 可以对某一个群会话覆盖账号级配置。

示例：

```json
{
  "channels": {
    "mixin": {
      "groupPolicy": "allowlist",
      "groupAllowFrom": ["USER_A_UUID"],
      "conversations": {
        "70000000-0000-0000-0000-000000000001": {
          "requireMention": false,
          "allowFrom": ["USER_B_UUID"],
          "mediaBypassMention": false
        },
        "70000000-0000-0000-0000-000000000002": {
          "enabled": false
        }
      }
    }
  }
}
```

## 使用方式

- 私聊：`/status` 或 `你好`
- 群聊：`@Bot 你的问题`，并带上 `?` 或 `help` 等触发词

## 运维

常用 OpenClaw 命令：

```bash
openclaw plugins list
openclaw plugins info mixin
openclaw plugins update mixin
openclaw channels status --probe
openclaw status
```

插件内诊断命令：

- 发送 `/mixin-outbox` 可查看当前待发队列数量、下次重试时间和最近错误。
- 发送 `/mixin-outbox purge-invalid` 可删除历史遗留的 `APP_CARD` / `APP_BUTTON_GROUP` 永久无效重试项。

配套运维 CLI：

- 仓库里已经附带了一套配套工具，见 [tools/mixin-plugin-onboard/README.md](/E:/AI/mixin-claw/tools/mixin-plugin-onboard/README.md)。
- 这套工具会和主包 `@invago/mixin` 一起发布，不再是单独第二个 npm 包。
- 当前提供 `info`、`doctor`、`install`、`update` 四个命令，用于本地 OpenClaw + Mixin 插件的安装和诊断。
- 本地运行示例：
  - `node --import jiti/register.js tools/mixin-plugin-onboard/src/index.ts info`
  - `node --import jiti/register.js tools/mixin-plugin-onboard/src/index.ts doctor`
- 安装后使用示例：
  - `npx -y @invago/mixin info`
  - `npx -y @invago/mixin doctor`

## 投递与重试行为

- 回复消息会先写入本地 outbox，再由后台 worker 发送。
- 发送失败会自动重试，直到发送成功。
- 插件重启后，未完成的消息仍会继续补发。
- 入站 Blaze 消息会在分发前尽快 ACK，尽量减少 Mixin 的重复推送。

## 媒体支持现状

当前媒体能力分为发送侧和接收侧：

- OpenClaw 原生媒体发送已经接入频道 `sendMedia`。
- OpenClaw 原生 `sendPayload` 现在也会复用同一套 Mixin 出站 planner，所以文本、长文、按钮、卡片、文件、语音的选择逻辑和 agent 缓冲回复保持一致。
- 当插件能把媒体识别为音频并成功拿到时长时，会优先按 `PLAIN_AUDIO` 发送。
- 如果拿不到音频时长，会平稳降级为普通文件附件发送。
- 非音频媒体会按 Mixin 文件附件发送。
- 如果 OpenClaw 同时给出文本和媒体，插件会先发文本，再发文件。
- 语音气泡式发送目前仍更适合走显式 `mixin-audio` 模板。
- 入站 `PLAIN_DATA` 和 `PLAIN_AUDIO` 会被下载到本地，并通过 `MediaPath` / `MediaType` 挂到 OpenClaw 入站上下文。
- 即使启用了 `requireMentionInGroup`，群里的附件消息也不会再因为缺少文本触发词被直接过滤；如果你把 `mediaBypassMentionInGroup` 设为 `false`，则会恢复和普通文本相同的群聊触发规则。

当前边界：

- 发送语音时不做自动转码。
- `mixin-audio` 仍要求你提供已经准备好的本地文件，并显式给出 `duration`，`waveForm` 可选。
- OpenClaw 原生音频发送依赖本机可用的 `ffprobe` 来提取时长。
- OpenClaw 原生 `sendMedia` 仍不会自动生成 `waveForm`，所以如果你想更稳定地控制语音消息效果，显式 `mixin-audio` 仍然是最稳妥的路径。
- 是否能自动总结文件、转写语音，取决于你的 OpenClaw 媒体理解配置是否开启。

联调手册：

- 见 [docs/media-testing.zh-CN.md](docs/media-testing.zh-CN.md)。

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

文件：

```text
```mixin-file
{
  "filePath": "/absolute/path/to/report.pdf",
  "fileName": "report.pdf",
  "mimeType": "application/pdf"
}
```
```

语音：

```text
```mixin-audio
{
  "filePath": "/absolute/path/to/voice.ogg",
  "mimeType": "audio/ogg",
  "duration": 12,
  "waveForm": "AAMMQQ=="
}
```
```

规则：

- 显式模板优先级高于自动识别。
- 回复里只要出现表格或 fenced code block，默认就会走 `mixin-post` 长文。
- `mixin-buttons` 和 `mixin-card` 只接受 JSON。
- `mixin-file` 和 `mixin-audio` 也只接受 JSON。
- `mixin-file` 和 `mixin-audio` 里的 `filePath` 必须是 OpenClaw 所在机器上的绝对路径。
- `mixin-audio` 里的 `duration` 必填，单位为秒，`waveForm` 可选。
- 如果显式 `mixin-*` 模板写错，插件不再静默跳过，而会直接发出可见的 `Mixin template error: ...` 文本提示。
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
          "dmPolicy": "pairing",
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
| 收不到消息 | 检查 pairing 是否已批准或 `allowFrom` 是否包含该用户，同时检查触发词和 Blaze 连通性 |
| 消息发不出去 | 检查代理是否可达、outbox 堆积情况和 `/mixin-outbox` 输出 |
| 入站消息重复推送 | 检查 Blaze 连通性，并确认 ACK 是否正常发送 |

## 安全提示

- 妥善保管 `sessionPrivateKey`
- 生产环境建议使用 `dmPolicy: "pairing"` 或严格的 `allowFrom`
- outbox 文件会保存待发送消息正文，不要暴露 `data/` 目录

## 相关链接

- [OpenClaw 文档](https://openclaw.ai)
- [OpenClaw 插件文档](https://docs.openclaw.ai/tools/plugin)
- [OpenClaw 插件 CLI](https://docs.openclaw.ai/cli/plugins)
- [OpenClaw 配置说明](https://docs.openclaw.ai/gateway/configuration)
- [OpenClaw 配置参考](https://docs.openclaw.ai/gateway/configuration-reference)
- [Mixin Developers Dashboard](https://developers.mixin.one/dashboard)
- [Mixin Bot API 文档](https://developers.mixin.one/docs/bot-api)
