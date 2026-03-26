# MixinClaw

Connect [Mixin Messenger](https://mixin.one/messenger) to [OpenClaw](https://openclaw.ai).

> Supported on the latest OpenClaw 3.23 plugin architecture.

**[Chinese Documentation](README.zh-CN.md)**

## Overview

MixinClaw is an OpenClaw channel plugin. It runs in the same process as the OpenClaw Gateway, receives inbound messages from Mixin Blaze WebSocket, and delivers outbound messages over the Mixin HTTP API.

Important:

- Install the plugin on the same machine where the OpenClaw Gateway runs.
- OpenClaw config files use JSON5, so comments and trailing commas are allowed.
- The proxy configured by this plugin only affects this plugin.

## Recommended Install

Use the OpenClaw plugin installer:

```bash
openclaw plugins install @invago/mixin
```

`@invago/mixin` is the published npm package name. The OpenClaw runtime/plugin name remains `mixin`.

If the plugin is already installed, upgrade it with the plugin id:

```bash
openclaw plugins update mixin
```

To install a specific version for the first time:

```bash
openclaw plugins install @invago/mixin@<version>
```

Then confirm the plugin is installed:

```bash
openclaw plugins list
openclaw plugins info mixin
```

## Cross-Platform Checklist

- The same install commands work on Windows, Linux, and macOS.
- Make sure `openclaw`, `node`, and your package manager (`npm` or `pnpm`) are available on `PATH`.
- Voice duration detection needs `ffprobe`. If it is missing, audio falls back to file sending unless `audioRequireFfprobe` is enabled.
- For local development, run `npm install` once and then `openclaw plugins install -l .` or `openclaw plugins install .`.
- Runtime data is stored under the OpenClaw state directory resolved from `OPENCLAW_STATE_DIR`, `CLAWDBOT_STATE_DIR`, or `OPENCLAW_HOME`; no OS-specific path is required in plugin config.

## Local Development Install

If you are developing locally, clone the repository and install dependencies:

```bash
git clone https://github.com/invago/mixinclaw.git
cd mixinclaw
npm install
```

Then install it into OpenClaw from the local path:

```bash
openclaw plugins install .
```

## Create a Mixin Bot

Go to [Mixin Developers Dashboard](https://developers.mixin.one/dashboard), create a bot, and collect:

- `appId`
- `sessionId`
- `serverPublicKey`
- `sessionPrivateKey`

## Configuration

Edit your `openclaw.json` file manually and add both the channel configuration and the plugin enablement block:

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

Notes:

- `channels.mixin` configures the channel itself.
- `plugins.allow` and `plugins.entries.mixin.enabled` are also required so OpenClaw loads this plugin.
- Mixin supports the standard OpenClaw direct-message policies. The recommended setting is `dmPolicy: "pairing"`.
- `allowFrom` remains useful for pre-authorized users or manual overrides. Pairing approvals are stored in OpenClaw's pairing allowlist store.
- If `proxy.url` already contains credentials, `proxy.username` and `proxy.password` can be omitted.

## Pairing

For private chats, the recommended mode is:

```json
{
  "channels": {
    "mixin": {
      "dmPolicy": "pairing"
    }
  }
}
```

Behavior:

- A new, unauthorized Mixin user gets an 8-character pairing code in the DM.
- Approve that user with `openclaw pairing approve mixin <code>`.
- Use `openclaw pairing list mixin` to inspect pending pairing requests.
- Once approved, the user is added to OpenClaw's pairing allowlist store for the `mixin` channel.
- `allowFrom` is still honored and can be used alongside pairing for users you want to pre-authorize.

## Avoid Cross-Channel Session Mixing

Mixin group chats already stay isolated by channel, but direct-message sessions follow the OpenClaw `session.dmScope` policy. If you keep the default `main` scope, Mixin direct messages can share the same main session with other channels such as Feishu.

Recommended configuration:

```json
{
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

Use `per-account-channel-peer` instead if you run multiple Mixin accounts and want direct-message sessions isolated by both channel and account.

## Multi-Agent Routing Per Bot Account

OpenClaw supports routing different channel accounts to different agents through `bindings[].match.accountId`.

Recommended pattern:

- One Mixin bot account = one `accountId`
- One `accountId` = one agent binding
- Keep session isolation at `per-account-channel-peer` when you run multiple bot accounts

Example:

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

Notes:

- `match.accountId` binds one Mixin bot account to one agent.
- If `accountId` is omitted in a binding, OpenClaw treats it as the default account only.
- Use `accountId: "*"` only when you want one fallback agent for all Mixin accounts.
- If you need one specific group or DM to override the account-level routing, add a more specific `match.peer` binding. Peer matches win over `accountId` matches.

## Configuration Reference

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `defaultAccount` | No | `default` | Default account ID used when `accounts` is configured |
| `appId` | Yes | - | Mixin App UUID |
| `sessionId` | Yes | - | Session UUID |
| `serverPublicKey` | Yes | - | Server Public Key (Base64) |
| `sessionPrivateKey` | Yes | - | Session Private Key (Ed25519 Base64) |
| `dmPolicy` | No | `pairing` | Direct-message policy: `pairing`, `allowlist`, `open`, or `disabled` |
| `allowFrom` | No | `[]` | Authorized user UUID whitelist |
| `groupPolicy` | No | OpenClaw default | Group-message policy: `open`, `allowlist`, or `disabled` |
| `groupAllowFrom` | No | `[]` | Authorized sender UUID whitelist for group messages when `groupPolicy` uses allowlisting |
| `requireMentionInGroup` | No | `true` | Apply plugin-side trigger-word filtering to group messages that have already been delivered to the bot |
| `mediaBypassMentionInGroup` | No | `true` | Allow inbound group file/audio messages through even without trigger text |
| `mediaMaxMb` | No | `30` | Max inbound and outbound media size in MB |
| `audioSendAsVoiceByDefault` | No | `true` | Send OpenClaw native outbound audio as Mixin voice when possible |
| `audioAutoDetectDuration` | No | `true` | Detect native outbound audio duration with `ffprobe` before sending voice |
| `audioRequireFfprobe` | No | `false` | Fail native outbound audio instead of falling back to file when duration detection is unavailable |
| `mixpay.enabled` | No | `false` | Enable MixPay collect support for this Mixin account |
| `mixpay.payeeId` | Required when enabled | - | MixPay merchant/payee ID used to create one-time payment orders |
| `mixpay.defaultQuoteAssetId` | No | - | Default quote asset ID for collect templates or future collect commands |
| `mixpay.defaultSettlementAssetId` | No | - | Default settlement asset ID for MixPay orders |
| `mixpay.expireMinutes` | No | `15` | Default MixPay order expiration time in minutes |
| `mixpay.pollIntervalSec` | No | `30` | Poll interval in seconds for pending MixPay orders |
| `mixpay.allowedCreators` | No | `[]` | Optional sender UUID allowlist for creating MixPay collect orders |
| `mixpay.notifyOnPending` | No | `false` | Notify the chat when MixPay reports `pending` |
| `mixpay.notifyOnPaidLess` | No | `true` | Notify the chat when MixPay indicates an underpayment |
| `conversations.<conversationId>.enabled` | No | `true` | Enable or disable a specific group conversation |
| `conversations.<conversationId>.requireMention` | No | Inherit account | Override group trigger-word requirement for a specific conversation |
| `conversations.<conversationId>.allowFrom` | No | Inherit account | Override group sender allowlist for a specific conversation |
| `conversations.<conversationId>.mediaBypassMention` | No | Inherit account | Override whether file/audio messages bypass mention filtering |
| `conversations.<conversationId>.groupPolicy` | No | Inherit account | Override group policy for a specific conversation |
| `debug` | No | `false` | Debug mode |
| `proxy.enabled` | No | `false` | Enable per-plugin proxy |
| `proxy.url` | Required when enabled | - | Proxy URL such as `http://127.0.0.1:7890` or `socks5://127.0.0.1:10808` |
| `proxy.username` | No | - | Proxy username |
| `proxy.password` | No | - | Proxy password |

## Proxy

- Both Mixin HTTP requests and Blaze WebSocket traffic use the same proxy.
- Supported proxy URL styles depend on the underlying proxy agent stack; typical values are `http://...`, `https://...`, and `socks5://...`.
- You must provide your own proxy software or proxy server. The plugin only consumes a proxy, it does not create one.

## Group Access Control

Mixin now supports formal group access controls in addition to direct-message `dmPolicy`.

- `groupPolicy: "open"` allows any sender in a group conversation.
- `groupPolicy: "allowlist"` requires the sender UUID to appear in `groupAllowFrom`.
- `groupPolicy: "disabled"` blocks the entire conversation.
- `conversations.<conversationId>` overrides account-level group settings for that single conversation.

Important delivery boundary:

- In practice, Mixin group bots reliably receive messages when the bot is explicitly mentioned.
- The most reliable format is `@<identity_number> your message`, for example `@7000103034 hello`.
- `requireMentionInGroup: false` only disables this plugin's own post-delivery filtering.
- It does not guarantee that Mixin will deliver every non-mention group message to the bot.
- If a non-mention group message produces no read receipt and no inbound log, the message most likely was not delivered to the plugin by Mixin in the first place.
- Group quote/reply interactions are currently not treated as a reliable bot trigger, because Mixin may not deliver those events to the bot over Blaze consistently.

Example:

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

How to get these values:

- `conversations.<conversationId>`: use the group's `conversation_id`. In practice, the easiest way is to let the group send a message to the bot once, then read the `conversationId` from the plugin logs or inbound event context. Mixin's conversation APIs also use the same `conversation_id` field for group conversations.
- `groupAllowFrom` or `conversations.<conversationId>.allowFrom`: use the sender's Mixin `user_id` UUID. Mixin user IDs can be learned when the user messages the bot, adds the bot as a contact, or authorizes the application.
- If you manage the group through Mixin APIs, the returned conversation payload also includes group participants with their `user_id` fields.

Recommended operational approach:

- Let the target group send one message to the bot
- Copy the logged `conversationId`
- Let the target member send one message, then copy that sender's `user_id`
- Put those values into `conversations.<conversationId>` and `groupAllowFrom` / `allowFrom`

Pairing-style group authorization:

- An unauthorized user can send `/mixin-group-auth` in the target group
- The plugin replies with a temporary approval code for that `conversationId`
- An operator must approve it in the OpenClaw terminal with `openclaw pairing approve mixin <code>`
- For non-default accounts, use `openclaw pairing approve --account <accountId> mixin <code>`
- Once approved, that entire group conversation is allowed without changing `openclaw.json`
- Repeated `/mixin-group-auth` requests from the same unauthorized group are rate-limited to avoid spam

Where to look in logs:

- The plugin logs route resolution like `peer.kind=group, peer.id=<conversationId>`, which gives you the group `conversationId`
- Unauthorized or filtered group logs include `group sender <user_id>` and `conversationId=<conversationId>`
- If needed, temporarily enable a stricter group policy and let one member send a message once; the rejection log is often the fastest way to collect both values

## Usage

- Direct message: `/status` or `Hello`
- Group message: `@<identity_number> your question`
- Recommended example: `@7000103034 help me summarize this`
- Do not rely on quote-only or quote-plus-mention group replies as a stable trigger path.

## Operations

Useful OpenClaw commands:

```bash
openclaw plugins list
openclaw plugins info mixin
openclaw plugins update mixin
openclaw channels status --probe
openclaw status
```

Plugin-specific command:

- Send `/mixin-outbox` to inspect the current pending queue size, next retry time, and latest error.
- Send `/mixin-outbox purge-invalid` to remove old `APP_CARD` / `APP_BUTTON_GROUP` entries that are stuck on permanent invalid-field errors.
- Send `/mixin-group-auth` in a group to create a pending group-authorization request.
- Approve a pending group-authorization request in the OpenClaw terminal with `openclaw pairing approve mixin <code>`.
- For non-default accounts, use `openclaw pairing approve --account <accountId> mixin <code>`.
- Send `/collect status <orderId>` to refresh and inspect a stored MixPay collect order.
- Send `/collect recent` or `/collect recent 10` to list recent MixPay collect orders for the current conversation.

Companion onboarding CLI:

- This repository also includes a companion CLI at `tools/mixin-plugin-onboard/README.md`.
- It is bundled into the same npm package, `@invago/mixin`.
- It currently provides `info`, `doctor`, `install`, and `update` commands for local OpenClaw + Mixin plugin maintenance.
- Local examples:
  - `node --import jiti/register.js tools/mixin-plugin-onboard/src/index.ts info`
  - `node --import jiti/register.js tools/mixin-plugin-onboard/src/index.ts doctor`
- Installed package examples:
  - `npx -y @invago/mixin info`
  - `npx -y @invago/mixin doctor`

## Delivery and Retry Behavior

- Outbound messages are persisted to a local outbox before send attempts.
- Failed sends are retried automatically until they succeed.
- Pending messages survive plugin restarts.
- Inbound Blaze messages are acknowledged before dispatch so Mixin receives a read receipt as early as possible.

## Media Support

Current media behavior is split into outbound and inbound support:

- OpenClaw native outbound media is enabled through the channel `sendMedia` path.
- OpenClaw native `sendPayload` now uses the same Mixin outbound planner as buffered agent replies, so text/post/buttons/card/file/audio selection is consistent.
- The plugin sends outbound audio as `PLAIN_AUDIO` when it can resolve the media as audio and detect duration.
- If audio duration cannot be detected, the plugin falls back to regular file attachment sending.
- Non-audio outbound media is sent as Mixin file attachments.
- If OpenClaw sends both caption text and media, the plugin sends the text first and then the file.
- Voice-bubble style outbound audio is currently intended for the explicit `mixin-audio` template path.
- Inbound `PLAIN_DATA` and `PLAIN_AUDIO` messages are downloaded, saved locally, and attached to the OpenClaw inbound context through `MediaPath` / `MediaType`.
- Group attachment messages are allowed through even when `requireMentionInGroup` is enabled, unless `mediaBypassMentionInGroup` is set to `false`.

Current limits:

- Outbound audio does not transcode automatically.
- `mixin-audio` still requires a prepared local file, explicit `duration`, and optional `waveForm`.
- OpenClaw native outbound audio depends on local `ffprobe` availability to detect duration.
- OpenClaw native `sendMedia` still does not generate `waveForm`, so explicit `mixin-audio` remains the most deterministic path for polished voice-message output.
- Whether the agent can summarize, transcribe, or reason over inbound files/audio depends on your OpenClaw media-understanding configuration.

Manual test guide:

- See [docs/media-testing.md](docs/media-testing.md) for ready-to-run prompts and expected results.

## MixPay Collect

Mixin now supports MixPay collection through one-time payment orders.

Current capabilities:

- `mixin-collect` explicit reply template creates a MixPay collect order
- Collect orders are stored locally under the OpenClaw state directory
- Pending orders are polled in the background
- Success and terminal status changes are sent back to the original conversation
- `/collect status <orderId>` refreshes the order from MixPay before replying
- `assetId` in the template can be omitted when `mixpay.defaultQuoteAssetId` is configured

Template example:

````text
```mixin-collect
{
  "amount": "1",
  "assetId": "c6d0c728-2624-429b-8e0d-d9d19b6592fa",
  "memo": "Order #1001"
}
```
````

Rules:

- `amount` is required; `assetId` is required unless `mixpay.defaultQuoteAssetId` is configured
- `settlementAssetId`, `memo`, `orderId`, and `expireMinutes` are optional
- Payment success is confirmed from MixPay server-side query results, not only from the client page
- `mixpay.allowedCreators` can restrict who is allowed to create collect orders

Where funds arrive:

- For MixPay `Mixin account`, funds settle into the linked Mixin Wallet
- For MixPay `Mixin Robot account`, funds settle into the linked Mixin Robot Wallet
- Other MixPay account types settle into their own linked wallet types

Recommended setup for this plugin:

- Use a MixPay `Mixin account` or `Mixin Robot account`
- Use that account's UUID as `mixpay.payeeId`
- Set both `mixpay.defaultQuoteAssetId` and `mixpay.defaultSettlementAssetId` if you want templates to stay short

How to get the required values:

- `mixpay.payeeId`: get the UUID from the [MixPay Dashboard](https://dashboard.mixpay.me) settings page, or use the MixPay helper bot described in the official getting-started guide
- `mixpay.defaultQuoteAssetId`: choose the asset ID you want to quote prices in
- `mixpay.defaultSettlementAssetId`: choose the asset ID you want funds to settle into

Minimal recommended config:

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

Where to put it:

- Single-account setup: put `mixpay` under `channels.mixin.mixpay`
- Multi-account setup: put it under `channels.mixin.accounts.<accountId>.mixpay`
- `mixpay` is account-scoped, so different Mixin bot accounts can use different MixPay settings

Field reference:

- `mixpay.enabled`: enable MixPay collect support for this Mixin account
- `mixpay.apiBaseUrl`: optional custom MixPay API base URL; normally leave it empty and use the default official endpoint
- `mixpay.payeeId`: the MixPay payee/merchant UUID that actually receives the funds; required when MixPay collect is enabled
- `mixpay.defaultQuoteAssetId`: default quoted asset ID; when set, `mixin-collect` can omit `assetId`
- `mixpay.defaultSettlementAssetId`: default settlement asset ID; controls which asset the order prefers to settle into
- `mixpay.expireMinutes`: default expiration time for newly created collect orders
- `mixpay.pollIntervalSec`: background polling interval for pending orders; shorter values detect paid orders faster but create more MixPay API traffic
- `mixpay.allowedCreators`: optional sender UUID allowlist; when non-empty, only these users can create collect orders in chat
- `mixpay.notifyOnPending`: whether to send a conversation update when MixPay reports the order as `pending`
- `mixpay.notifyOnPaidLess`: whether to send a conversation update when MixPay reports an underpayment

Practical guidance:

- If you only want the smallest working setup, configure `enabled`, `payeeId`, `defaultQuoteAssetId`, and `defaultSettlementAssetId`
- If you do not want everyone in an authorized chat to create collect orders, set `allowedCreators`
- If you do not run a private MixPay gateway, leave `apiBaseUrl` unset
- If you want fewer status messages in chat, keep `notifyOnPending: false`

## Explicit Reply Templates

When you want deterministic Mixin output instead of heuristic auto-selection, have the agent reply with exactly one fenced template block.

Text:

```text
```mixin-text
Short plain reply.
```
```

Post:

```text
```mixin-post
# Release Notes

- Item 1
- Item 2
```
```

Buttons:

```text
```mixin-buttons
{
  "intro": "Choose an action",
  "buttons": [
    { "label": "Open Docs", "action": "https://docs.openclaw.ai" },
    { "label": "Open Mixin", "action": "https://developers.mixin.one" }
  ]
}
```
```

Card:

```text
```mixin-card
{
  "title": "OpenClaw Docs",
  "description": "Open the official documentation site.",
  "action": "https://docs.openclaw.ai",
  "coverUrl": "https://example.com/cover.png",
  "shareable": true
}
```
```

File:

```text
```mixin-file
{
  "filePath": "/absolute/path/to/report.pdf",
  "fileName": "report.pdf",
  "mimeType": "application/pdf"
}
```
```

Audio:

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

Rules:

- Explicit templates take priority over automatic detection.
- Replies containing tables or fenced code blocks are sent as `mixin-post` by default.
- `mixin-buttons` and `mixin-card` accept JSON only.
- `mixin-file` and `mixin-audio` also accept JSON only.
- `mixin-audio` requires `duration` in seconds. `waveForm` is optional.
- `mixin-file` and `mixin-audio` require absolute local file paths on the machine where OpenClaw runs.
- Invalid explicit `mixin-*` templates are no longer dropped silently; the plugin now sends a visible `Mixin template error: ...` message instead.
- Button and card links must use `http://` or `https://`.
- Mixin clients may require your target domains to be present in the bot app's `Resource Patterns` allowlist.

## Multi-Account Example

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

## Troubleshooting

| Problem | What to check |
|---------|---------------|
| Plugin not loaded | Run `openclaw plugins list` and `openclaw plugins info mixin` |
| Channel not starting | Verify `channels.mixin` exists and credentials are complete |
| Not receiving messages | Check pairing approval or `allowFrom`, trigger words, and Blaze connectivity |
| Messages not sending | Check proxy reachability, outbox backlog, and `/mixin-outbox` output |
| Repeated inbound pushes | Check Blaze connectivity and confirm ACK logs/behavior |

## Security Notes

- Keep `sessionPrivateKey` private.
- Use `dmPolicy: "pairing"` or a strict `allowFrom` list in production.
- Outbox files contain pending message bodies, so do not expose the `data/` directory.

## Links

- [OpenClaw Documentation](https://openclaw.ai)
- [OpenClaw Plugins](https://docs.openclaw.ai/tools/plugin)
- [OpenClaw Plugin CLI](https://docs.openclaw.ai/cli/plugins)
- [OpenClaw Configuration](https://docs.openclaw.ai/gateway/configuration)
- [OpenClaw Configuration Reference](https://docs.openclaw.ai/gateway/configuration-reference)
- [Mixin Developers Dashboard](https://developers.mixin.one/dashboard)
- [Mixin Bot API Documentation](https://developers.mixin.one/docs/bot-api)

## OpenClaw 3.23 notes

- The plugin manifest is `openclaw.plugin.json`.
- Channel config stays under `channels.mixin` and `channels.mixin.accounts.<accountId>`.
- Host-side diagnostics are available as `/setup`, `/setup single`, `/setup multi`, `/mixin-status`, `/mixin-accounts`, and `/mixin-help`.
- For local development, prefer `openclaw plugins install -l .`.

- Use `/setup` for the guided setup flow.
