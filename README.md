# MixinClaw

将 [Mixin Messenger](https://mixin.one/messenger) 接入 [OpenClaw](https://openclaw.ai) AI 助手平台的频道插件。

## 快速开始（5 分钟）

### 1. 安装

```bash
# 安装到 OpenClaw extensions 目录
npm install mixinclaw --prefix $(openclaw extensions dir)
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

编辑 OpenClaw 配置文件（`openclaw config` 查看位置）：

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
  }
}
```

### 4. 启动

```bash
openclaw start
```

看到 `[mixin] connected to Mixin Blaze` 表示连接成功。

### 5. 测试

在 Mixin Messenger 中向 Bot 发送：
- 私聊：`/status` 或 `你好`
- 群聊：`@Bot 你的问题`（需包含 `?`、`帮`、`请` 等触发词）

## 配置参数

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `appId` | ✅ | - | Mixin 应用 UUID |
| `sessionId` | ✅ | - | 会话 UUID |
| `serverPublicKey` | ✅ | - | 服务器公钥 |
| `sessionPrivateKey` | ✅ | - | 会话私钥 |
| `allowFrom` | ❌ | `[]` | 白名单用户列表 |
| `requireMentionInGroup` | ❌ | `true` | 群组需触发词 |
| `debug` | ❌ | `false` | 调试模式 |

## 功能特性

- ✅ 实时消息接收（Mixin Blaze WebSocket）
- ✅ 私聊和群组支持
- ✅ 自动消息去重
- ✅ 群组触发词过滤（`?`、`帮`、`请`、`分析`）
- ✅ 内置命令（`/models`、`/status`、`/queue`、`/help`）
- ✅ 白名单访问控制
- ✅ 网络异常自动重试（最多 10 次，指数退避）

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

触发词：`?`、`帮`、`请`、`分析`、`总结`、`help`

### 内置命令

需要白名单权限：

| 命令 | 说明 |
|------|------|
| `/models` | 查看可用模型 |
| `/models <provider>` | 查看指定 Provider 的模型 |
| `/status` | 查看系统状态 |
| `/queue` | 查看任务队列 |
| `/help` | 查看帮助 |

### 获取用户 UUID

1. 向 Bot 发送任意消息
2. 查看日志中的 `user_id: xxx`
3. 复制到 `allowFrom` 列表

## 故障排查

| 问题 | 日志 | 解决方案 |
|------|------|---------|
| 连接失败 | `connecting to Mixin Blaze` 循环 | 检查 4 个凭证是否正确，私钥为 Ed25519 格式（44 字符） |
| 收不到消息 | 无 `[mixin] message:` | 检查 `allowFrom` 白名单，群组需触发词 |
| 消息被过滤 | `[mixin] group message filtered` | 添加 `?`、`帮`、`请` 等触发词，或设置 `requireMentionInGroup: false` |
| 发送失败 | `sendText failed: timeout` | 自动重试中，检查网络访问 `api.mixin.one` |
| 命令无响应 | `[mixin] route result: FOUND` | 确认用户在 `allowFrom` 白名单中 |

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
  }
}
```

设置环境变量：
```bash
export MIXIN_APP_ID="your-app-id"
export MIXIN_SESSION_ID="your-session-id"
# ... 其他变量
```

## 开发

```bash
git clone https://github.com/invago/mixinclaw.git
cd mixinclaw
npm install
npm run typecheck
```

**开发命令**：
- `npm run dev` - 开发模式（热重载）
- `npm run build` - 编译
- `npm run lint` - 代码检查

**项目结构**：
```
mixinclaw/
├── index.ts
├── src/
│   ├── channel.ts
│   ├── config-schema.ts
│   ├── inbound-handler.ts
│   └── send-service.ts
└── package.json
```

## 相关链接

- [OpenClaw 官网](https://openclaw.ai)
- [Mixin Developers Dashboard](https://developers.mixin.one/dashboard)
- [Mixin Bot API 文档](https://developers.mixin.one/docs/bot-api)
- [GitHub 仓库](https://github.com/invago/mixinclaw)

## 许可证

MIT License
