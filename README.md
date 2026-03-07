# MixinClaw

Connect [Mixin Messenger](https://mixin.one/messenger) to [OpenClaw](https://openclaw.ai).

**[Chinese Documentation](README.zh-CN.md)**

## Quick Start

### 1. Install

Clone this plugin into the OpenClaw extensions directory:

```bash
# Linux/Mac
git clone https://github.com/invago/mixinclaw.git /usr/lib/node_modules/openclaw/extensions/mixin

# Windows PowerShell
git clone https://github.com/invago/mixinclaw.git "$env:APPDATA\npm\node_modules\openclaw\extensions\mixin"
```

Install dependencies:

```bash
cd /usr/lib/node_modules/openclaw/extensions/mixin
npm install
```

### 2. Create a Mixin Bot

Go to [Mixin Developers Dashboard](https://developers.mixin.one/dashboard), create a bot, and collect:

- `appId`
- `sessionId`
- `serverPublicKey`
- `sessionPrivateKey`

### 3. Configure

Run `openclaw config` to find your config file, then add:

```json
{
  "channels": {
    "mixin": {
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
      "mixin": { "enabled": true }
    }
  }
}
```

Notes:

- Add `mixin` to both `plugins.allow` and `plugins.entries`.
- `proxy` is optional.
- The proxy applies only to this plugin.
- Both Mixin HTTP requests and Blaze WebSocket traffic use the same proxy.
- If credentials are already embedded in `proxy.url`, `proxy.username` and `proxy.password` can be omitted.

### 4. Start

```bash
openclaw status
```

Check logs for `[mixin] connected to Mixin Blaze`.

### 5. Test

- Direct message: `/status` or `Hello`
- Group message: `@Bot your question` with trigger words such as `?` or `help`

## Configuration

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
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

## Features

- Mixin Blaze WebSocket inbound messaging
- HTTP outbound messaging with persistent outbox retry
- Direct and group chat support
- Message deduplication
- Allowlist-based access control
- Multi-account support
- Per-plugin authenticated proxy support for both HTTP and WebSocket

## Retry Behavior

- Outbound messages are persisted to a local outbox before send attempts.
- Failed sends are retried automatically until they succeed.
- Pending messages survive plugin restarts.

## Operations

- Send `/mixin-outbox` to inspect current pending queue size, next retry time, and latest error.

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

## Security Notes

- Keep `sessionPrivateKey` private.
- Use `allowFrom` in production.
- Outbox files contain pending message bodies, so do not expose the `data/` directory.

## Links

- [OpenClaw Documentation](https://openclaw.ai)
- [Mixin Developers Dashboard](https://developers.mixin.one/dashboard)
- [Mixin Bot API Documentation](https://developers.mixin.one/docs/bot-api)
