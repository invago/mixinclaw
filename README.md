# MixinClaw

Mixin Messenger 频道插件，用于将 [Mixin Messenger](https://mixin.one/messenger) 接入 [OpenClaw](https://openclaw.ai) AI 助手平台。

## 功能特性

- ✅ 通过 Mixin Blaze WebSocket 实时接收消息
- ✅ 支持私聊和群组消息
- ✅ 自动消息去重（防止重复处理）
- ✅ 群组消息智能过滤（支持问号、触发词检测）
- ✅ 内置命令支持（`/models`, `/status`, `/help` 等）
- ✅ 统一的白名单访问控制

## 安装

### 前置要求

- Node.js >= 18.0.0
- OpenClaw >= 2026.2.0
- Mixin Bot 应用（从 [Mixin Developers](https://developers.mixin.one/dashboard) 创建）

### 通过 npm 安装

```bash
npm install openclaw-mixin-channel
```

### 从源码安装

```bash
git clone https://github.com/invago/mixinclaw.git
cd mixinclaw
npm install
npm run typecheck  # 验证类型
```

## 配置

### 1. 创建 Mixin Bot

1. 访问 [Mixin Developers Dashboard](https://developers.mixin.one/dashboard)
2. 创建新的机器人应用
3. 获取以下凭证：
   - **App ID** (UUID)
   - **Session ID** (UUID)
   - **Server Public Key** (Base64)
   - **Session Private Key** (Ed25519 Base64)

### 2. 配置访问策略

Mixin 插件目前**仅支持白名单模式**（`allowlist`）。

所有用户需要通过 `allowFrom` 配置进行认证。

```json
{
  "channels": {
    "mixin": {
      "appId": "your-app-uuid",
      "sessionId": "your-session-uuid",
      "serverPublicKey": "...",
      "sessionPrivateKey": "...",
      "allowFrom": ["user-uuid-1", "user-uuid-2"]
    }
  }
}
```

#### `allowlist` - 白名单（当前唯一支持的模式）

### 3. 配置 OpenClaw

在 OpenClaw 配置文件中添加 `channels.mixin` 配置：

#### 单账号配置

```json
{
  "channels": {
    "mixin": {
      "appId": "your-app-uuid",
      "sessionId": "your-session-uuid",
      "serverPublicKey": "your-server-public-key-base64",
      "sessionPrivateKey": "your-ed25519-private-key-base64",
      "dmPolicy": "open",
      "requireMentionInGroup": true,
      "debug": false
    }
  }
}
```

#### 多账号配置

```json
{
  "channels": {
    "mixin": {
      "accounts": {
        "bot1": {
          "name": "客服机器人",
          "appId": "bot1-app-uuid",
          "sessionId": "bot1-session-uuid",
          "serverPublicKey": "...",
          "sessionPrivateKey": "...",
          "dmPolicy": "open"
        },
        "bot2": {
          "name": "技术支持机器人",
          "appId": "bot2-app-uuid",
          "sessionId": "bot2-session-uuid",
          "serverPublicKey": "...",
          "sessionPrivateKey": "...",
          "dmPolicy": "allowlist",
          "allowFrom": ["user-uuid-1", "user-uuid-2"]
        }
      }
    }
  }
}
```

### 配置参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `appId` | string | 必填 | Mixin 应用 UUID |
| `sessionId` | string | 必填 | Mixin 会话 UUID |
| `serverPublicKey` | string | 必填 | 服务器公钥（Base64） |
| `sessionPrivateKey` | string | 必填 | 会话私钥（Ed25519 Base64） |
| `allowFrom` | string[] | `[]` | 白名单用户 UUID 列表（命令和私聊权限） |
| `requireMentionInGroup` | boolean | `true` | 群组消息是否需要包含触发词（`?`、`帮`、`请`、`分析` 等） |
| `debug` | boolean | `false` | 调试模式 |

## 使用方法

### 1. 启动 OpenClaw

确保 OpenClaw 已加载 MixinClaw 插件：

```bash
openclaw start
```

### 2. 使用命令（Slash Commands）

Mixin 插件支持 OpenClaw 内置命令，直接发送以 `/` 开头的消息：

```
/models        # 查看可用的模型列表
/status        # 查看系统状态
/queue         # 查看任务队列
/help          # 查看帮助
```

命令权限由 `allowFrom` 白名单控制（白名单用户可使用命令）。

### 3. 在 Mixin Messenger 中与 Bot 对话

#### 私聊场景

直接发送消息（支持命令和普通对话）：

```
你好！                    # 普通对话
/model                    # 查看模型列表
/status                   # 查看系统状态
```

#### 群组场景

如果 `requireMentionInGroup` 为 `true`，需要包含触发词：

```
帮我分析一下这个问题？
请总结这段文字
这是什么意思 help
```

或直接发送包含问号的消息：

```
这个怎么用？
```

### 3. 获取用户 UUID

如果需要配置白名单，可以在 Mixin Messenger 中：

1. 点击用户头像 → 个人资料
2. 复制 Mixin ID（格式：`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`）

## 架构说明

```
Mixin 用户
    ↓ (Mixin Messenger App)
Mixin Blaze 服务器 (wss://blaze.mixin.one)
    ↓ WebSocket 长连接 (JWT RS512 认证)
[@mixin.dev/mixin-node-sdk]
    ↓ client.blaze.loop({ onMessage })
[inbound-handler.ts] 消息处理
    ├── 消息去重
    ├── 群组过滤
    ├── 访问控制
    └── rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher()
         ↓
    OpenClaw Agent (AI 处理)
         ↓ agent.response
[send-service.ts] 发送回复
    ↓ client.message.sendText()
Mixin API (api.mixin.one)
    ↓
Mixin 用户收到 AI 回复
```

## 消息处理说明

### 命令支持

Mixin 插件基于 `nativeCommands: true` 实现 OpenClaw 内置命令支持，包括：

| 命令 | 说明 | 权限 |
|------|------|------|
| `/models [provider]` | 列出可用模型或指定 Provider 的模型 | 白名单 |
| `/status` | 查看系统状态（会话、模型、队列） | 白名单 |
| `/queue` | 查看任务队列 | 白名单 |
| `/help` | 查看帮助 | 白名单 |

**命令权限说明：**
- 命令默认需要 `allowFrom` 白名单授权
- `dmPolicy: open` 时，所有用户可使用命令
- `dmPolicy: allowlist` 时，仅白名单用户可使用命令
- `dmPolicy: pairing` 时，配对认证后的用户可使用命令

### 消息类型支持

- **PLAIN_TEXT** 消息：自动进行base64解码处理，支持中文和英文
- **PLAIN_POST** 消息：与PLAIN_TEXT相同的处理方式
- **ENCRYPTED_TEXT** 消息：自动解密


## 开发

### 项目结构

```
mixinclaw/
├── index.ts                  # 插件入口，register(api) 函数
├── src/
│   ├── channel.ts            # 频道对象定义（gateway/outbound/security）
│   ├── config-schema.ts      # Zod schema 配置定义
│   ├── config.ts             # 配置解析（单/多账号）
│   ├── runtime.ts            # PluginRuntime 单例
│   ├── inbound-handler.ts    # 消息接收 → Agent 分发
│   └── send-service.ts       # Mixin API 发送服务
├── package.json              # npm 包配置
├── openclaw.plugin.json      # OpenClaw 插件清单
├── tsconfig.json             # TypeScript 配置
└── .env.example              # 环境变量模板
```

### 开发命令

```bash
# 安装依赖
npm install

# 类型检查
npm run typecheck

# 开发模式（热重载）
npm run dev

# 代码检查
npm run lint
```

### 配对管理命令

```bash
# 查看待配对列表
npm run pairing list

# 验证配对码
npm run pairing A7BD20

# 配对帮助
npm run pairing help
```

### 类型检查

项目使用 TypeScript 编写，所有类型定义来自 `openclaw/plugin-sdk`。运行类型检查确保代码符合规范：

```bash
npx tsc --noEmit
```

## 故障排查

### 1. 连接失败

**现象**：日志显示 `connecting to Mixin Blaze` 后持续重连

**解决方案**：
- 检查 `appId`、`sessionId`、`sessionPrivateKey` 是否正确
- 确认私钥格式为 Ed25519 Base64（非 RSA）
- 检查网络是否能访问 `blaze.mixin.one:443`

### 2. 收不到消息

**现象**：发送消息后 Bot 无响应

**解决方案**：
- 检查 `requireMentionInGroup` 配置（群组需触发词）
- 检查 `allowFrom` 白名单配置
- 查看 OpenClaw 日志：`[mixin] skip non-text message` 表示消息类型不支持

### 3. 消息重复处理

**现象**：同一条消息触发多次 AI 回复

**解决方案**：
- 插件已内置消息去重（基于 `message_id`）
- 如仍重复，检查是否运行了多个 OpenClaw 实例
- 检查日志是否有 `[mixin] skip duplicate message` 条目

### 4. 命令无响应

**现象**：发送 `/models` 或 `/status` 等命令没有回复

**解决方案**：
- 确认插件版本 >= 1.0.1（支持内置命令）
- 检查 `allowFrom` 白名单配置
- 查看日志是否有 `[mixin] route result: FOUND` 确认消息路由成功
- 确认 OpenClaw Agent 已正确配置

### 5. 类型错误

**现象**：`npm install` 后 TypeScript 报错

**解决方案**：
```bash
# 清理缓存重新安装
rm -rf node_modules package-lock.json
npm install

# 确认 peer dependency 版本
npm ls openclaw
```

## 技术栈

- **TypeScript** 5.3+ — 类型安全
- **@mixin.dev/mixin-node-sdk** 7.4+ — Mixin 官方 SDK
- **Zod** 3.22+ — Schema 校验
- **OpenClaw Plugin SDK** 2026.2+ — 插件接口

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 相关链接

- [OpenClaw 官网](https://openclaw.ai)
- [Mixin Network 官网](https://mixin.one)
- [Mixin Developers](https://developers.mixin.one)
- [Mixin Node.js SDK](https://github.com/MixinNetwork/bot-api-nodejs-client)
- [MixinClaw GitHub 仓库](https://github.com/invago/mixinclaw)

## 更新日志

### v1.0.1 (2026-03-03)

- ✅ 添加内置命令支持（`/models`, `/status`, `/queue`, `/help`）
- ✅ 实现完整的 `CommandBody` 和 `CommandAuthorized` 处理
- ✅ 支持 access groups 配置（`cfg.commands.useAccessGroups`）
- ✅ 修复命令消息未响应的问题
- ✅ 更新 OpenClaw Plugin SDK 以支持原生命令

### v1.0.0 (2026-02-26)

- 首次发布
- 支持 Mixin Blaze WebSocket 消息接收
- 支持私聊/群组消息
- 自动重连、消息去重、白名单访问控制
- TypeScript 重写，符合 OpenClaw 插件规范
