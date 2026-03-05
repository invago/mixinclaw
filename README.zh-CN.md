# MixinClaw

将 [Mixin Messenger](https://mixin.one/messenger) 接入 [OpenClaw](https://openclaw.ai) AI 助手平台的频道插件。

**[🇬🇧 English Documentation](README.md)**

## 快速开始（5 分钟）

### 1. 安装

#### 方式 A：npm 安装（推荐）

```bash
npm install @invago/mixinclaw --prefix $(openclaw extensions dir)
```

#### 方式 B：Git 安装（开发/测试）

```bash
git clone https://github.com/invago/mixinclaw.git $(openclaw extensions dir)/mixinclaw
```

或安装指定版本：
```bash
git clone -b v1.0.5 https://github.com/invago/mixinclaw.git $(openclaw extensions dir)/mixinclaw
```

### 2. 创建 Mixin Bot

1. 访问 [Mixin Developers Dashboard](https://developers.mixin.one/dashboard)
2. 使用 Mixin Messenger 扫描二维码登录
3. 点击"+"创建新机器人
4. 获取凭证：
   - **App ID** (UUID)
   - **Session ID** (UUID)
   - **Server Public Key** (Base64)
   - **Session Private Key** (Ed25519 Base64)

### 3. 配置

编辑 OpenClaw 配置文件（运行 `openclaw config` 查看位置）：

```json
{
  "channels": {
    "mixin": {
      "appId": "你的 App ID",
      "sessionId": "你的 Session ID",
      "serverPublicKey": "服务器公钥 Base64",
      "sessionPrivateKey": "会话私钥 Base64",
      "allowFrom": ["授权用户 UUID"]
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

**重要**：需要将 `mixin` 同时添加到 `plugins.allow` 和 `plugins.entries` 配置段。

### 4. 启动

```bash
openclaw start
```

看到 `[mixin] connected to Mixin Blaze` 表示连接成功。

### 5. 测试

在 Mixin Messenger 中向 Bot 发送：
- **私聊**：`/status` 或 `你好`
- **群聊**：`@Bot 你的问题`（需包含 `?`、`帮`、`请` 等触发词）

## 配置参数

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `appId` | ✅ | - | Mixin 应用 UUID |
| `sessionId` | ✅ | - | 会话 UUID |
| `serverPublicKey` | ✅ | - | 服务器公钥 Base64 |
| `sessionPrivateKey` | ✅ | - | 会话私钥 Ed25519 Base64 |
| `allowFrom` | ❌ | `[]` | 白名单用户 UUID 列表 |
| `requireMentionInGroup` | ❌ | `true` | 群组消息需要触发词 |
| `debug` | ❌ | `false` | 调试模式 |

## 功能特性

- ✅ 实时消息接收（Mixin Blaze WebSocket）
- ✅ 私聊和群组消息支持
- ✅ 自动消息去重
- ✅ 群组触发词过滤（`?`、`帮`、`请`、`分析`）
- ✅ 内置命令（`/models`、`/status`、`/queue`、`/help`）
- ✅ 白名单访问控制
- ✅ **永不放弃的重试机制**（温和递增：1 秒 → 3 秒上限）
- ✅ 支持多账号配置

## 使用指南

### 私聊场景

直接发送消息：
```
你好！
/status
/model
```

### 群组场景

需要@Bot 并包含触发词：
```
@Bot 这是什么意思？
@Bot 帮我分析一下
@Bot 请总结
```

**触发词**：`?`、`帮`、`请`、`分析`、`总结`、`help`

### 内置命令

需要白名单权限：

| 命令 | 说明 |
|------|------|
| `/models` | 查看可用 AI 模型 |
| `/models <provider>` | 查看指定 Provider 的模型 |
| `/status` | 查看系统状态 |
| `/queue` | 查看任务队列 |
| `/help` | 查看帮助信息 |

### 获取用户 UUID

1. 向 Bot 发送任意消息
2. 查看日志中的 `user_id: xxx`
3. 复制 UUID 到 `allowFrom` 列表

## 故障排查

| 问题 | 日志 | 解决方案 |
|------|------|----------|
| 连接失败 | `connecting to Mixin Blaze` 循环 | 检查 4 个凭证，私钥为 Ed25519 格式（44 字符） |
| 收不到消息 | 无 `[mixin] message:` | 检查 `allowFrom` 白名单，群组需触发词 |
| 消息被过滤 | `[mixin] group message filtered` | 添加 `?`、`帮`、`请` 等触发词 |
| 发送失败 | `sendText failed: timeout` | **永久自动重试**（温和递增：1s→3s），网络恢复后自动发送 |
| 命令无响应 | `[mixin] route result: FOUND` | 确认用户在 `allowFrom` 白名单中 |

## 网络重试机制

**永不放弃的重试策略**，专为不稳定国际网络设计：

```
第 1 次：立即
第 2 次：1 秒后
第 3 次：1.5 秒后
第 4 次：2.25 秒后
第 5 次及以后：3 秒后（上限）
```

**优势**：
- ✅ 插件永久在线（无需手动重启）
- ✅ 网络恢复后快速响应（最多等待 3 秒）
- ✅ 温和退避避免服务器压力
- ✅ 适合中国访问外网的网络波动场景

## 高级配置

### 多账号配置

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
          "sessionPrivateKey": "..."
        },
        "bot2": {
          "name": "技术支持",
          "appId": "...",
          "sessionId": "...",
          "serverPublicKey": "...",
          "sessionPrivateKey": "..."
        }
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

### 环境变量配置

```json
{
  "channels": {
    "mixin": {
      "appId": "${MIXIN_APP_ID}",
      "sessionId": "${MIXIN_SESSION_ID}",
      "serverPublicKey": "${MIXIN_SERVER_PUBLIC_KEY}",
      "sessionPrivateKey": "${MIXIN_SESSION_PRIVATE_KEY}"
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

设置环境变量：
```bash
export MIXIN_APP_ID="your-app-id"
export MIXIN_SESSION_ID="your-session-id"
export MIXIN_SERVER_PUBLIC_KEY="your-public-key"
export MIXIN_SESSION_PRIVATE_KEY="your-private-key"
```

## 项目结构

```
mixin-claw/
├── index.ts                  # 插件入口
├── package.json              # npm 配置
├── openclaw.plugin.json      # OpenClaw 插件清单
├── tsconfig.json             # TypeScript 配置
├── README.md                 # 英文文档
├── README.zh-CN.md           # 中文文档
├── .gitignore                # Git 忽略规则
└── src/                      # 源代码
    ├── channel.ts            # 频道定义与连接逻辑
    ├── config-schema.ts      # Zod schema 配置
    ├── config.ts             # 配置解析
    ├── runtime.ts            # 运行时单例
    ├── inbound-handler.ts    # 消息接收处理
    ├── send-service.ts       # 消息发送（含重试机制）
    ├── crypto.ts             # 加密工具
    └── decrypt.ts            # 解密工具
```

**主要特点**：
- ✅ 零预编译（OpenClaw 使用 jiti 运行时编译 TypeScript）
- ✅ 简洁的源码结构（参考飞书插件模式）
- ✅ 完整的 TypeScript 类型支持
- ✅ 模块化设计便于维护

## 开发

1. **私钥保护**：
   - 不要在代码中硬编码私钥
   - 使用环境变量或加密配置文件
   - 定期更换 Session 私钥

2. **访问控制**：
   - 生产环境务必配置 `allowFrom` 白名单

3. **日志安全**：
   - 日志中会脱敏显示 App ID 和 Session ID
   - 不要将日志文件上传到公开平台

## 相关链接

- [MixinClaw npm 包](https://www.npmjs.com/package/@invago/mixinclaw)
- [OpenClaw 文档](https://openclaw.ai)
- [Mixin Developers Dashboard](https://developers.mixin.one/dashboard)
- [Mixin Bot API 文档](https://developers.mixin.one/docs/bot-api)
- [Mixin Node.js SDK](https://github.com/MixinNetwork/bot-api-nodejs-client)
- [MixinClaw GitHub 仓库](https://github.com/invago/mixinclaw)

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 更新日志

### v1.0.5 (2026-03-05)

- ✅ **项目结构清理** (移除 dist/, 部署脚本，.env.example, .opencode/)
- ✅ **零预编译** (OpenClaw 使用 jiti 运行时 TypeScript 编译)
- ✅ **简洁最小化结构** (根目录仅 10 个文件，简化部署)
- ✅ **添加完整项目结构文档** 到 README
- ✅ **体积减少 95%** (2MB → 100KB)
- ✅ **无需构建步骤** (仅复制源文件)

### v1.0.4 (2026-03-04)

- ✅ **永不放弃的重试机制**（无限重试，无需手动重启）
- ✅ 温和递增退避（1 秒 → 1.5 秒 → 2.25 秒 → 3 秒上限）
- ✅ 网络快速恢复（最多等待 3 秒）
- ✅ 专为不稳定国际网络设计
- ✅ 插件 7×24 小时持续运行

### v1.0.2 (2026-03-04)

- ✅ 添加消息发送重试机制（指数退避策略）
- ✅ 修复私聊和群聊消息发送逻辑
- ✅ 优化项目结构（rootDir 改为 ./src）
- ✅ 添加详细的发送日志（包含尝试次数）
- ✅ 智能重试（仅网络超时错误）

### v1.0.1 (2026-03-03)

- ✅ 添加内置命令支持（`/models`, `/status`, `/queue`, `/help`）
- ✅ 实现完整的 `CommandBody` 和 `CommandAuthorized` 处理
- ✅ 支持 access groups 配置
- ✅ 修复命令消息未响应的问题

### v1.0.0 (2026-02-26)

- 首次发布
- 支持 Mixin Blaze WebSocket 消息接收
- 支持私聊/群组消息
- 自动重连、消息去重、白名单访问控制
- TypeScript 重写，符合 OpenClaw 插件规范
