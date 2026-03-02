import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { getMixinRuntime } from "./runtime.js";
import { sendTextMessage } from "./send-service.js";
import { getAccountConfig } from "./config.js";
import type { MixinAccountConfig } from "./config-schema.js";
import { addPendingPairing, isPaired } from "./pairing.js";
import { decryptMixinMessage } from "./crypto.js";

export interface MixinInboundMessage {
  conversationId: string;
  userId: string;
  messageId: string;
  category: string;
  data: string;
  createdAt: string;
  publicKey?: string;
}

const processedMessages = new Set<string>();
const MAX_DEDUP_SIZE = 2000;
const unauthNotifiedUsers = new Map<string, number>();
const UNAUTH_NOTIFY_INTERVAL = 20 * 60 * 1000;

function isProcessed(messageId: string): boolean {
  return processedMessages.has(messageId);
}

function markProcessed(messageId: string): void {
  if (processedMessages.size >= MAX_DEDUP_SIZE) {
    const first = processedMessages.values().next().value;
    if (first) processedMessages.delete(first);
  }
  processedMessages.add(messageId);
}

function decodeContent(category: string, data: string): string {
  if (category.startsWith("PLAIN_TEXT") || category.startsWith("PLAIN_POST")) {
    try {
      return Buffer.from(data, "base64").toString("utf-8");
    } catch {
      return data;
    }
  }
  return `[${category}]`;
}

function shouldPassGroupFilter(config: MixinAccountConfig, text: string): boolean {
  if (!config.requireMentionInGroup) return true;
  const lower = text.toLowerCase();
  return (
    lower.includes("?") ||
    lower.includes("？") ||
    /帮|请|分析|总结|help/i.test(lower)
  );
}

export async function handleMixinMessage(params: {
  cfg: OpenClawConfig;
  accountId: string;
  msg: MixinInboundMessage;
  isDirect: boolean;
  log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string, e?: unknown) => void };
}): Promise<void> {
  const { cfg, accountId, msg, isDirect, log } = params;
  const rt = getMixinRuntime();

// 立即检查是否已处理，防止并发
   if (isProcessed(msg.messageId)) return;

   const config = getAccountConfig(cfg, accountId);
   
   // 处理加密消息
   if (msg.category === "ENCRYPTED_TEXT" || msg.category === "ENCRYPTED_POST") {
     log.info(`[mixin] decrypting encrypted message ${msg.messageId}, category=${msg.category}`);
     try {
       const decrypted = decryptMixinMessage(
         msg.data,
         config.sessionPrivateKey!,
         config.sessionId!
       );
       if (decrypted) {
         log.info(`[mixin] decryption successful! content: "${decrypted.substring(0, 100)}..."`);
         msg.data = Buffer.from(decrypted).toString("base64");
         msg.category = "PLAIN_TEXT";
       } else {
         log.error(`[mixin] decryption failed for ${msg.messageId}`);
         markProcessed(msg.messageId);
         return;
       }
     } catch (err) {
       log.error(`[mixin] decryption exception for ${msg.messageId}`, err);
       markProcessed(msg.messageId);
       return;
     }
   }

   // 检查是否是文本消息
   if (!msg.category.startsWith("PLAIN_TEXT") && !msg.category.startsWith("PLAIN_POST")) {
     log.info(`[mixin] skip non-text message: ${msg.category}`);
     return;
   }

   const text = decodeContent(msg.category, msg.data).trim();
   log.info(`[mixin] decoded text (len=${text.length}): "${text.substring(0, 100)}..."`);

  if (!text) return;

  // 群组消息过滤：只有包含关键词的消息才会被处理
  if (!isDirect && !shouldPassGroupFilter(config, text)) {
    log.info(`[mixin] group message filtered: ${msg.messageId}`);
    return;
  }

// allowlist 检查：只处理白名单中的用户
if (!config.allowFrom.includes(msg.userId)) {
       log.warn(`[mixin] user ${msg.userId} not in allowlist`);
       markProcessed(msg.messageId);
       
       // 只在首次消息时回复，20分钟内不重复回复
       const now = Date.now();
       const lastNotified = unauthNotifiedUsers.get(msg.userId) ?? 0;
       
       if (lastNotified === 0 || now - lastNotified > UNAUTH_NOTIFY_INTERVAL) {
         unauthNotifiedUsers.set(msg.userId, now);
         const msgBody = `⚠️ 请等待管理员认证\n\n您的 Mixin UUID: ${msg.userId}\n\n请将此UUID添加到 allowFrom 列表中完成认证`;
         sendTextMessage(config, msg.conversationId, msg.userId, msgBody, log).catch(() => {});
       }
       
       return;
     }

  // 标记为已处理
  markProcessed(msg.messageId);

   // 解析消息路由
   const peerId = isDirect ? msg.userId : msg.conversationId;
   log.info(`[mixin] resolving route: channel=mixin, accountId=${accountId}, peer.kind=${isDirect ? "direct" : "group"}, peer.id=${peerId}`);
   
   const route = rt.channel.routing.resolveAgentRoute({
     cfg,
     channel: "mixin",
     accountId,
     peer: {
       kind: isDirect ? "direct" : "group",
       id: peerId,
     },
   });
   
   log.info(`[mixin] route result: ${route ? "FOUND" : "NULL"} - agentId=${route?.agentId}, sessionKey=${route?.sessionKey}`);

   if (!route) {
     log.warn(`[mixin] no agent route for ${msg.userId} (peerId: ${peerId})`);
     return;
   }

  // 创建上下文
  const ctx = rt.channel.reply.finalizeInboundContext({
    Body: text,
    RawBody: text,
    From: isDirect ? msg.userId : msg.conversationId,
    SessionKey: route.sessionKey,
    AccountId: accountId,
    ChatType: isDirect ? "direct" : "group",
    Provider: "mixin",
    Surface: "mixin",
    MessageSid: msg.messageId,
  });

  // 记录会话
  await rt.channel.session.recordInboundSession({
    storePath: route.agentId,
    sessionKey: route.sessionKey,
    ctx,
    onRecordError: (err: unknown) => {
      log.error("[mixin] session record error", err);
    },
  });

  // 分发消息
  log.info(`[mixin] dispatching ${msg.messageId} from ${msg.userId}`);

  await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx,
    cfg,
    dispatcherOptions: {
      deliver: async (payload) => {
        const replyText = payload.text ?? "";
        if (!replyText) return;
        await sendTextMessage(config, msg.conversationId, msg.userId, replyText, log);
      },
    },
  });
}
