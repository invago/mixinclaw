  # MixinClaw 插件迁移指南

  > 本文档指导您将本地独立开发的 MixinClaw 插件迁移到 OpenClaw extensions 目录

  ---

  ## 目录

  - [迁移前准备](#迁移前准备)
  - [理解运行方式](#理解运行方式)
  - [解除本地插件绑定](#解除本地插件绑定)
  - [安装新版插件到 extensions](#安装新版插件到-extensions)
  - [配置验证](#配置验证)
  - [迁移后测试](#迁移后测试)
  - [保留自定义修改](#保留自定义修改)
  - [回滚方案](#回滚方案)
  - [故障排查](#故障排查)
  - [附录](#附录)

  ---

  ## 理解运行方式

### 本地运行方式 vs Extensions 运行方式

#### 方式 1：本地独立运行（旧方式）
```bash
E:\AI\mixin-claw\
├── index.ts              # 插件入口
├── package.json
├── openclaw.plugin.json
├── src/
└── node_modules/

# 运行方式
cd E:\AI\mixin-claw
node --import jiti/register index.ts
```

**特点：**
- ✅ 直接运行，不需要 OpenClaw
- ✅ 开发调试方便
- ❌ 需要手动管理依赖
- ❌ 无法使用 OpenClaw 的插件管理功能

#### 方式 2：Extensions 运行（新方式）
```bash
C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\
└── mixin\                # 插件目录
    ├── index.ts
    ├── package.json
    ├── openclaw.plugin.json
    ├── src/
    └── node_modules/

# OpenClaw 自动管理
openclaw start          # 加载所有 extensions
```

**特点：**
- ✅ 统一依赖管理
- ✅ 自动版本升级
- ✅ 集中式配置管理
- ❌ 需要通过 OpenClaw 启动

### 选择建议
- **个人开发**：本地运行方式更灵活
- **生产环境**：推荐 extensions 方式便于维护
- **多个插件**：必须使用 extensions 方式

 ---
  
 ## 迁移前准备

 ### 补充：Node.js 和 OpenClaw 安装确认

 **Node.js >= 18.0.0**
```bash
node --version
npm --version
```

**OpenClaw >= 2026.2.0**
```bash
openclaw --version
```

**Extensions 目录确认**
 ```bash

 # 默认 extensions 路径
 ls C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions

 # 如果目录不存在，创建它
 mkdir -p C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions
 ```

 ### 1. 确认环境要求
- ✅ Node.js >= 18.0.0
- ✅ OpenClaw >= 2026.2.0
- ✅Mixin Bot 应用凭证（App ID、Session ID、密钥）

### 2. 备份配置
```bash
# 复制当前配置文件
cp E:\AI\mixin-claw\openclaw.plugin.json E:\AI\mixin-claw\openclaw.plugin.json.bak
```

### 3. 记录当前配置
记录以下信息（来自 `openclaw.plugin.json`）：
- 插件 ID: `mixin`
- 支持渠道: `["mixin"]`
- 当前使用的 access token 和配置参数

---

 ## 解除本地插件绑定（保留原项目）

### 1. 停止 OpenClaw 服务
```bash
# 在 OpenClaw workspace 目录
openclaw stop
```

### 2. 备份原项目目录
```bash
# 重命名为备份目录（保留原项目）
mv E:\AI\mixin-claw E:\AI\mixin-claw-backup
```

> ✅ **重要**：原项目目录将被保留为 `mixin-claw-backup`，仅解除绑定关系

### 3. 清理插件注册信息
在 OpenClaw workspace 的 `.openclaw` 目录中查找插件注册文件：

```bash
# 查找插件相关配置
E:\AI\openclaw\workspace\.openclaw\
```

如果存在 plugins 配置文件，移除 `mixin` 相关条目。

### 4. 注意事项

**📌 立即执行：**

1. 停止 OpenClaw：`openclaw stop`
2. 备份项目：`mv E:\AI\mixin-claw E:\AI\mixin-claw-backup`
3. 保留备份目录：**不要删除** `E:\AI\mixin-claw-backup`，直到确认迁移成功

 **📌 迁移后：**
 - 本地项目 `E:\AI\mixin-claw` 现在为空目录
 - 插件实际运行在 `C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\mixin`
 - 原有配置在 `E:\AI\mixin-claw-backup\openclaw.plugin.json`

 ---
 
 ## 安装新版插件到 extensions

### 方案 A：通过 npm 安装（推荐）

```bash
# 进入 extensions 目录
cd C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions

# 安装最新版插件
npm install openclaw-mixin-channel
```

### 方案 B：从源码安装

```bash
# 进入 extensions 目录
cd C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions

# 克隆仓库
git clone https://github.com/invago/mixinclaw.git mixin

cd mixin
npm install

# 验证类型
npm run typecheck
```

### 验证安装
```bash
# 应该看到以下结构
C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\
└── mixin\
    ├── package.json
    ├── openclaw.plugin.json
    ├── src/
    └── index.ts
 ```

 ---

 ## 配置验证（openclaw.json 对比）

 ### 1. 检查 OpenClaw 配置文件

确保 `openclaw.json` 中的 channels 配置保持一致：

**原配置**（来自 `E:\AI\mixin-claw-backup`）：
```json
{
  "channels": {
    "mixin": {
      "appId": "your-app-uuid",
      "sessionId": "your-session-uuid",
      "serverPublicKey": "your-server-public-key-base64",
      "sessionPrivateKey": "your-ed25519-private-key-base64",
      "dmPolicy": "allowlist",
      "allowFrom": ["user-uuid-1", "user-uuid-2"]
    }
  }
}
```

 **新配置**（应保持完全一致）

### 配置文件位置对比

**原配置位置**（本地项目）：
```
E:\AI\mixin-claw\
└── openclaw.plugin.json
```

**新配置位置**（extensions）：
```
C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\
└── mixin\
    ├── openclaw.plugin.json
    ├── package.json
    └── src/
```

### 2. 确认 allowlist 模式配置
```json
{
  "channels": {
    "mixin": {
      "dmPolicy": "allowlist",
      "allowFrom": [
        "user-uuid-1",
        "user-uuid-2"
      ]
    }
  }
}
```

### 3. 启用调试模式（可选）
```json
{
  "channels": {
    "mixin": {
      "debug": true
    }
  }
}
```

 ---
 
 ## 迁移后测试

### 1. 启动 OpenClaw
```bash
cd E:\AI\openclaw\workspace
openclaw start
```

### 2. 查看日志
```bash
# 检察插件加载成功
openclaw logs | grep mixin
```

**预期日志输出：**
```
[mixin] Plugin loaded successfully
[mixin] Channel registered: mixin
[mixin] WebSocket connecting to wss://blaze.mixin.one
```

### 3. 测试消息 flow

#### 私聊测试
1. 在 Mixin Messenger 中向 Bot 发送消息
2. 确认 AI 正常回复

#### 群组测试（如启用 `requireMentionInGroup`）
1. 在群组中发送包含触发词的消息：
   ```
   帮我分析这个问题？
   请总结这段文字
   这是什么意思？
   ```

### 4. 验证白名单功能
```bash
# 检查 allowFrom 列表中的用户是否可以正常对话
# 检查不在列表中的用户是否被拒绝
 ```

 ---
 
 ## 保留自定义修改

### 如果您有自定义功能

如果您在原项目 `E:\AI\mixin-claw-backup` 中有自定义修改（如自定义消息处理、添加新功能等），迁移时需要采取以下步骤保留这些修改：

#### 方案 A：创建 fork 并使用 source 安装

1. **创建您自己的 GitHub 仓库 fork**
```bash
# 1. 访问 https://github.com/invago/mixinclaw
# 2. 点击 "Fork" 按钮，创建您自己的副本
# 3. 将您的修改推送到这个 fork 仓库
```

2. **从您的 fork 安装到 extensions**
```bash
cd C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions

# 克隆您的 fork（替换为您自己的仓库 URL）
git clone https://github.com/YOUR_USERNAME/mixinclaw.git mixin

cd mixin
npm install
npm run typecheck
```

3. **更新您的 fork**
```bash
cd C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\mixin

# 添加原作者仓库作为 upstream
git remote add upstream https://github.com/invago/mixinclaw

# 获取最新更新
git fetch upstream

# 合并更新（保持您的修改）
git checkout main
git merge upstream/main

# 解决冲突后继续
npm install
 npm run typecheck
 ```

 #### 方案 B：复制修改到新 extensions 目录

 如果您的修改不多，可以直接复制到 extensions 目录：

如果您的修改不多，可以直接复制到 extensions 目录：

```bash
# 1. 从备份复制修改的文件
copy E:\AI\mixin-claw-backup\src\your-custom-file.ts C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\mixin\src\

# 2. 如果有新的依赖包
copy E:\AI\mixin-claw-backup\package.json C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\mixin\

# 3. 重新安装依赖
cd C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\mixin
npm install

# 4. 类型检查
npm run typecheck
```

#### 方案 C：覆盖式迁移（谨慎使用）

如果备份目录中的代码已经远远领先原仓库：

```bash
# 1. 备份您的备份（双重保险）
xcopy E:\AI\mixin-claw-backup E:\AI\mixin-claw-backup-backup /E /I

# 2. 删除 extensions 中的 mixin 目录
rmdir /S /Q C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\mixin

# 3. 复制整个备份目录到 extensions
xcopy E:\AI\mixin-claw-backup C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\mixin /E /I

# 4. 重新安装依赖
cd C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\mixin
npm install
npm run typecheck
```

### 重要提示

⚠️ **切勿直接在 extensions 目录中编辑代码**

- extensions 目录中的代码可能被 `npm update` 覆盖
- 建议使用 Git 管理自定义修改
- 定期备份您的修改

⚠️ **依赖管理**

extensions 目录中的 `node_modules` 是独立的：
```
C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\
└── mixin\
    ├── node_modules\      # mixin 的依赖
    └── package.json
```

 这不是 bug，而是 feature - 确保每个插件的依赖独立，不会互相冲突。

 ---
 
  ## 回滚方案

 ### 如果迁移失败，快速回滚：

 ```bash
 # 1. 停止 OpenClaw
 openclaw stop

 # 2. 恢复原项目目录
 mv E:\AI\mixin-claw-backup E:\AI\mixin-claw

 # 3. 重新启动
 openclaw start
 ```

 ### 恢复配置
 ```bash
 # 如果配置被修改，恢复备份
 cp E:\AI\mixin-claw-backup\openclaw.plugin.json E:\AI\mixin-claw\openclaw.plugin.json
 ```

---

 ## 故障排查

 ### 1. 插件未加载
 **现象**：日志中没有 `[mixin] Plugin loaded`

 **解决方案**：
 ```bash
 # 检查 extensions 目录结构（注意：不是 openclaw 目录）
 ls C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\mixin

 # 确认 package.json 存在
 cat C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\mixin\package.json
 ```

 ### 2. 连接失败
 **现象**：持续重连 `connecting to Mixin Blaze`

 **解决方案**：
 - 验证 `appId`、`sessionId`、`sessionPrivateKey` 正确性
 - 确认私钥格式为 Ed25519 Base64
 - 检查网络是否能访问 `blaze.mixin.one:443`
 - 检查防火墙设置

 ### 3. 收不到消息
 **现象**：发送消息后 Bot 无响应

 **解决方案**：
 - 检查 `dmPolicy` 配置（`open/pairing/allowlist`）
 - 群组模式检查 `requireMentionInGroup` 设置
 - 查看日志：`[mixin] skip non-text message` 表示消息类型不支持
 - 检查用户是否在白名单中（如果使用 allowlist 策略）

 ### 4. 消息重复处理
 **现象**：同一条消息触发多次回复

 **解决方案**：
 - 插件已内置消息去重机制
 - 检查是否运行了多个 OpenClaw 实例
 - 查看 `message_id` 是否重复
 - 检查是否配置了多个相同的 Bot 账号

 ### 5. TypeScript 类型错误
 **现象**：`npm install` 后报错

 **解决方案**：
 ```bash
 cd C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\mixin
 rm -rf node_modules package-lock.json
 npm install
 npm run typecheck
 ```
 
 ### 6. 找不到插件
 **现象**：`openclaw start` 报错 `plugin not found`

 **解决方案**：
 ```bash
 # 检查 extensions 目录路径
 dir C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions

 # 确认 mixin 目录存在
 dir C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\mixin

 # 重启 OpenClaw
 openclaw stop
 openclaw start
 ```

 ---

 # 附录

 ### A. Extensions 目录路径

**Windows 默认路径：**
```
C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\
```

**查看 extensions 目录命令：**
```bash
# 方式 1：直接查看
ls C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions

# 方式 2：使用 npm 命令
npm root -g

# 方式 3：通过 PowerShell
gcm npm | Select-Object -ExpandProperty Source | Split-Path | Split-Path | Join-Path -ChildPath "Roaming\npm\node_modules\openclaw\extensions"
```

**多账户插件目录结构：**
```
extensions/
├── mixin/                    # 主频道插件
│   ├── package.json
│   ├── openclaw.plugin.json
│   ├── src/
│   └── node_modules/
├── discord/                  # Discord 频道（可选）
└── telegram/                 # Telegram 频道（可选）
```

### B. openclaw.json 配置对比

#### 方式 1：本地独立运行配置

**项目位置：** `E:\AI\mixin-claw\openclaw.plugin.json`
```json
{
  "id": "mixin",
  "channels": ["mixin"],
  "configSchema": {
    "type": "object",
    "additionalProperties": true,
    "properties": {}
  }
}
```

**OpenClaw 主配置：** `~/.openclaw/openclaw.json`
```json
{
  "channels": {
    "mixin": {
      "appId": "your-app-uuid",
      "sessionId": "your-session-uuid",
      "serverPublicKey": "your-server-public-key-base64",
      "sessionPrivateKey": "your-ed25519-private-key-base64",
      "dmPolicy": "open",
      "allowFrom": [],
      "requireMentionInGroup": true,
      "debug": false
    }
  }
}
```

#### 方式 2：Extensions 运行配置

**插件配置：** `C:\Users\invat\AppData\Roaming\npm\node_modules\openclaw\extensions\mixin\openclaw.plugin.json`
```json
{
  "id": "mixin",
  "channels": ["mixin"],
  "configSchema": {
    "type": "object",
    "additionalProperties": true,
    "properties": {}
  }
}
```

**OpenClaw 主配置（相同）：** `~/.openclaw/openclaw.json`
```json
{
  "channels": {
    "mixin": {
      "appId": "your-app-uuid",
      "sessionId": "your-session-uuid",
      "serverPublicKey": "your-server-public-key-base64",
      "sessionPrivateKey": "your-ed25519-private-key-base64",
      "dmPolicy": "open",
      "allowFrom": [],
      "requireMentionInGroup": true,
      "debug": false
    }
  }
}
```

#### 配置差异对比表

| 项目 | 本地运行 | Extensions 运行 |
|------|---------|----------------|
| 插件安装方式 | `npm install` | `npm install` 或 `git clone` |
| node_modules 位置 | `E:\AI\mixin-claw\node_modules` | `extensions\mixin\node_modules` |
| 配置文件位置 | `E:\AI\mixin-claw\openclaw.plugin.json` | `extensions\mixin\openclaw.plugin.json` |
| OpenClaw 启动 | 不需要 | 必须 `openclaw start` |
| 升级方式 | `npm update` | `npm update` 或 `git pull` |
| 多插件支持 | 需手动配置 | 自动扫描 |

### C. 配置参数完整列表

 | 参数 | 类型 | 默认值 | 说明 |
 |------|------|--------|------|
 | `appId` | string | 必填 | Mixin 应用 UUID |
 | `sessionId` | string | 必填 | Mixin 会话 UUID |
 | `serverPublicKey` | string | 必填 | 服务器公钥（Base64） |
 | `sessionPrivateKey` | string | 必填 | 会话私钥（Ed25519 Base64） |
 | `dmPolicy` | `"open"` \| `"pairing"` \| `"allowlist"` | `"open"` | 私聊访问策略 |
 | `allowFrom` | string[] | `[]` | 白名单用户 UUID 列表 |
 | `requireMentionInGroup` | boolean | `true` | 群组消息是否需要触发词 |
 | `debug` | boolean | `false` | 调试模式 |

  ### D. 配对管理命令

```bash
# 查看待配对列表
npm run pairing list

# 验证配对码
npm run pairing A7BD20

 # 配对帮助
 npm run pairing help
 ```
 
 ### E. 相关链接
 - [OpenClaw 官网](https://openclaw.ai)
 - [Mixin Developers](https://developers.mixin.one)
 - [GitHub 仓库](https://github.com/invago/mixinclaw)

 ---

**迁移完成时间**：______/______/______  
**操作人员**：__________________  
**验证状态**：✅ 通过 / ❌ 失败
