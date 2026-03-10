import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { getAccountConfig } from "./config.js";
import type { MixinAccountConfig } from "./config-schema.js";
import { decryptMixinMessage } from "./crypto.js";
import { buildMixinReplyPlan } from "./reply-format.js";
import { getMixinRuntime } from "./runtime.js";
import {
  getOutboxStatus,
  purgePermanentInvalidOutboxEntries,
  sendButtonGroupMessage,
  sendCardMessage,
  sendPostMessage,
  sendTextMessage,
} from "./send-service.js";

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
const MAX_UNAUTH_NOTIFY_USERS = 1000;

function isProcessed(messageId: string): boolean {
  return processedMessages.has(messageId);
}

function markProcessed(messageId: string): void {
  if (processedMessages.size >= MAX_DEDUP_SIZE) {
    const first = processedMessages.values().next().value;
    if (first) {
      processedMessages.delete(first);
    }
  }
  processedMessages.add(messageId);
}

function pruneUnauthNotifiedUsers(now: number): void {
  for (const [userId, lastNotified] of unauthNotifiedUsers) {
    if (now - lastNotified > UNAUTH_NOTIFY_INTERVAL) {
      unauthNotifiedUsers.delete(userId);
    }
  }

  while (unauthNotifiedUsers.size >= MAX_UNAUTH_NOTIFY_USERS) {
    const first = unauthNotifiedUsers.keys().next().value;
    if (!first) {
      break;
    }
    unauthNotifiedUsers.delete(first);
  }
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
  if (!config.requireMentionInGroup) {
    return true;
  }
  const lower = text.toLowerCase();
  return lower.includes("?") || /帮我|请|分析|总结|help/i.test(lower);
}

function isOutboxCommand(text: string): boolean {
  return text.trim().toLowerCase().startsWith("/mixin-outbox");
}

function isOutboxPurgeInvalidCommand(text: string): boolean {
  return text.trim().toLowerCase() === "/mixin-outbox purge-invalid";
}

function formatOutboxStatus(status: Awaited<ReturnType<typeof getOutboxStatus>>): string {
  const lines = [
    `Outbox pending: ${status.totalPending}`,
    `Oldest pending: ${status.oldestPendingAt ?? "N/A"}`,
    `Next attempt: ${status.nextAttemptAt ?? "N/A"}`,
    `Latest error: ${status.latestError ?? "N/A"}`,
  ];

  if (status.pendingByAccount.length > 0) {
    lines.push("By account:");
    for (const item of status.pendingByAccount) {
      lines.push(`- ${item.accountId}: ${item.pending}`);
    }
  }

  return lines.join("\n");
}

function normalizeAllowEntry(entry: string): string {
  return entry.trim().toLowerCase();
}

async function readEffectiveAllowFrom(
  rt: ReturnType<typeof getMixinRuntime>,
  configAllowFrom: string[],
): Promise<Set<string>> {
  const storeAllowFrom = await rt.channel.pairing.readAllowFromStore("mixin").catch(() => []);
  return new Set([...configAllowFrom, ...storeAllowFrom].map(normalizeAllowEntry).filter(Boolean));
}

async function deliverMixinReply(params: {
  cfg: OpenClawConfig;
  accountId: string;
  conversationId: string;
  recipientId?: string;
  text: string;
  log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string, e?: unknown) => void };
}): Promise<void> {
  const { cfg, accountId, conversationId, recipientId, text, log } = params;
  const plan = buildMixinReplyPlan(text);

  if (!plan) {
    return;
  }

  if (plan.kind === "text") {
    await sendTextMessage(cfg, accountId, conversationId, recipientId, plan.text, log);
    return;
  }

  if (plan.kind === "post") {
    await sendPostMessage(cfg, accountId, conversationId, recipientId, plan.text, log);
    return;
  }

  if (plan.kind === "buttons") {
    if (plan.intro) {
      await sendTextMessage(cfg, accountId, conversationId, recipientId, plan.intro, log);
    }
    await sendButtonGroupMessage(cfg, accountId, conversationId, recipientId, plan.buttons, log);
    return;
  }

  await sendCardMessage(cfg, accountId, conversationId, recipientId, plan.card, log);
}

