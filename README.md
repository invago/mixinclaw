# MixinClaw

Connect [Mixin Messenger](https://mixin.one/messenger) to [OpenClaw](https://openclaw.ai).

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
openclaw plugins install @invago/mixinclaw
```

`@invago/mixinclaw` is the published install identifier. The package metadata still uses the runtime/plugin name `mixin`.

Then confirm the plugin is installed:

```bash
openclaw plugins list
openclaw plugins info mixin
```

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
      "enabled": true,
      "appId": "YOUR_APP_ID",
      "sessionId": "YOUR_SESSION_ID",
      "serverPublicKey": "YOUR_SERVER_PUBLIC_KEY_BASE64",
      "sessionPrivateKey": "YOUR_SESSION_PRIVATE_KEY_BASE64",
      "allowFrom": ["AUTHORIZED_USER_UUID"],
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
- This plugin currently uses `allowFrom` as its sender allowlist. Do not assume other generic OpenClaw DM policy fields apply here unless the plugin explicitly supports them.
- If `proxy.url` already contains credentials, `proxy.username` and `proxy.password` can be omitted.

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

## Configuration Reference

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `enabled` | No | `true` | Enable or disable this channel account |
| `appId` | Yes | - | Mixin App UUID |
| `sessionId` | Yes | - | Session UUID |
| `serverPublicKey` | Yes | - | Server Public Key (Base64) |
| `sessionPrivateKey` | Yes | - | Session Private Key (Ed25519 Base64) |
| `allowFrom` | No | `[]` | Authorized user UUID whitelist |
| `requireMentionInGroup` | No | `true` | Require trigger words in group chats |
| `debug` | No | `false` | Debug mode |
| `proxy.enabled` | No | `false` | Enable per-plugin proxy |
| `proxy.url` | Required when enabled | - | Proxy URL such as `http://127.0.0.1:7890` or `socks5://127.0.0.1:10808` |
| `proxy.username` | No | - | Proxy username |
| `proxy.password` | No | - | Proxy password |

## Proxy

- Both Mixin HTTP requests and Blaze WebSocket traffic use the same proxy.
- Supported proxy URL styles depend on the underlying proxy agent stack; typical values are `http://...`, `https://...`, and `socks5://...`.
- You must provide your own proxy software or proxy server. The plugin only consumes a proxy, it does not create one.

## Usage

- Direct message: `/status` or `Hello`
- Group message: `@Bot your question` with trigger words such as `?` or `help`

## Operations

Useful OpenClaw commands:

```bash
openclaw plugins list
openclaw plugins info mixin
openclaw channels status --probe
openclaw status
```

Plugin-specific command:

- Send `/mixin-outbox` to inspect the current pending queue size, next retry time, and latest error.
- Send `/mixin-outbox purge-invalid` to remove old `APP_CARD` / `APP_BUTTON_GROUP` entries that are stuck on permanent invalid-field errors.

## Delivery and Retry Behavior

- Outbound messages are persisted to a local outbox before send attempts.
- Failed sends are retried automatically until they succeed.
- Pending messages survive plugin restarts.
- Inbound Blaze messages are acknowledged before dispatch so Mixin receives a read receipt as early as possible.

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

Rules:

- Explicit templates take priority over automatic detection.
- Replies containing tables or fenced code blocks are sent as `mixin-post` by default.
- `mixin-buttons` and `mixin-card` accept JSON only.
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
| Not receiving messages | Check `allowFrom`, trigger words, and Blaze connectivity |
| Messages not sending | Check proxy reachability, outbox backlog, and `/mixin-outbox` output |
| Repeated inbound pushes | Check Blaze connectivity and confirm ACK logs/behavior |

## Security Notes

- Keep `sessionPrivateKey` private.
- Use `allowFrom` in production.
- Outbox files contain pending message bodies, so do not expose the `data/` directory.

## Links

- [OpenClaw Documentation](https://openclaw.ai)
- [OpenClaw Plugins](https://docs.openclaw.ai/tools/plugin)
- [OpenClaw Plugin CLI](https://docs.openclaw.ai/cli/plugins)
- [OpenClaw Configuration](https://docs.openclaw.ai/gateway/configuration)
- [OpenClaw Configuration Reference](https://docs.openclaw.ai/gateway/configuration-reference)
- [Mixin Developers Dashboard](https://developers.mixin.one/dashboard)
- [Mixin Bot API Documentation](https://developers.mixin.one/docs/bot-api)
