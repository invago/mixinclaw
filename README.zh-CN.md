# MixinClaw

将 [Mixin Messenger](https://mixin.one/messenger) 接入 [OpenClaw](https://openclaw.ai)。

> 已支持 OpenClaw 3.23 最新插件架构。

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

## 多机器人直绑不同 Agent

OpenClaw 支持通过 `bindings[].match.accountId` 把不同的频道账号直接路由到不同 agent。

推荐做法：

- 一套 Mixin 机器人账号对应一个 `accountId`
- 一个 `accountId` 对应一条 agent 绑定
- 多账号场景下，`session.dmScope` 建议使用 `per-account-channel-peer`

示例：

```json
{
  "session": {
    "dmScope": "per-account-channel-peer"
  },
  "agents": {
    "list": [
      {
        "id": "main",
        "workspace": "E:/AI/workspace-main",
        "default": true
      },
      {
        "id": "sales",
        "workspace": "E:/AI/workspace-sales"
      },
      {
        "id": "support",
        "workspace": "E:/AI/workspace-support"
      }
    ]
  },
  "bindings": [
    {
      "agentId": "main",
      "match": {
        "channel": "mixin",
        "accountId": "default"
      }
    },
    {
      "agentId": "sales",
      "match": {
        "channel": "mixin",
        "accountId": "sales"
      }
    },
    {
      "agentId": "support",
      "match": {
        "channel": "mixin",
        "accountId": "support"
      }
    }
  ],
  "channels": {
    "mixin": {
      "defaultAccount": "default",
      "accounts": {
        "default": {
          "name": "Main Bot",
          "appId": "APP_ID_1",
          "sessionId": "SESSION_ID_1",
          "serverPublicKey": "SERVER_PUBLIC_KEY_1",
          "sessionPrivateKey": "SESSION_PRIVATE_KEY_1"
        },
        "sales": {
          "name": "Sales Bot",
          "appId": "APP_ID_2",
          "sessionId": "SESSION_ID_2",
          "serverPublicKey": "SERVER_PUBLIC_KEY_2",
          "sessionPrivateKey": "SESSION_PRIVATE_KEY_2"
        },
        "support": {
          "name": "Support Bot",
          "appId": "APP_ID_3",
          "sessionId": "SESSION_ID_3",
          "serverPublicKey": "SERVER_PUBLIC_KEY_3",
          "sessionPrivateKey": "SESSION_PRIVATE_KEY_3"
        }
      }
    }
  }
}
```

说明：

- `match.accountId` 用来把某一套 Mixin 机器人账号绑定到某个 agent。
- 如果绑定里省略 `accountId`，OpenClaw 会把它当成默认账号的匹配。
- 只有在你希望所有 Mixin 账号都走同一个兜底 agent 时，才使用 `accountId: "*"`。
- 如果你还想让某个具体群或某个私聊覆盖账号级路由，可以再补更具体的 `match.peer` 绑定；`peer` 精确匹配优先级高于 `accountId`。

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
| `requireMentionInGroup` | 否 | `true` | 仅对已经投递到插件的群消息启用插件侧触发词过滤 |
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

关于群消息投递边界：

- 目前从实际联调看，Mixin 群里稳定可用的触发方式仍然是显式 `@bot`。
- 最稳的写法是 `@<identity_number> + 文本`，例如 `@7000103034 你好`。
- `requireMentionInGroup: false` 只表示关闭插件自身的群消息二次过滤。
- 它不能保证 Mixin 平台一定把所有未 `@` 的群消息投递给机器人。
- 如果群里未 `@` 的消息既没有已读，也没有任何入站日志，通常说明这条消息根本没有被 Mixin 投递到插件。
- 目前群内“引用回复”不应被当成稳定触发方式，因为 Mixin 不一定会把这类事件稳定投递给 bot。

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


类似 pairing 的群授权方式：

- 未授权成员可以直接在目标群发送 `/mixin-group-auth`
- 插件会返回一个针对当前 `conversationId` 的临时批准码
- 管理员需要在 OpenClaw 终端执行 `openclaw pairing approve mixin <code>` 完成批准
- 如果使用的是非默认账号，请执行 `openclaw pairing approve --account <accountId> mixin <code>`
- 批准后，整个群会话都会生效，不需要手改 `openclaw.json`
- 同一个未授权群反复发送 `/mixin-group-auth` 会被限频，避免刷屏

日志里看哪里：

- 插件在路由解析时会打印类似 `peer.kind=group, peer.id=<conversationId>`，这里的 `peer.id` 就是群的 `conversationId`
- 群消息被拦截或未授权时，日志里会带 `group sender <user_id>` 和 `conversationId=<conversationId>`
- 如果现场不好拿值，可以临时把群策略收紧一点，让目标成员先发一条消息；拒绝日志通常是最快同时拿到这两个值的方式

## 使用方式

- 私聊：`/status` 或 `Hello`
- 群聊：`@<identity_number> 你的问题`
- 推荐示例：`@7000103034 帮我总结一下`
- 目前不要把“仅引用回复”或“引用后再 @”当作稳定触发方式。

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
- 在目标群发送 `/mixin-group-auth`，可创建一条待批准的群授权请求。
- 在 OpenClaw 终端执行 `openclaw pairing approve mixin <code>`，可批准这条群授权请求。
- 如果使用的是非默认账号，请执行 `openclaw pairing approve --account <accountId> mixin <code>`。
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

配置放在哪里：

- 单账号场景：把 `mixpay` 放在 `channels.mixin.mixpay`
- 多账号场景：把 `mixpay` 放在 `channels.mixin.accounts.<accountId>.mixpay`
- `mixpay` 是账号级配置，所以不同的 Mixin 机器人账号可以使用不同的 MixPay 设置

字段说明：

- `mixpay.enabled`：是否为当前这套 Mixin 账号启用 MixPay 收款
- `mixpay.apiBaseUrl`：可选的 MixPay API 基础地址；通常留空即可，默认走官方接口
- `mixpay.payeeId`：真正收款的 MixPay 收款方 UUID；启用 MixPay 收款时必填
- `mixpay.defaultQuoteAssetId`：默认报价资产 ID；配置后，`mixin-collect` 模板里的 `assetId` 可以省略
- `mixpay.defaultSettlementAssetId`：默认结算资产 ID；决定订单优先结算到哪种资产
- `mixpay.expireMinutes`：新建收款单的默认过期时间，单位分钟
- `mixpay.pollIntervalSec`：后台轮询待支付订单的间隔，单位秒；越小越快发现支付结果，但会产生更多 MixPay API 请求
- `mixpay.allowedCreators`：可选的发送者 UUID 白名单；当这个列表非空时，只有这些用户可以在聊天里创建收款单
- `mixpay.notifyOnPending`：当 MixPay 返回 `pending` 时，是否在会话里发送状态通知
- `mixpay.notifyOnPaidLess`：当 MixPay 返回少付状态时，是否在会话里发送状态通知

实用建议：

- 如果你只想先配出最小可用集，建议至少填写 `enabled`、`payeeId`、`defaultQuoteAssetId`、`defaultSettlementAssetId`
- 如果你不希望授权会话里的所有人都能创建收款单，就配置 `allowedCreators`
- 如果你没有自建 MixPay 网关，`apiBaseUrl` 保持留空即可
- 如果你不想在聊天里看到太多中间态通知，保持 `notifyOnPending: false` 即可

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

## OpenClaw 3.23 说明

- 插件清单使用 `openclaw.plugin.json`。
- 频道配置仍然放在 `channels.mixin` 和 `channels.mixin.accounts.<accountId>` 下。
- 宿主侧诊断命令为 `/setup`、`/setup single`、`/setup multi`、`/mixin-status`、`/mixin-accounts`、`/mixin-help`。
- 本地开发建议使用 `openclaw plugins install -l .`。

- 使用 `/setup` 进入配置引导流程。

## 跨平台检查清单

- Windows、Linux、macOS 都使用同一套安装命令。
- 请确保 `openclaw`、`node` 和包管理器（`npm` 或 `pnpm`）已经加入 `PATH`。
- 语音时长识别依赖 `ffprobe`。如果系统里没有它，音频会降级为按文件发送，除非你显式开启 `audioRequireFfprobe`。
- 本地开发时，先执行一次 `npm install`，然后用 `openclaw plugins install -l .` 或 `openclaw plugins install .` 安装。
- 运行时数据会存放在 OpenClaw 状态目录中，来源可能是 `OPENCLAW_STATE_DIR`、`CLAWDBOT_STATE_DIR` 或 `OPENCLAW_HOME`，插件配置里不需要写死操作系统路径。
