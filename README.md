# MixinClaw

将 [Mixin Messenger](https://mixin.one/messenger) 接入 [OpenClaw](https://openclaw.ai) AI 助手平台的频道插件。

## 关于 Mixin Messenger

[Mixin Messenger](https://mixin.one/messenger) 是一款基于区块链技术的加密即时通讯应用，具有以下特点：

- **端到端加密**：所有消息使用 Signal 协议加密
- **区块链集成**：支持加密货币转账和支付
- **机器人生态**：开放的 Bot API，支持丰富的交互功能
- **跨平台**：支持 iOS、Android、Windows、macOS、Web
- **群组功能**：支持多达 1000 人的群组
- **消息类型**：支持文本、图片、文件、转账、位置等多种消息类型

Mixin Network 提供了完善的 Bot API，允许开发者创建智能助手、客服机器人、交易机器人等应用。

## 功能特性

- ✅ 通过 Mixin Blaze WebSocket 实时接收消息
- ✅ 支持私聊和群组消息
- ✅ 自动消息去重（防止重复处理）
- ✅ 群组消息智能过滤（支持问号、触发词检测）
- ✅ 内置命令支持（`/models`, `/status`, `/help` 等）
- ✅ 统一的白名单访问控制
- ✅ 网络异常自动重试（指数退避策略）
- ✅ 支持多账号配置

## 快速开始

### 方式一：通过 npm 安装（推荐）

```bash

# 安装到 OpenClaw extensions 目录
npm install mixinclaw --prefix $(openclaw extensions dir)

# 或者全局安装
npm install -g mixinclaw
```

### 方式二：从源码安装

```bash
# 克隆仓库
git clone https://github.com/invago/mixinclaw.git
cd mixinclaw

# 安装依赖
npm install

# 类型检查
npm run typecheck

# 编译（可选，OpenClaw 支持 TypeScript 直接运行）
npm run build
```

### 方式三：本地开发模式

```bash
# 克隆到 OpenClaw extensions 目录
cd $(openclaw extensions dir)
git clone https://github.com/invago/mixinclaw.git mixin
cd mixin

# 安装依赖
npm install
```

### 方式四：直接复制文件

1. 下载本仓库所有文件
2. 复制到 OpenClaw extensions 目录：
   - Windows: `%APPDATA%\npm\node_modules\openclaw\extensions\mixin`
   - macOS/Linux: `~/.openclaw/extensions/mixin`
   - 或运行 `openclaw extensions dir` 查看具体路径

3. 安装依赖：
   ```bash
   cd <extensions 目录>/mixin
   npm install
   ```

## 前置要求

- **Node.js**: >= 18.0.0
- **OpenClaw**: >= 2026.2.0
- **npm**: >= 8.0.0
- **Mixin Bot 应用**: 从 [Mixin Developers Dashboard](https://developers.mixin.one/dashboard) 创建

### 检查环境

```bash
# 检查 Node.js 版本
node --version  # 应 >= v18.0.0

# 检查 npm 版本
npm --version   # 应 >= 8.0.0

# 检查 OpenClaw 版本
openclaw --version  # 应 >= 2026.2.0

# 查看 extensions 目录
openclaw extensions dir
```

## 配置

### 1. 创建 Mixin Bot

#### 步骤 1：访问开发者后台

访问 [Mixin Developers Dashboard](https://developers.mixin.one/dashboard)

#### 步骤 2：创建机器人

1. 使用 Mixin Messenger 扫描二维码登录
2. 点击右上角"+"创建新机器人
3. 填写机器人信息：
   - **名称**：机器人显示名称
   - **描述**：机器人功能介绍
   - **头像**：上传机器人头像

#### 步骤 3：获取凭证

创建完成后，在机器人管理页面获取以下信息：

- **App ID**：机器人应用的 UUID（格式：`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`）
- **Session ID**：会话的 UUID
- **Server Public Key**：服务器公钥（Base64 编码）
- **Session Private Key**：会话私钥（Ed25519 算法，Base64 编码）

**重要提示**：
- 请妥善保管私钥，不要泄露
- 私钥格式为 Ed25519 Base64（44 字符），非 RSA 格式

### 2. 配置 OpenClaw

在 OpenClaw 配置文件中添加 Mixin 频道配置。配置文件位置：
- Windows: `%APPDATA%\openclaw\openclaw.json`
- macOS/Linux: `~/.openclaw/openclaw.json`
- 或通过 `openclaw config` 命令查看

#### 单账号配置（最简单）

```json
{
  "channels": {
    "mixin": {
      "appId": "你的 App ID",
      "sessionId": "你的 Session ID",
      "serverPublicKey": "你的服务器公钥（Base64）",
      "sessionPrivateKey": "你的会话私钥（Ed25519 Base64）",
      "requireMentionInGroup": true,
      "allowFrom": [
        "授权用户A的UUID",
        "授权用户B的UUID"
      ],
      "requireMentionInGroup": false
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
        "customer-service": {
          "name": "客服机器人",
          "appId": "客服机器人 App ID",
          "sessionId": "客服机器人 Session ID",
          "serverPublicKey": "...",
          "sessionPrivateKey": "...",
          "requireMentionInGroup": false
        },
        "tech-support": {
          "name": "技术支持机器人",
          "appId": "技术支持机器人 App ID",
          "sessionId": "技术支持机器人 Session ID",
          "serverPublicKey": "...",
          "sessionPrivateKey": "...",
          "requireMentionInGroup": true,
          "allowFrom": ["用户 UUID 1", "用户 UUID 2"]
        }
      }
    }
  }
}
```

#### 带环境变量的配置（生产环境推荐）

```json
{
  "channels": {
    "mixin": {
      "appId": "${MIXIN_APP_ID}",
      "sessionId": "${MIXIN_SESSION_ID}",
      "serverPublicKey": "${MIXIN_SERVER_PUBLIC_KEY}",
      "sessionPrivateKey": "${MIXIN_SESSION_PRIVATE_KEY}",
      "requireMentionInGroup": true
    }
  }
}
```

然后在系统环境变量中设置：

```bash
# Linux/macOS
export MIXIN_APP_ID="your-app-id"
export MIXIN_SESSION_ID="your-session-id"
export MIXIN_SERVER_PUBLIC_KEY="your-public-key"
export MIXIN_SESSION_PRIVATE_KEY="your-private-key"

# Windows PowerShell
$env:MIXIN_APP_ID="your-app-id"
$env:MIXIN_SESSION_ID="your-session-id"
$env:MIXIN_SERVER_PUBLIC_KEY="your-public-key"
$env:MIXIN_SESSION_PRIVATE_KEY="your-private-key"
```

### 3. 配置参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `appId` | string | ✅ | - | Mixin 应用 UUID |
| `sessionId` | string | ✅ | - | Mixin 会话 UUID |
| `serverPublicKey` | string | ✅ | - | 服务器公钥（Base64） |
| `sessionPrivateKey` | string | ✅ | - | 会话私钥（Ed25519 Base64） |
| `requireMentionInGroup` | boolean | ❌ | `true` | 群组消息是否需要触发词 |
| `allowFrom` | string[] | ❌ | `[]` | 白名单用户 UUID 列表 |
| `debug` | boolean | ❌ | `false` | 调试模式（详细日志） |

### 4. 访问控制

Mixin 插件使用白名单机制控制访问权限：

#### 白名单模式（默认）

只有 `allowFrom` 列表中的用户可以使用命令和私聊功能：

```json
{
  "channels": {
    "mixin": {
      "appId": "...",
      "sessionId": "...",
      "serverPublicKey": "...",
      "sessionPrivateKey": "...",
      "allowFrom": [
       "用户 UUID 1", "用户 UUID 2"
      ]
    }
  }
}
```

#### 获取用户 UUID

在 Mixin Messenger 中：
1. 添加BOT，发送任意消息
2. 收到等待验证的提示
3. 复制用户UUID添加的配置中
4. UUID 格式：`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

## 使用方法

### 1. 启动 OpenClaw

```bash
# 启动 OpenClaw（会自动加载 mixin 插件）
openclaw start

启动成功后，日志会显示：
```
[mixin] connecting to Mixin Blaze (attempt 1)
[mixin] config: appId=46b4****6a18, sessionId=5d1e****b392
[mixin] connected to Mixin Blaze
```

### 2. 在 Mixin Messenger 中与 Bot 交互

#### 私聊场景

直接发送消息给 Bot：

```
你好！
/status
/model
```

#### 群组场景

@bot "你的问题"

如果 `requireMentionInGroup: true`（默认），需要在消息中包含触发词：

**触发词列表**：
- 问号 `?`（任意位置）
- `帮`、`请`、`分析`、`总结`、`help`

**示例**：
```
帮我分析一下这个问题？
请总结这段文字
这个怎么用？
这是什么意思 help
```

如果 `requireMentionInGroup: false`，群组中所有消息都会被处理。

### 3. 内置命令

Mixin 插件支持 OpenClaw 内置命令（需要白名单权限）：

| 命令 | 说明 | 示例 |
|------|------|------|
| `/models` | 查看可用的 AI 模型列表 | `/models` |
| `/models <provider>` | 查看指定 Provider 的模型 | `/models alicoding` |
| `/status` | 查看系统状态 | `/status` |
| `/queue` | 查看任务队列 | `/queue` |
| `/help` | 查看帮助信息 | `/help` |

### 4. 查看日志

```bash
# 实时查看 OpenClaw 日志
tail -f ~/.openclaw/logs/openclaw-*.log

# Windows PowerShell
Get-Content $env:APPDATA\openclaw\logs\openclaw-*.log -Wait -Tail 50
```

**关键日志标识**：
- `[mixin] connected to Mixin Blaze` - 连接成功
- `[mixin] message: <id>` - 收到消息
- `[mixin] sendTextMessage` - 发送回复
- `[mixin] group message filtered` - 群组消息被过滤（无触发词）

## 架构说明

```
Mixin 用户
    ↓ (Mixin Messenger App)
Mixin Blaze 服务器 (wss://blaze.mixin.one)
    ↓ WebSocket 长连接 (JWT RS512 认证)
[@mixin.dev/mixin-node-sdk]
    ↓ client.blaze.loop({ onMessage })
[inbound-handler.ts] 消息处理
    ├── 消息去重 (message_id)
    ├── 群组过滤 (触发词检测)
    ├── 访问控制 (allowFrom 白名单)
    └── rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher()
         ↓
    OpenClaw Agent (AI 处理)
         ↓ agent.response
[send-service.ts] 发送回复（带重试机制）
    ↓ client.message.sendOne()
Mixin API (api.mixin.one)
    ↓
Mixin 用户收到 AI 回复
```

### 消息重试机制

网络异常时自动重试，采用指数退避策略：

| 尝试次数 | 延迟时间 | 累计时间 |
|---------|---------|---------|
| 1 | 立即 | 0s |
| 2 | 1s | 1s |
| 3 | 2s | 3s |
| 4 | 4s | 7s |
| 5 | 8s | 15s |
| 6 | 16s | 31s |
| 7 | 32s | 63s |
| 8 | 64s | 127s |
| 9 | 128s | 255s |
| 10 | 256s | 511s |

最坏情况下会持续重试约 8.5 分钟，确保消息最终能发送成功。

## 开发

### 项目结构

```
mixinclaw/
├── index.ts                  # 插件入口
├── src/
│   ├── channel.ts            # 频道对象定义
│   ├── config-schema.ts      # Zod schema 配置
│   ├── config.ts             # 配置解析（单/多账号）
│   ├── runtime.ts            # PluginRuntime 单例
│   ├── inbound-handler.ts    # 消息接收 → Agent 分发
│   └── send-service.ts       # Mixin API 发送服务（带重试）
├── package.json              # npm 包配置
├── openclaw.plugin.json      # OpenClaw 插件清单
├── tsconfig.json             # TypeScript 配置
├── .env.example              # 环境变量模板
└── README.md                 # 本文档
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

# 编译（生产环境）
npm run build
```

### 调试技巧

1. **启用调试模式**：
   ```json
   {
     "channels": {
       "mixin": {
         "debug": true
       }
     }
   }
   ```

2. **查看详细日志**：
   ```bash
   # 设置日志级别为 debug
   openclaw start --log-level debug
   ```

3. **使用测试账号**：
   - 创建测试用 Mixin Bot
   - 使用另一个账号添加 Bot 为好友
   - 进行消息发送测试

## 故障排查

### 1. 连接失败

**现象**：
```
[mixin] connecting to Mixin Blaze (attempt 1)
[mixin] connecting to Mixin Blaze (attempt 2)
...
```

**解决方案**：
- 检查 `appId`、`sessionId`、`serverPublicKey`、`sessionPrivateKey` 是否正确
- 确认私钥格式为 Ed25519 Base64（44 字符）
- 检查网络是否能访问 `blaze.mixin.one:443`
- 尝试重新创建 Session 获取新的私钥

**验证凭证**：
```bash
# 在 Mixin Dashboard 重新生成 Session
# 复制完整的私钥（不要遗漏字符）
```

### 2. 收不到消息

**现象**：发送消息后 Bot 无响应

**解决方案**：
- 检查 `requireMentionInGroup` 配置（群组需触发词）
- 检查 `allowFrom` 白名单配置
- 查看日志是否有 `[mixin] message: <id>` 确认消息已接收
- 检查日志是否有 `[mixin] group message filtered` 确认被过滤

**测试私聊**：
```
# 先测试私聊（不需要触发词）
/status
```

### 3. 消息发送失败

**现象**：
```
[mixin] sendText failed: timeout of 3000ms exceeded
```

**解决方案**：
- 插件会自动重试（最多 10 次）
- 检查网络是否能访问 `api.mixin.one`
- 检查 Mixin API 服务状态
- 查看详细错误日志

### 4. 命令无响应

**现象**：发送 `/models` 或 `/status` 等命令没有回复

**解决方案**：
- 确认用户 UUID 在 `allowFrom` 白名单中
- 查看日志是否有 `[mixin] route result: FOUND`
- 确认 OpenClaw Agent 已正确配置
- 检查 `/status` 输出确认插件已加载

### 5. 类型错误

**现象**：`npm install` 后 TypeScript 报错

**解决方案**：
```bash
# 清理缓存重新安装
rm -rf node_modules package-lock.json
npm install

# 确认 peer dependency 版本
npm ls openclaw

# 升级 OpenClaw（如版本过低）
npm install -g openclaw@latest
```

### 6. 权限问题

**现象**：无法写入 extensions 目录

**解决方案**：
```bash
# Windows（管理员运行）
# macOS/Linux
sudo chown -R $(whoami) $(openclaw extensions dir)
```

## 技术栈

- **TypeScript** 5.3+ — 类型安全
- **@mixin.dev/mixin-node-sdk** 7.4+ — Mixin 官方 SDK
- **Zod** 3.22+ — Schema 校验
- **OpenClaw Plugin SDK** 2026.2+ — 插件接口

## 安全建议

1. **私钥保护**：
   - 不要在代码中硬编码私钥
   - 使用环境变量或加密的配置文件
   - 定期更换 Session 私钥

2. **访问控制**：
   - 生产环境务必配置 `allowFrom` 白名单
   - 不要使用 `dmPolicy: open`（已废弃）

3. **日志安全**：
   - 日志中会脱敏显示 App ID 和 Session ID
   - 不要将日志文件上传到公开平台

## 相关链接

- [OpenClaw 官网](https://openclaw.ai)
- [Mixin Messenger 官网](https://mixin.one/messenger)
- [Mixin Developers Dashboard](https://developers.mixin.one/dashboard)
- [Mixin Bot API 文档](https://developers.mixin.one/docs/bot-api)
- [Mixin Node.js SDK](https://github.com/MixinNetwork/bot-api-nodejs-client)
- [MixinClaw GitHub 仓库](https://github.com/invago/mixinclaw)

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 更新日志

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
