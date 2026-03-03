# Mixin-Claw OpenClaw 插件规范优化方案

## 📋 文档信息

- **版本**: 2.0.0
- **最后更新**: 2026-03-02
- **目标**: 将 mixin 插件优化为符合 OpenClaw 插件规范的标准插件
- **状态**: 计划阶段（Plan Mode）

---

## 🎯 优化目标

将 mixin 插件从自定义实现优化为符合 OpenClaw 插件规范的标准插件：

1. ✅ 符合 OpenClaw 插件规范（参考 feishu/discord 插件）
2. ✅ 集成 OpenClaw 插件 SDK 标准 API
3. ✅ 简化为只支持 allowlist 认证模式
4. ✅ 删除自定义配对系统
5. ✅ 保持 Mixin SDK 与 OpenClaw 通讯完全分离

---

## 📊 当前状态分析

### ✅ 正确统一的部分

| 组件 | 值 | 状态 |
|------|-----|------|
| Plugin ID | `mixin` | ✅ 统一 |
| Channel ID | `mixin` | ✅ 统一 |
| Package name | `mixin` | ✅ 正确 |
| 日志前缀 | `[mixin]` | ✅ 正确 |
| SDK 版本 | `@mixin.dev/mixin-node-sdk@7.4.1` | ✅ 正确 |

### ❌ 需要移除的部分

| 文件 | 用途 | 移除原因 |
|------|------|---------|
| `src/pairing-store.ts` | 自定义配对存储 | 替换为 OpenClaw 标准配置 |
| `src/pairing.ts` | 配对外壳模块 | 替换为 OpenClaw 标准配置 |
| `src/pair-cli.mjs` | 配对 CLI 工具 | 配对功能标准化后不需要 |
| `src/pair-cli.js` | 配对 CLI 工具 | 配对功能标准化后不需要 |

### ⚠️ 需要修改的部分

| 文件 | 修改内容 | 说明 |
|------|----------|------|
| `src/channel.ts` | 删除 `listPairedUsers` 逻辑 | 简化为只用 allowFrom |
| `src/inbound-handler.ts` | 删除 `isPaired` 导入 | 只用 allowlist 模式 |
| `README.md` | 删除 pairing 模式文档 | 只保留 allowlist |

---

## 🔧 通讯架构分析

### 通讯分离确认 ✅

**当前架构是正确的！** Mixin SDK 和 OpenClaw 的通信完全分离：

```
┌──────────────────────────────────────────────────────────────┐
│  Mixin Blaze WebSocket                                       │
│  (wss://blaze.mixin.one)                                     │
│  ↓ WebSocket (JWT RS512)                                     │
│  @mixin.dev/mixin-node-sdk                                   │
│  client.blaze.loop({ onMessage })                            │
│  ↓                                                           │
│  [inbound-handler.ts] 消息处理                               │
│  ├── 消息去重                                                 │
│  ├── 群组过滤                                                 │
│  ├── 访问控制 (allowlist)                                     │
│  └── rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher()
│       ↓                                                      │
│  [OpenClaw Gateway]                                          │
│  AI Agent 处理                                               │
│  ↓ agent.response                                            │
│  [send-service.ts] 发送回复                                  │
│  client.message.sendText()                                   │
│  ↓                                                           │
│  [Mixin API] (api.mixin.one)                                │
│  ↓                                                           │
│  Mixin 用户收到 AI 回复                                      │
└──────────────────────────────────────────────────────────────┘
```

### 通讯通道对比

| 通讯 | SDK | 凭证 | 通道 |
|------|-----|------|------|
| Mixin WebSocket 接收 | `@mixin.dev/mixin-node-sdk` | `config.appId, config.sessionId, config.sessionPrivateKey` | `client.blaze.loop()` |
| OpenClaw Gateway 接收 | `openclaw/plugin-sdk` | Gateway token (openclaw.json) | `dispatchReplyWithBufferedBlockDispatcher()` |
| Mixin API 发送 | `@mixin.dev/mixin-node-sdk` | `config.appId, config.sessionId, config.sessionPrivateKey` | `client.message.sendText()` |

**关键点：**
1. ✅ **完全分离**：Mixin SDK 和 OpenClaw SDK 互不依赖
2. ✅ **独立错误处理**：MIXIN SDK 错误不影响 OpenClaw，反之亦然
3. ✅ **独立凭证**：使用不同的配置字段

---

## 📝 完整优化计划

### 阶段 1: 符合基本规范

#### 1.1 package.json（已符合，需检查）

