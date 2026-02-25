import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { getMixinRuntime } from "./runtime.js";
import { sendTextMessage } from "./send-service.js";
import { getAccountConfig } from "./config.js";
import type { MixinAccountConfig } from "./config-schema.js";

export interface MixinInboundMessage {
  conversationId: string;
  userId: string;
  messageId: string;
  category: string;
  data: string;
  createdAt: string;
}

const processedMessages = new Set<string>();
const MAX_DEDUP_SIZE = 2000;

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
  if (category === "PLAIN_TEXT") {
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

  if (isProcessed(msg.messageId)) return;

  if (!msg.category.startsWith("PLAIN_TEXT") && !msg.category.startsWith("PLAIN_POST")) {
    log.info(`[mixin] skip non-text message: ${msg.category}`);
    return;
  }

  const config = getAccountConfig(cfg, accountId);
  const text = decodeContent(msg.category, msg.data).trim();

  if (!text) return;

  if (!isDirect && !shouldPassGroupFilter(config, text)) {
    log.info(`[mixin] group message filtered: ${msg.messageId}`);
    return;
  }

  if (config.dmPolicy === "allowlist" && !config.allowFrom.includes(msg.userId)) {
    log.warn(`[mixin] user ${msg.userId} not in allowlist`);
    return;
  }

  markProcessed(msg.messageId);

  const route = rt.channel.routing.resolveAgentRoute({
    cfg,
    channel: "mixin",
    accountId,
    peer: {
      kind: isDirect ? "direct" : "group",
      id: isDirect ? msg.userId : msg.conversationId,
    },
  });

  if (!route) {
    log.warn(`[mixin] no agent route for ${msg.userId}`);
    return;
  }

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

  await rt.channel.session.recordInboundSession({
    storePath: route.agentId,
    sessionKey: route.sessionKey,
    ctx,
    onRecordError: (err: unknown) => {
      log.error("[mixin] session record error", err);
    },
  });

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
