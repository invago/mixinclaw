# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MixinClaw (`@invago/mixin`) is an OpenClaw channel plugin that connects Mixin Messenger to OpenClaw via Blaze WebSocket. It runs in-process with the OpenClaw Gateway — receiving inbound messages from Mixin's Blaze WebSocket and sending outbound messages via the Mixin HTTP API. Plugin ID is `mixin`.

## Build & Development Commands

```bash
npm install              # Install dependencies
npm run dev              # Auto-reload dev mode (nodemon + jiti)
npm run typecheck        # Type check (tsc --noEmit)
npm run lint             # ESLint on src/**/*.ts and index.ts
```

**Zero pre-compilation:** OpenClaw loads `.ts` files directly via jiti. There is no build step.

**No test framework:** Testing is manual — deploy to OpenClaw, send messages via Mixin Messenger, check logs with `[mixin]` prefix. See `docs/feature-testing.md` and `docs/media-testing.md`.

**Deployment:** `openclaw plugins install .` from repo root for local dev.

**Companion CLI tool:**
```bash
npm run tool:info        # Display config info
npm run tool:doctor      # Run diagnostics
```

## Architecture

### Message Flow

```
Mixin Blaze WS → blaze-service → inbound-handler → OpenClaw dispatch
                                                           ↓
Mixin HTTP API ← send-service ← outbound-plan ← OpenClaw reply
```

### Key Modules

| Module | Role |
|--------|------|
| `index.ts` | Plugin entry point, registers channel with OpenClaw |
| `src/channel.ts` | ChannelGateway implementation — account lifecycle, client construction, connection retry |
| `src/blaze-service.ts` | Persistent Blaze WebSocket connection with reconnect |
| `src/inbound-handler.ts` | Message dedup, authorization, profile caching, media download, command dispatch |
| `src/outbound-plan.ts` | Converts OpenClaw ReplyPayload → sequence of Mixin message steps |
| `src/send-service.ts` | Durable outbox (JSON file queue) with exponential backoff retry |
| `src/reply-format.ts` | Parses explicit template blocks in agent replies (`mixin-text`, `mixin-post`, `mixin-buttons`, `mixin-card`, `mixin-collect`, etc.) |
| `src/config-schema.ts` | Zod schemas for single/multi-account config validation |
| `src/config.ts` | Config parsing, account resolution, per-conversation policy |
| `src/crypto.ts` / `src/decrypt.ts` | Ed25519/X25519 key agreement, AES-256-CBC message decryption |
| `src/runtime.ts` | Global singleton — PluginRuntime ref and per-account Blaze senders |
| `src/proxy.ts` | Per-plugin HTTP/SOCKS proxy (doesn't affect other plugins) |
| `src/mixpay-*.ts` | MixPay payment collection: API client, background poller, order persistence |
| `src/status.ts` | Status aggregation and reporting |

### Multi-Account Support

Config supports both single-account (credentials at top level) and multi-account (`accounts` map + `defaultAccount`). Each account gets its own Blaze connection and outbox.

### Key Runtime Patterns

- **Retry:** Infinite retry with exponential backoff (1s base, 1.5x multiplier, 3s cap for connections, 60s cap for sends)
- **Dedup:** Sliding window Set of 2000 processed message IDs
- **Caching:** Conversation category (5 min TTL), user/group/bot profiles (10 min TTL, max 2000 entries)
- **Outbox:** Persisted to JSON files in OpenClaw data dir; survives restarts

## Code Conventions

- **Communicate in Chinese (中文)** with the user
- **No code comments** unless explicitly requested
- **No Co-authored-by** lines in commits
- **ESM imports** must include `.js` extension for local modules
- **Import order:** external packages → OpenClaw SDK → local modules; use `import type` for type-only
- **Naming:** files kebab-case, types PascalCase, functions/vars camelCase, constants UPPER_SNAKE_CASE
- **Formatting:** 2-space indent, double quotes, semicolons required, always use braces
- **Error handling:** never throw in gateway loops; log with `[mixin]` prefix; mask sensitive data
- **Async:** always await; gateway `startAccount` must await connection loop to prevent OpenClaw auto-restart conflicts
- **No emojis** in code files
- **Strict TypeScript:** use `unknown` over `any` for errors, explicit return types on exports
- **ESLint:** `@typescript-eslint/no-explicit-any` is turned off

## Git Conventions

```
<type>: <description>
```
Types: `feat`, `fix`, `docs`, `chore`, `refactor`

Commit every local modification. Push to remote only when explicitly requested.