```json
{
  "name": "mixin",
  "version": "2.0.0",
  "type": "module",
  "main": "index.ts",
  "scripts": {
    "dev": "nodemon --exec \"node --import jiti/register index.ts\" --ext ts",
    "lint": "eslint src/**/*.ts index.ts",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "openclaw": ">=2026.2.0"
  },
  "dependencies": {
    "@mixin.dev/mixin-node-sdk": "^7.4.1",
    "@noble/curves": "^2.0.1",
    "@noble/hashes": "^2.0.1",
    "axios": "^1.6.0",
    "express": "^5.2.1",
    "zod": "^4.3.6"
  },
  "openclaw": {
    "extensions": ["./index.ts"],
    "channel": {
      "id": "mixin",
      "label": "Mixin Messenger",
      "selectionLabel": "Mixin Messenger (Blaze WebSocket)",
      "docsPath": "/channels/mixin",
      "order": 70,
      "aliases": ["mixin-messenger", "mixin"],
      "quickstartAllowFrom": true
    }
  }
}
```

#### 1.2 openclaw.plugin.json（已符合）

```json
{
  "id": "mixin",
  "channels": ["mixin"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  }
}
```

#### 1.3 index.ts（已符合）

```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { mixinPlugin } from "./src/channel.js";
import { setMixinRuntime } from "./src/runtime.js";

const plugin = {
  id: "mixin",
  name: "Mixin Messenger Channel",
  description: "Mixin Messenger channel via Blaze WebSocket",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi): void {
    setMixinRuntime(api.runtime);
    api.registerChannel({ plugin: mixinPlugin });
  },
};

export default plugin;
```

---

### 阶段 2: 代码优化

#### 2.1 删除文件

```bash
# 删除自定义配对系统
rm src/pairing-store.ts
rm src/pairing.ts
rm src/pair-cli.mjs
rm src/pair-cli.js
```

#### 2.2 修改 src/channel.ts

**修改前**：
```typescript
import { isPaired, listPairedUsers } from "./pairing-store.js";

// ...

security: {
  resolveDmPolicy: ({ account, accountId }: { account: ResolvedMixinAccount; accountId?: string | null }) => {
    const configKey = accountId ?? "default";
    const pairedUsers = listPairedUsers(configKey);
    const pairedUserIds = pairedUsers.map(p => p.userId);
    const allowFrom = account.config.allowFrom ?? [];
    const finalAllowFrom = Array.from(new Set([...allowFrom, ...pairedUserIds]));
    
    return {
      policy: "allowlist" as const,
      allowFrom: finalAllowFrom,
      allowFromPath: `channels.mixin${accountId && accountId !== "default" ? `.accounts.${accountId}` : ""}.allowFrom`,
      approveHint: pairedUserIds.length > 0 
        ? `已配对用户数: ${pairedUserIds.length} | 将用户的 Mixin UUID 添加到 allowFrom 列表中`
        : "将用户的 Mixin UUID 添加到 allowFrom 列表中",
    };
  },
},
```

**修改后**：
```typescript
// 删除所有 pairing 相关导入

security: {
  resolveDmPolicy: ({ account }: { account: ResolvedMixinAccount }) => {
    const allowFrom = account.config.allowFrom ?? [];
    
    return {
      policy: "allowlist" as const,
      allowFrom: allowFrom,
      allowFromPath: `channels.mixin.allowFrom`,
      approveHint: allowFrom.length > 0 
        ? `已配置白名单用户数: ${allowFrom.length} | 将用户的 Mixin UUID 添加到 allowFrom 列表中`
        : "将用户的 Mixin UUID 添加到 allowFrom 列表中",
    };
  },
},
```

#### 2.3 修改 src/inbound-handler.ts

**修改前**：
```typescript
import { addPendingPairing, isPaired } from "./pairing.js";

// ...

// 检查是否在配对列表
if (!isPaired(msg.userId, accountId)) {
  // 未认证处理
}
```

**修改后**：
```typescript
// 删除配对导入

// 直接使用 allowlist 检查
if (!config.allowFrom.includes(msg.userId)) {
  // 未认证处理
}
```

#### 2.4 修改 src/config-schema.ts

**修改前**：
```typescript
export const MixinConfigSchema: z.ZodTypeAny = MixinAccountConfigSchema.extend({
  dmPolicy: z.enum(["open", "pairing", "allowlist"]).optional().default("open"),
  accounts: z.record(z.string(), MixinAccountConfigSchema.optional()).optional(),
});
```

**修改后**：
```typescript
export const MixinConfigSchema: z.ZodTypeAny = MixinAccountConfigSchema.extend({
  // 只保留 allowlist，移除 dmPolicy
  accounts: z.record(z.string(), MixinAccountConfigSchema.optional()).optional(),
});
```

