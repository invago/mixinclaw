# MixinClaw

将 [Mixin Messenger](https://mixin.one/messenger) 接入 [OpenClaw](https://openclaw.ai)。

**[English Documentation](README.md)**

## 概览

MixinClaw 是一个 OpenClaw 频道插件。它运行在 OpenClaw Gateway 同一进程中，使用 Mixin Blaze WebSocket 接收入站消息，并通过 Mixin HTTP API 发送出站消息。

重要说明：

- 插件需要安装在 OpenClaw Gateway 所在的机器上。
- OpenClaw 配置文件使用 JSON5，支持注释和尾逗号。
- 这里配置的代理只作用于这个插件，不影响其他插件。

## 推荐安装方式

优先使用 OpenClaw 官方插件安装命令：

```bash
openclaw plugins install @invago/mixin
```

`@invago/mixin` 是发布后的 npm 包名，OpenClaw 内部的运行时/插件名称仍然是 `mixin`。

如果插件已经安装过，后续升级请直接使用插件 ID：

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
      "defaultAccount": "default",
      "appId": "YOUR_APP_ID",
      "sessionId": "YOUR_SESSION_ID",
      "serverPublicKey": "YOUR_SERVER_PUBLIC_KEY_BASE64",
      "sessionPrivateKey": "YOUR_SESSION_PRIVATE_KEY_BASE64",
      "dmPolicy": "pairing",
      "allowFrom": ["AUTHORIZED_USER_UUID"],
      "requireMentionInGroup": true,
      "mediaBypassMentionInGroup": true,
      "mediaMaxMb": 30,
      "audioSendAsVoiceByDefault": true,
      "audioAutoDetectDuration": true,
      "audioRequireFfprobe": false,
      "mixpay": {
        "enabled": true,
        "payeeId": "YOUR_MIXPAY_PAYEE_ID",
        "defaultSettlementAssetId": "YOUR_SETTLEMENT_ASSET_ID",
        "expireMinutes": 15,
        "pollIntervalSec": 30,
        "allowedCreators": ["AUTHORIZED_USER_UUID"],
        "notifyOnPending": false,
        "notifyOnPaidLess": true
      },
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
- `plugins.allow` 和 `plugins.entries.mixin.enabled` 也必须配置，否则 OpenClaw 不会加载这个插件。
- Mixin 支持 OpenClaw 标准私聊策略，推荐使用 `dmPolicy: "pairing"`。
- `allowFrom` 仍然适合预授权用户或人工补充白名单；配对批准结果会写入 OpenClaw 的 pairing allowlist store。
- 如果 `proxy.url` 已经包含认证信息，可以不再填写 `proxy.username` 和 `proxy.password`。

## 配对模式

私聊推荐这样配置：

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

## 避免跨频道串会话

Mixin 群聊本身会按频道隔离，但私聊会话是否独立，取决于 OpenClaw 的 `session.dmScope` 配置。如果保持默认的 `main`，Mixin 私聊可能会和飞书等其他频道共用同一个主会话。

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
|-----------|----------|---------|-------------|
| `defaultAccount` | 否 | `default` | 配置了 `accounts` 时默认使用的账号 ID |
| `appId` | 是 | - | Mixin 应用 UUID |
| `sessionId` | 是 | - | Session UUID |
| `serverPublicKey` | 是 | - | 服务端公钥 Base64 |
| `sessionPrivateKey` | 是 | - | 会话私钥 Ed25519 Base64 |
| `dmPolicy` | 否 | `pairing` | 私聊策略：`pairing`、`allowlist`、`open`、`disabled` |
| `allowFrom` | 否 | `[]` | 授权用户 UUID 白名单 |
| `groupPolicy` | 否 | OpenClaw 默认值 | 群消息策略：`open`、`allowlist`、`disabled` |
| `groupAllowFrom` | 否 | `[]` | 当 `groupPolicy` 使用 allowlist 时，允许触发群消息的发送者 UUID 白名单 |
| `requireMentionInGroup` | 否 | `true` | 群聊是否要求触发词 |
| `mediaBypassMentionInGroup` | 否 | `true` | 是否允许群里的文件/语音消息绕过文本触发词过滤 |
| `mediaMaxMb` | 否 | `30` | 入站和出站媒体大小上限，单位 MB |
| `audioSendAsVoiceByDefault` | 否 | `true` | OpenClaw 原生音频出站时尽量按 Mixin 语音发送 |
| `audioAutoDetectDuration` | 否 | `true` | 是否在发送原生音频前使用 `ffprobe` 自动探测时长 |
| `audioRequireFfprobe` | 否 | `false` | 时长探测不可用时是否直接失败，而不是降级为文件发送 |
| `mixpay.enabled` | 否 | `false` | 是否为当前 Mixin 账号启用 MixPay 收款 |
| `mixpay.payeeId` | 启用时必填 | - | 用于创建 one-time payment 的 MixPay 收款方 ID |
| `mixpay.defaultQuoteAssetId` | 否 | - | `mixin-collect` 模板或未来收款命令使用的默认计价资产 ID |
| `mixpay.defaultSettlementAssetId` | 否 | - | MixPay 订单默认结算资产 ID |
| `mixpay.expireMinutes` | 否 | `15` | MixPay 订单默认过期时间，单位分钟 |
| `mixpay.pollIntervalSec` | 否 | `30` | 待支付 MixPay 订单的后台轮询间隔，单位秒 |
| `mixpay.allowedCreators` | 否 | `[]` | 允许创建 MixPay 收款单的发送者 UUID 白名单 |
| `mixpay.notifyOnPending` | 否 | `false` | 当 MixPay 返回 `pending` 时是否在会话里通知 |
| `mixpay.notifyOnPaidLess` | 否 | `true` | 当 MixPay 返回少付状态时是否在会话里通知 |
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

这些值怎么获取：

- `conversations.<conversationId>`：这里填的是群会话的 `conversation_id`。最简单的方式是先让目标群给 bot 发一条消息，然后从插件日志或入站上下文里读取 `conversationId`。Mixin 的群会话 API 里用的也是同一个 `conversation_id` 字段。
- `groupAllowFrom` 或 `conversations.<conversationId>.allowFrom`：这里填的是发送者的 Mixin `user_id` UUID。官方说明里，应用可以在用户给 bot 发消息、添加 bot 为联系人、或授权应用后获得这个 `user_id`。
- 如果你通过 Mixin API 管理群，会话详情返回里也会带参与者列表，其中就包含每个成员的 `user_id`。

推荐操作方式：

- 先让目标群给 bot 发一条消息
- 从日志里抄下 `conversationId`
- 再让目标成员发一条消息，从日志里抄下该成员的 `user_id`
- 把这些值填进 `conversations.<conversationId>` 和 `groupAllowFrom` / `allowFrom`

更快的方式：

- 直接在目标群发送 `/mixin-whoami`
- 插件会返回当前 `conversationId`、当前发送者 `user_id`，以及一段可直接复制的配置示例

日志里看哪里：

- 插件在路由解析时会打印类似 `peer.kind=group, peer.id=<conversationId>`，这里的 `peer.id` 就是群的 `conversationId`
- 群消息被拦截或未授权时，日志里会带 `group sender <user_id>` 和 `conversationId=<conversationId>`
- 如果现场不好拿值，可以临时把群策略收紧一点，让目标成员先发一条消息；拒绝日志通常是最快同时拿到这两个值的方式

## 使用方式

- 私聊：`/status` 或 `Hello`
- 群聊：`@Bot your question`，并带上 `?` 或 `help` 等触发词

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

- 发送 `/mixin-outbox` 可查看当前待发队列数量、下次重试时间和最新错误。
- 发送 `/mixin-outbox purge-invalid` 可删除历史遗留的 `APP_CARD` / `APP_BUTTON_GROUP` 永久无效重试项。
- 在私聊或群里发送 `/mixin-whoami`，插件会返回当前 `user_id`、当前群的 `conversationId`，以及一段可直接复制的配置片段。
- 发送 `/collect status <orderId>` 可刷新并查看某个 MixPay 收款单状态。
- 发送 `/collect recent` 或 `/collect recent 10` 可查看当前会话最近的 MixPay 收款单。

配套运维 CLI：

- 仓库里附带了一套配套工具，见 `tools/mixin-plugin-onboard/README.md`。
- 这套工具会和主包 `@invago/mixin` 一起发布，不再是单独的第二个 npm 包。
- 当前提供 `info`、`doctor`、`install`、`update` 四个命令，用于本地 OpenClaw + Mixin 插件的安装和诊断。
- 本地运行示例：
  - `node --import jiti/register.js tools/mixin-plugin-onboard/src/index.ts info`
  - `node --import jiti/register.js tools/mixin-plugin-onboard/src/index.ts doctor`
- 安装后使用示例：
  - `npx -y @invago/mixin info`
  - `npx -y @invago/mixin doctor`

## 投递与重试行为

- 出站消息会先写入本地 outbox，再进行发送尝试。
- 发送失败会自动重试，直到成功。
- 插件重启后，未完成的消息仍会继续补发。
- 入站 Blaze 消息会在分发前尽快 ACK，尽量让 Mixin 更早收到已读回执。

## 媒体支持

当前媒体能力分为出站和入站两部分：

- OpenClaw 原生媒体发送已经接入频道 `sendMedia` 路径。
- OpenClaw 原生 `sendPayload` 现在和 agent 缓冲回复共用同一套 Mixin outbound planner，所以 text/post/buttons/card/file/audio 的选择逻辑保持一致。
- 当插件能把媒体识别为音频并成功拿到时长时，会优先按 `PLAIN_AUDIO` 发送。
- 如果拿不到音频时长，会平稳降级为普通文件附件发送。
- 非音频媒体会按 Mixin 文件附件发送。
- 如果 OpenClaw 同时给出文本和媒体，插件会先发文本，再发文件。
- 语音气泡式发送目前仍然更适合走显式 `mixin-audio` 模板。
- 入站 `PLAIN_DATA` 和 `PLAIN_AUDIO` 会被下载到本地，并通过 `MediaPath` / `MediaType` 挂到 OpenClaw 入站上下文。
- 即使启用了 `requireMentionInGroup`，群里的附件消息也不会被直接过滤；如果你把 `mediaBypassMentionInGroup` 设为 `false`，则会恢复和普通文本相同的群聊触发规则。

当前边界：

- 发送语音时不做自动转码。
- `mixin-audio` 仍然要求你提供已经准备好的本地文件、显式 `duration`，以及可选的 `waveForm`。
- OpenClaw 原生音频发送依赖本机 `ffprobe` 来提取时长。
- OpenClaw 原生 `sendMedia` 仍然不会自动生成 `waveForm`，所以如果你想更稳定地控制语音消息效果，显式 `mixin-audio` 仍然是更可控的路径。
- 能否自动总结文件、转写语音，取决于你的 OpenClaw 媒体理解配置。

联调手册：

- 见 [docs/media-testing.md](docs/media-testing.md)。

## MixPay 收款

Mixin 现在已经支持通过 MixPay one-time payment 做收款。

当前能力：

- 显式模板 `mixin-collect` 可以创建一笔 MixPay 收款单
- 收款单会保存到 OpenClaw state 目录下的本地 store
- 待支付订单会在后台轮询
- 成功或终态变化会自动回发到原始会话
- `/collect status <orderId>` 会在回复前主动去 MixPay 刷新一次状态
- 如果配置了 `mixpay.defaultQuoteAssetId`，模板里的 `assetId` 可以省略

模板示例：

````text
```mixin-collect
{
  "amount": "1",
  "assetId": "c6d0c728-2624-429b-8e0d-d9d19b6592fa",
  "memo": "Order #1001"
}
```
````

规则：

- `amount` 必填；如果未配置 `mixpay.defaultQuoteAssetId`，则 `assetId` 也必填
- `settlementAssetId`、`memo`、`orderId`、`expireMinutes` 都是可选项
- 支付成功以 MixPay 服务端查询结果为准，不以客户端支付页结果为准
- `mixpay.allowedCreators` 可以限制谁有权限创建收款单

钱会收到哪里：

- 如果 MixPay 账户类型是 `Mixin account`，资金会结算到对应的 Mixin Wallet
- 如果 MixPay 账户类型是 `Mixin Robot account`，资金会结算到对应的 Mixin Robot Wallet
- 其他 MixPay 账户类型会结算到各自关联的钱包类型

对这个插件的推荐配置方式：

- 优先使用 MixPay 的 `Mixin account` 或 `Mixin Robot account`
- 将该账户的 UUID 作为 `mixpay.payeeId`
- 如果你希望模板更短，建议同时配置 `mixpay.defaultQuoteAssetId` 和 `mixpay.defaultSettlementAssetId`

如何获取所需配置：

- `mixpay.payeeId`：登录 [MixPay Dashboard](https://dashboard.mixpay.me) 后，在设置页查看 UUID；也可以使用 MixPay 官方入门文档里提到的辅助机器人获取
- `mixpay.defaultQuoteAssetId`：选择你希望用于报价的资产 ID
- `mixpay.defaultSettlementAssetId`：选择你希望最终收款结算到的资产 ID

最小推荐配置：

```json
{
  "channels": {
    "mixin": {
      "mixpay": {
        "enabled": true,
        "payeeId": "YOUR_MIXPAY_UUID",
        "defaultQuoteAssetId": "YOUR_QUOTE_ASSET_ID",
        "defaultSettlementAssetId": "YOUR_SETTLEMENT_ASSET_ID"
      }
    }
  }
}
```

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
  "description": "打开官方文档站点",
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

音频：

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

- 显式模板优先级高于自动检测。
- 包含表格或 fenced code block 的回复默认按 `mixin-post` 发送。
- `mixin-buttons` 和 `mixin-card` 只接受 JSON。
- `mixin-file`、`mixin-audio`、`mixin-collect` 也只接受 JSON。
- `mixin-audio` 要求 `duration` 以秒为单位，`waveForm` 可选。
- `mixin-file` 和 `mixin-audio` 要求使用 OpenClaw 所在机器上的绝对本地路径。
- 无效的显式 `mixin-*` 模板不会再被静默丢弃，插件会发送可见的 `Mixin template error: ...` 提示。
- 按钮和卡片链接必须使用 `http://` 或 `https://`。
- Mixin 客户端可能要求目标域名已经加入 bot 应用的 `Resource Patterns` 白名单。

## 多账号示例

```json
{
  "channels": {
    "mixin": {
      "accounts": {
        "bot1": {
          "name": "Customer Service Bot",
          "appId": "...",
          "sessionId": "...",
          "serverPublicKey": "...",
          "sessionPrivateKey": "...",
          "dmPolicy": "pairing",
          "allowFrom": ["..."]
        },
        "bot2": {
          "name": "Tech Support Bot",
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
  }
}
```

## 故障排查

| 问题 | 检查项 |
|---------|---------------|
| 插件未加载 | 运行 `openclaw plugins list` 和 `openclaw plugins info mixin` |
| 频道未启动 | 确认 `channels.mixin` 存在且凭证完整 |
| 收不到消息 | 检查 pairing/`allowFrom`、触发词以及 Blaze 连通性 |
| 消息发不出去 | 检查代理可达性、outbox 堆积以及 `/mixin-outbox` 输出 |
| 入站重复推送 | 检查 Blaze 连通性以及 ACK 日志/行为 |

## 安全说明

- 妥善保管 `sessionPrivateKey`。
- 生产环境建议使用 `dmPolicy: "pairing"` 或严格的 `allowFrom` 白名单。
- outbox 文件包含待发送消息内容，不要暴露状态目录中的相关文件。

## 相关链接

- [OpenClaw Documentation](https://openclaw.ai)
- [OpenClaw Plugins](https://docs.openclaw.ai/tools/plugin)
- [OpenClaw Plugin CLI](https://docs.openclaw.ai/cli/plugins)
- [OpenClaw Configuration](https://docs.openclaw.ai/gateway/configuration)
- [OpenClaw Configuration Reference](https://docs.openclaw.ai/gateway/configuration-reference)
- [Mixin Developers Dashboard](https://developers.mixin.one/dashboard)
- [Mixin Bot API Documentation](https://developers.mixin.one/docs/bot-api)
