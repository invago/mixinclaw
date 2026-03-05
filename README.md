# MixinClaw

Connect [Mixin Messenger](https://mixin.one/messenger) to [OpenClaw](https://openclaw.ai) AI assistant platform.

**[🇨🇳 中文文档](README.zh-CN.md)**

## Quick Start (5 minutes)

### 1. Install

```bash
# Install to OpenClaw extensions directory
npm install mixinclaw --prefix $(openclaw extensions dir)
```

### 2. Create Mixin Bot

1. Visit [Mixin Developers Dashboard](https://developers.mixin.one/dashboard)
2. Scan QR code with Mixin Messenger to login
3. Click "+" to create a new bot
4. Get credentials:
   - **App ID** (UUID)
   - **Session ID** (UUID)
   - **Server Public Key** (Base64)
   - **Session Private Key** (Ed25519 Base64)

### 3. Configure

Edit OpenClaw config file (run `openclaw config` to find location):

```json
{
  "channels": {
    "mixin": {
      "appId": "YOUR_APP_ID",
      "sessionId": "YOUR_SESSION_ID",
      "serverPublicKey": "YOUR_SERVER_PUBLIC_KEY_BASE64",
      "sessionPrivateKey": "YOUR_SESSION_PRIVATE_KEY_BASE64",
      "allowFrom": ["AUTHORIZED_USER_UUID"]
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

**Important**: Add `mixin` to both `plugins.allow` and `plugins.entries` sections.

### 4. Start

```bash
openclaw start
```

Look for `[mixin] connected to Mixin Blaze` in logs to confirm successful connection.

### 5. Test

Send messages to your bot in Mixin Messenger:
- **Direct message**: `/status` or `Hello`
- **Group message**: `@Bot your question` (must include trigger words like `?`, `help`)

## Configuration

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `appId` | ✅ | - | Mixin App UUID |
| `sessionId` | ✅ | - | Session UUID |
| `serverPublicKey` | ✅ | - | Server Public Key (Base64) |
| `sessionPrivateKey` | ✅ | - | Session Private Key (Ed25519 Base64) |
| `allowFrom` | ❌ | `[]` | Whitelist of authorized user UUIDs |
| `requireMentionInGroup` | ❌ | `true` | Require trigger words in groups |
| `debug` | ❌ | `false` | Debug mode |

## Features

- ✅ Real-time message reception (Mixin Blaze WebSocket)
- ✅ Direct and group message support
- ✅ Automatic message deduplication
- ✅ Smart group message filtering (trigger words: `?`, `help`, `analyze`)
- ✅ Built-in commands (`/models`, `/status`, `/queue`, `/help`)
- ✅ Whitelist-based access control
- ✅ **Never-stop retry** on network errors (gentle backoff: 1s → 3s cap)
- ✅ Multi-account support

## Usage

### Direct Messages

Send messages directly to bot:
```
Hello!
/status
/model
```

### Group Messages

Must @Bot and include trigger words:
```
@Bot What does this mean?
@Bot Help me analyze this
@Bot Please summarize
```

**Trigger words**: `?`, `help`, `analyze`, `summarize`, `please`

### Built-in Commands

Require whitelist permission:

| Command | Description |
|---------|-------------|
| `/models` | List available AI models |
| `/models <provider>` | List models from specific provider |
| `/status` | Check system status |
| `/queue` | View task queue |
| `/help` | Show help information |

### Get User UUID

1. Send any message to the bot
2. Check logs for `user_id: xxx`
3. Copy UUID to `allowFrom` list

## Troubleshooting

| Issue | Log Message | Solution |
|-------|-------------|----------|
| Connection failed | `connecting to Mixin Blaze` loop | Verify all 4 credentials, private key must be Ed25519 (44 chars) |
| Not receiving messages | No `[mixin] message:` log | Check `allowFrom` whitelist, groups need trigger words |
| Message filtered | `[mixin] group message filtered` | Add trigger words (`?`, `help`) or set `requireMentionInGroup: false` |
| Send failed | `sendText failed: timeout` | **Auto-retrying forever** (gentle backoff: 1s→3s), will send when network returns |
| Commands not working | `[mixin] route result: FOUND` | Ensure user is in `allowFrom` whitelist |

## Network Retry Mechanism

**Never-stop retry strategy** for unstable international networks:

```
Attempt 1: immediate
Attempt 2: 1 second delay
Attempt 3: 1.5 seconds delay
Attempt 4: 2.25 seconds delay
Attempt 5+: 3 seconds delay (cap)
```

**Benefits**:
- ✅ Plugin stays alive indefinitely (no restart needed)
- ✅ Fast recovery when network returns (max 3s wait)
- ✅ Gentle backoff prevents server overload
- ✅ Perfect for China-to-foreign network fluctuations

## Advanced Configuration

### Multi-Account Setup

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
          "sessionPrivateKey": "..."
        },
        "bot2": {
          "name": "Tech Support Bot",
          "appId": "...",
          "sessionId": "...",
          "serverPublicKey": "...",
          "sessionPrivateKey": "..."
        }
      }
    }
  }
}
```

### Environment Variables

```json
{
  "channels": {
    "mixin": {
      "appId": "${MIXIN_APP_ID}",
      "sessionId": "${MIXIN_SESSION_ID}",
      "serverPublicKey": "${MIXIN_SERVER_PUBLIC_KEY}",
      "sessionPrivateKey": "${MIXIN_SESSION_PRIVATE_KEY}"
    }
  }
}
```

Set environment variables:
```bash
export MIXIN_APP_ID="your-app-id"
export MIXIN_SESSION_ID="your-session-id"
export MIXIN_SERVER_PUBLIC_KEY="your-public-key"
export MIXIN_SESSION_PRIVATE_KEY="your-private-key"
```

## Project Structure

```
mixin-claw/
├── index.ts                  # Plugin entry point
├── package.json              # npm configuration
├── openclaw.plugin.json      # OpenClaw plugin manifest
├── tsconfig.json             # TypeScript configuration
├── README.md                 # This file (English documentation)
├── README.zh-CN.md           # Chinese documentation
├── .gitignore                # Git ignore rules
└── src/                      # Source code
    ├── channel.ts            # Channel definition & connection logic
    ├── config-schema.ts      # Zod schema for configuration
    ├── config.ts             # Configuration parser
    ├── runtime.ts            # Runtime singleton
    ├── inbound-handler.ts    # Inbound message processing
    ├── send-service.ts       # Outbound message sending (with retry)
    ├── crypto.ts             # Crypto utilities
    └── decrypt.ts            # Decryption utilities
```

**Key Features**:
- ✅ Zero pre-compilation (OpenClaw uses jiti runtime TypeScript compilation)
- ✅ Clean source structure (matches Feishu plugin pattern)
- ✅ Full TypeScript support with type safety
- ✅ Modular design for maintainability

## Security Best Practices

1. **Protect Private Keys**:
   - Never hardcode private keys in source code
   - Use environment variables or encrypted config files
   - Rotate Session Private Keys periodically

2. **Access Control**:
   - Always configure `allowFrom` whitelist in production
   - Do not use `dmPolicy: open` (deprecated)

3. **Log Security**:
   - App IDs and Session IDs are masked in logs
   - Do not upload log files to public platforms

## Related Links

- [OpenClaw Documentation](https://openclaw.ai)
- [Mixin Developers Dashboard](https://developers.mixin.one/dashboard)
- [Mixin Bot API Documentation](https://developers.mixin.one/docs/bot-api)
- [Mixin Node.js SDK](https://github.com/MixinNetwork/bot-api-nodejs-client)
- [MixinClaw GitHub Repository](https://github.com/invago/mixinclaw)

## License

MIT License

## Contributing

Issues and Pull Requests are welcome!

## Changelog

### v1.0.4 (2026-03-04)

- ✅ **Never-stop retry mechanism** (infinite retry, no manual restart needed)
- ✅ Gentle incremental backoff (1s → 1.5s → 2.25s → 3s cap)
- ✅ Fast network recovery (max 3 seconds wait time)
- ✅ Perfect for unstable international networks
- ✅ Plugin stays alive 24/7

### v1.0.2 (2026-03-04)

- ✅ Added message retry mechanism (exponential backoff)
- ✅ Fixed direct and group message sending logic
- ✅ Optimized project structure (rootDir changed to ./src)
- ✅ Added detailed send logs with attempt count
- ✅ Smart retry (only for network timeout errors)

### v1.0.1 (2026-03-03)

- ✅ Added built-in commands (`/models`, `/status`, `/queue`, `/help`)
- ✅ Implemented `CommandBody` and `CommandAuthorized` handling
- ✅ Added access groups support
- ✅ Fixed unresponsive command messages

### v1.0.0 (2026-02-26)

- Initial release
- Mixin Blaze WebSocket message reception
- Direct and group message support
- Auto-reconnect, message deduplication, whitelist access control
- TypeScript rewrite, OpenClaw plugin compliant