**说明**：Mixin 插件只支持 `allowlist` 模式，移除 `dmPolicy` 配置项。

#### 2.5 修改 package.json (scripts)

**修改前**：
```json
"scripts": {
  "pair": "node src/pair-cli.mjs",
  "pairing": "node src/pair-cli.mjs"
}
```

**修改后**：
```json
"scripts": {
  // 删除配对相关脚本
}
```

---

### 阶段 3: 配置和文档

#### 3.1 新的配置示例

```json
{
  "channels": {
    "mixin": {
      "enabled": true,
      "name": "Mixin Bot",
      "appId": "bfdbdda3-483c-4f19-bf7a-1c5476dae290",
      "sessionId": "15fbb5e8-660c-4e07-ab7d-c580aac9cc2e",
      "serverPublicKey": "8dcdfc4d785e5de2f84f71bf89469f94bd5d4f992cca45ebbe32b3a0ff886fcb",
      "sessionPrivateKey": "ff9a7a620d1aee65621af6fed5d7f7e90d5965c4e76f5dd3f86febbc9fc0afdb",
      "allowFrom": ["f54aff85-6028-4aa2-b315-83499e5c26f5", "aef61d54-4932-4e72-8186-a6dccfadee5a"],
      "requireMentionInGroup": true,
      "debug": false
    }
  }
}
```

#### 3.2 用户认证流程

**原理**：
- 用户 UUID 添加到 `allowFrom` 列表即认证
- 卸载 OpenClaw 配对系统

**流程**：
1. 用户在 Mixin 中发送消息
2. 如果 UUID 不在 `allowFrom` 中：
   - 第一次消息：收到通知（UUID + 认证说明）
   - 20 分钟内：不再重复通知
3. 管理员将 UUID 添加到 `allowFrom` 列表
4. 用户即可正常聊天

#### 3.3 README.md 更新要点

**删除的章节**：
- ❌ "pairing" 模式说明
- ❌ 配对命令 (`npm run pairing`)
- ❌ 管理员认证配对流程

**保留的章节**：
- ✅ "allowlist" 模式说明
- ✅ 用户 UUID 配置步骤
- ✅ 消息收发功能
- ✅ 加密消息解密
- ✅ 故障排查

**新增的配置示例**：
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

---

### 阶段 4: 部署和安装

#### 4.1 安装方式

**方式 1：npm 安装（推荐）**
```bash
# OpenClaw 会自动识别并安装
openclaw
# 或手动安装
openclaw extensions install openclaw-mixin-channel
```

**方式 2：本地路径安装**
```bash
openclaw extensions install --path E:\AI\mixin-claw
```

#### 4.2 配置步骤

1. **创建 Mixin Bot**
   - 访问 https://developers.mixin.one/dashboard
   - 创建机器人应用
   - 获取凭证（App ID, Session ID, Server Public Key, Session Private Key）

2. **配置 OpenClaw**
   ```json
   {
     "channels": {
       "mixin": {
         "enabled": true,
         "appId": "your-app-uuid",
         "sessionId": "your-session-uuid",
         "serverPublicKey": "...",
         "sessionPrivateKey": "...",
         "allowFrom": ["user-uuid-1", "user-uuid-2"]
       }
     }
   }
   ```

3. **重启网关**
   ```bash
   openclaw gateway restart
   ```

4. **在 Mixin 中测试**
   - 搜索机器人
   - 发送消息
   - 收到回复说明配置成功

#### 4.3 配置参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `enabled` | boolean | 否 | 是否启用（默认 true） |
| `name` | string | 否 | 显示名称 |
| `appId` | string | 是 | Mixin 应用 UUID |
| `sessionId` | string | 是 | Mixin 会话 UUID |
| `serverPublicKey` | string | 是 | 服务器公钥（Base64） |
| `sessionPrivateKey` | string | 是 | 会话私钥（Ed25519 Base64） |
| `allowFrom` | string[] | 是 | 白名单用户 UUID 列表 |
| `requireMentionInGroup` | boolean | 否 | 群组需触发词（默认 true） |
| `debug` | boolean | 否 | 调试模式（默认 false） |

---

### 阶段 5: 验证清单

#### 5.1 编译验证
```bash
cd E:\AI\mixin-claw

# 删除配对文件
rm src/pairing-store.ts src/pairing.ts src/pair-cli.mjs src/pair-cli.js

# 类型检查
npm run typecheck

# 代码检查
npm run lint
```