async function handleUnauthorizedDirectMessage(params: {
  rt: ReturnType<typeof getMixinRuntime>;
  cfg: OpenClawConfig;
  accountId: string;
  config: MixinAccountConfig;
  msg: MixinInboundMessage;
  log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string, e?: unknown) => void };
}): Promise<void> {
  const { rt, cfg, accountId, config, msg, log } = params;
  const dmPolicy = config.dmPolicy ?? "pairing";

  if (dmPolicy === "disabled") {
    return;
  }

  const now = Date.now();
  const lastNotified = unauthNotifiedUsers.get(msg.userId) ?? 0;
  const shouldNotify = lastNotified === 0 || now - lastNotified > UNAUTH_NOTIFY_INTERVAL;

  if (!shouldNotify) {
    return;
  }

  pruneUnauthNotifiedUsers(now);
  unauthNotifiedUsers.set(msg.userId, now);

  if (dmPolicy === "pairing") {
    try {
      const { code, created } = await rt.channel.pairing.upsertPairingRequest({
        channel: "mixin",
        id: msg.userId,
        accountId: accountId === "default" ? undefined : accountId,
        meta: {
          conversationId: msg.conversationId,
        },
      });

      if (created && code) {
        const reply = rt.channel.pairing.buildPairingReply({
          channel: "mixin",
          idLine: `Your Mixin UUID: ${msg.userId}`,
          code,
        });
        await sendTextMessage(cfg, accountId, msg.conversationId, msg.userId, reply, log);
      }
    } catch (err) {
      log.error(`[mixin] pairing reply failed for ${msg.userId}`, err);
    }
    return;
  }

  if (dmPolicy === "allowlist") {
    const reply = config.allowFrom.length > 0
      ? `OpenClaw: access not configured.\n\nYour Mixin UUID: ${msg.userId}\n\nAsk the bot owner to add your Mixin UUID to channels.mixin.allowFrom.`
      : `OpenClaw: access not configured.\n\nYour Mixin UUID: ${msg.userId}\n\nAsk the bot owner to add your Mixin UUID to channels.mixin.allowFrom.`;
    await sendTextMessage(cfg, accountId, msg.conversationId, msg.userId, reply, log);
  }
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

  if (isProcessed(msg.messageId)) {
    return;
  }

  const config = getAccountConfig(cfg, accountId);

  if (msg.category === "ENCRYPTED_TEXT" || msg.category === "ENCRYPTED_POST") {
    log.info(`[mixin] decrypting encrypted message ${msg.messageId}, category=${msg.category}`);
    try {
      const decrypted = decryptMixinMessage(
        msg.data,
        config.sessionPrivateKey!,
        config.sessionId!,
      );
      if (!decrypted) {
        log.error(`[mixin] decryption failed for ${msg.messageId}`);
        markProcessed(msg.messageId);
        return;
      }
      log.info(`[mixin] decryption successful: messageId=${msg.messageId}, length=${decrypted.length}`);
      msg.data = Buffer.from(decrypted).toString("base64");
      msg.category = "PLAIN_TEXT";
    } catch (err) {
      log.error(`[mixin] decryption exception for ${msg.messageId}`, err);
      markProcessed(msg.messageId);
      return;
    }
  }

  if (!msg.category.startsWith("PLAIN_TEXT") && !msg.category.startsWith("PLAIN_POST")) {
    log.info(`[mixin] skip non-text message: ${msg.category}`);
    return;
  }

  const text = decodeContent(msg.category, msg.data).trim();
  log.info(`[mixin] decoded text: messageId=${msg.messageId}, category=${msg.category}, length=${text.length}`);

  if (!text) {
    return;
  }

  if (!isDirect && !shouldPassGroupFilter(config, text)) {
    log.info(`[mixin] group message filtered: ${msg.messageId}`);
    return;
  }

  const effectiveAllowFrom = await readEffectiveAllowFrom(rt, config.allowFrom);
  const normalizedUserId = normalizeAllowEntry(msg.userId);
  const dmPolicy = config.dmPolicy ?? "pairing";
  const isAuthorized = dmPolicy === "open" || effectiveAllowFrom.has(normalizedUserId);

  if (!isAuthorized) {
    log.warn(`[mixin] user ${msg.userId} not authorized (dmPolicy=${dmPolicy})`);
    markProcessed(msg.messageId);
    if (isDirect) {
      await handleUnauthorizedDirectMessage({ rt, cfg, accountId, config, msg, log });
    }
    return;
  }

  markProcessed(msg.messageId);

  if (isOutboxCommand(text)) {
    if (isOutboxPurgeInvalidCommand(text)) {
      const result = await purgePermanentInvalidOutboxEntries();
      const recipientId = isDirect ? msg.userId : undefined;
      const replyText = result.removed > 0
        ? `Removed ${result.removed} invalid outbox entr${result.removed === 1 ? "y" : "ies"}.\n${result.removedJobIds.map((jobId) => `- ${jobId}`).join("\n")}`
        : "No invalid outbox entries found.";
      await sendTextMessage(cfg, accountId, msg.conversationId, recipientId, replyText, log);
      return;
    }

    const status = await getOutboxStatus();
    const replyText = formatOutboxStatus(status);
    const recipientId = isDirect ? msg.userId : undefined;
    await sendTextMessage(cfg, accountId, msg.conversationId, recipientId, replyText, log);
    return;
  }

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

  log.info(`[mixin] route result: ${route ? "FOUND" : "NULL"} - agentId=${route?.agentId ?? "N/A"}`);

  if (!route) {
    log.warn(`[mixin] no agent route for ${msg.userId} (peerId: ${peerId})`);
    return;
  }

  const shouldComputeCommandAuthorized = rt.channel.commands.shouldComputeCommandAuthorized(text, cfg);
  const useAccessGroups = cfg.commands?.useAccessGroups !== false;
  const senderAllowedForCommands = useAccessGroups ? effectiveAllowFrom.has(normalizedUserId) : true;

  const commandAuthorized = shouldComputeCommandAuthorized
    ? rt.channel.commands.resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups,
        authorizers: [
          {
            configured: effectiveAllowFrom.size > 0,
            allowed: senderAllowedForCommands,
          },
        ],
      })
    : undefined;

  const ctx = rt.channel.reply.finalizeInboundContext({
    Body: text,
    RawBody: text,
    CommandBody: text,
    From: isDirect ? msg.userId : msg.conversationId,
    SessionKey: route.sessionKey,
    AccountId: accountId,
    ChatType: isDirect ? "direct" : "group",
    Provider: "mixin",
    Surface: "mixin",
    MessageSid: msg.messageId,
    CommandAuthorized: commandAuthorized,
  });

  const storePath = rt.channel.session.resolveStorePath(cfg.session?.store, {
    agentId: route.agentId,
  });
  await rt.channel.session.recordInboundSession({
    storePath,
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
        if (!replyText) {
          return;
        }
        const recipientId = isDirect ? msg.userId : undefined;
        await deliverMixinReply({
          cfg,
          accountId,
          conversationId: msg.conversationId,
          recipientId,
          text: replyText,
          log,
        });
      },
    },
  });
}
