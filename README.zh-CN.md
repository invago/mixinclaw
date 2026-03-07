# MixinClaw

将 [Mixin Messenger](https://mixin.one/messenger) 接入 [OpenClaw](https://openclaw.ai)。

**[English Documentation](README.md)**

## 快速开始

### 1. 安装

将插件克隆到 OpenClaw 扩展目录：

```bash
# Linux/Mac
git clone https://github.com/invago/mixinclaw.git /usr/lib/node_modules/openclaw/extensions/mixin

# Windows PowerShell
git clone https://github.com/invago/mixinclaw.git "$env:APPDATA\npm\node_modules\openclaw\extensions\mixin"
```

安装依赖：

```bash
cd /usr/lib/node_modules/openclaw/extensions/mixin
npm install
```

### 2. 创建 Mixin Bot

前往 [Mixin Developers Dashboard](https://developers.mixin.one/dashboard)，创建机器人并记录以下凭证：

- `appId`
- `sessionId`
- `serverPublicKey`
- `sessionPrivateKey`

### 3. 配置

运行 `openclaw config` 找到配置文件，然后添加：

```json
{
  "channels": {
    "mixin": {
      "appId": "你的 App ID",
      "sessionId": "你的 Session ID",
      "serverPublicKey": "服务端公钥 Base64",
      "sessionPrivateKey": "会话私钥 Base64",
      "allowFrom": ["授权用户 UUID"],
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

说明：

- `mixin` 需要同时出现在 `plugins.allow` 和 `plugins.entries` 中。
- `proxy` 是可选项。
- 代理只作用于这个插件，不影响 OpenClaw 其他插件。
- Mixin 的 HTTP 请求和 Blaze WebSocket 都会走同一个代理。
- 如果 `proxy.url` 里已经包含认证信息，可以不再填写 `proxy.username` 和 `proxy.password`。

### 4. 启动

```bash
openclaw status
```

日志中看到 `[mixin] connected to Mixin Blaze` 表示连接成功。

### 5. 测试

- 私聊：`/status` 或 `你好`
- 群聊：`@Bot 你的问题`，并带上 `?` 或 `help` 等触发词

## 配置参数

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `appId` | 是 | - | Mixin 应用 UUID |
| `sessionId` | 是 | - | 会话 UUID |
| `serverPublicKey` | 是 | - | 服务端公钥 Base64 |
| `sessionPrivateKey` | 是 | - | 会话私钥 Ed25519 Base64 |
| `allowFrom` | 否 | `[]` | 授权用户 UUID 白名单 |
| `requireMentionInGroup` | 否 | `true` | 群聊是否要求触发词 |
| `debug` | 否 | `false` | 调试模式 |
| `proxy.enabled` | 否 | `false` | 是否启用插件级代理 |
| `proxy.url` | 启用时必填 | - | 代理地址，例如 `http://127.0.0.1:7890` 或 `socks5://127.0.0.1:10808` |
| `proxy.username` | 否 | - | 代理用户名 |
| `proxy.password` | 否 | - | 代理密码 |

## 功能

- 使用 Mixin Blaze WebSocket 接收消息
- 使用 HTTP 发送消息
- 发送消息持久化 outbox，失败自动重试直到成功
- 支持私聊和群聊
- 消息去重
- 基于白名单的访问控制
- 支持多账号
- 支持 HTTP 和 WebSocket 全量走插件级认证代理

## 重试机制

- 回复消息会先写入本地 outbox，再由后台 worker 发送。
- 发送失败会自动重试，直到发送成功。
- 插件重启后，未完成的消息仍会继续补发。

## 运维命令

- 发送 `/mixin-outbox` 可查看当前待发队列数量、下次重试时间和最近错误。

## 多账号示例

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
          "sessionPrivateKey": "...",
          "allowFrom": ["..."]
        },
        "bot2": {
          "name": "技术支持机器人",
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

## 安全提示

- 妥善保管 `sessionPrivateKey`
- 生产环境务必配置 `allowFrom`
- outbox 文件会保存待发送消息正文，不要暴露 `data/` 目录

## 相关链接

- [OpenClaw 文档](https://openclaw.ai)
- [Mixin Developers Dashboard](https://developers.mixin.one/dashboard)
- [Mixin Bot API 文档](https://developers.mixin.one/docs/bot-api)