#### 5.2 功能验证
- [ ] package.json 和 openclaw.plugin.json 符合规范
- [ ] ChannelPlugin 完整定义（含 gateway, outbound, security）
- [ ] allowlist 配置生效
- [ ] 未认证用户第一次收到通知
- [ ] 20 分钟内不重复通知
- [ ] 加密消息解密正常
- [ ] 发送消息通过 Mixin SDK
- [ ] OpenClaw Gateway 接收消息

#### 5.3 通讯分离验证
- [ ] Mixin WebSocket 独立运行
- [ ] OpenClaw Gateway 接收消息
- [ ] Mixin SDK 错误不影响 OpenClaw
- [ ] 凭证完全分离（Mixin vs OpenClaw）

#### 5.4 文档验证
- [ ] README.md 删除 pairing 模式
- [ ] README.md 更新 allowlist 配置示例
- [ ] README.md 更新用户认证流程
- [ ] README.md 删除配对命令示例

---

## 🔍 代码审查清单

### ✅ 统一性检查
- [ ] Plugin ID: `mixin` (所有文件一致)
- [ ] Channel ID: `mixin` (所有文件一致)
- [ ] Package name: `mixin` (package.json)
- [ ] 日志前缀: `[mixin]` (所有文件)
- [ ] Mixin SDK: `@mixin.dev/mixin-node-sdk` (正确)
- [ ] OpenClaw SDK: `openclaw/plugin-sdk` (正确)

### ✅ 通讯分离检查
- [ ] Mixin WebSocket 使用 `client.blaze.loop()`
- [ ] OpenClaw 使用 `dispatchReplyWithBufferedBlockDispatcher()`
- [ ] Mixin API 发送使用 `client.message.sendText()`
- [ ] 凭证完全分离（Mixin vs OpenClaw）

### ✅ 配置简化检查
- [ ] dmPolicy 字段已删除
- [ ] pairing-store.ts 已删除
- [ ] isPaired 导入已删除
- [ ] 配对 CLI 命令已删除

### ✅ 认证检查
- [ ] 只支持 allowlist 模式
- [ ] allowFrom 配置正常工作
- [ ] 未认证用户第一次发送消息
- [ ] 20 分钟内不重复通知

---

## 📦 最终文件结构

```
mixin-claw/
├── index.ts                          ✅ 插件入口（已符合）
├── package.json                      ✅ 已有 openclaw 字段
├── openclaw.plugin.json              ✅ 已有基本结构
├── README.md                         ✅ 需更新（删除 pairing）
├── tsconfig.json                     ✅ 保持
├── .env.example                      ✅ 保持
├── src/
│   ├── channel.ts                    ✅ 需优化（删除 listPairedUsers）
│   ├── config-schema.ts              ✅ 需优化（删除 dmPolicy）
│   ├── config.ts                     ✅ 保持
│   ├── runtime.ts                    ✅ 保持
│   ├── inbound-handler.ts            ✅ 需优化（删除 isPaired）
│   ├── send-service.ts               ✅ 保持
│   ├── crypto.ts                     ✅ 保持（解密功能）
│   └── onboarding.ts                 🆕 配置向导（可选）
└── node_modules/                     ✅ 由 npm 安装
```

---

## 🚀 执行命令清单

```bash
# 1. 进入项目
cd E:\AI\mixin-claw

# 2. 删除配对文件
rm src/pairing-store.ts src/pairing.ts src/pair-cli.mjs src/pair-cli.js

# 3. 修改文件（参考上面的 "阶段 2: 代码优化"）
# - src/channel.ts
# - src/inbound-handler.ts  
# - src/config-schema.ts

# 4. 代码检查
npm run lint

# 5. 类型检查
npm run typecheck

# 6. 测试运行
npm run dev
```

---

## 📊 优化影响对比

| 项目 | 优化前 | 优化后 |
|------|-------|-------|
| **认证方式** | open/pairing/allowlist | only allowlist |
| **配对系统** | 自定义存储 | 配置文件 |
| **配置文件** | 5 个 | 4 个 |
| **代码文件** | 10 个 | 6 个 |
| **复杂度** | 高 | 低 |
| **密保性** | 中 | 高 |
| **维护性** | 中 | 高 |

---

## ✅ 最终确认清单

Before proceeding with the implementation:

- [ ] 授权修改文件
- [ ] 类型检查通过
- [ ] 功能测试通过
- [ ] 文档更新完成
- [ ] 代码审查通过

---

**文档版本**: 2.0.0  
**最后更新**: 2026-03-02  
**状态**: Plan Mode - 等待用户批准执行
