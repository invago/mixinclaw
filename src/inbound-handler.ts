import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MixinApi } from "@mixin.dev/mixin-node-sdk";
import { buildAgentMediaPayload, evaluateSenderGroupAccess, resolveDefaultGroupPolicy } from "openclaw/plugin-sdk";
import type { AgentMediaPayload, OpenClawConfig } from "openclaw/plugin-sdk";
import { getAccountConfig, resolveConversationPolicy } from "./config.js";
import type { MixinAccountConfig } from "./config-schema.js";
import { decryptMixinMessage } from "./crypto.js";
import { getMixpayOrderStatusText, getRecentMixpayOrdersText, refreshMixpayOrderStatus } from "./mixpay-worker.js";
import { buildRequestConfig } from "./proxy.js";
import { buildMixinOutboundPlanFromReplyText, executeMixinOutboundPlan } from "./outbound-plan.js";
import { getMixinRuntime } from "./runtime.js";
import {
  getOutboxStatus,
  purgePermanentInvalidOutboxEntries,
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
const loggedAllowFromAccounts = new Set<string>();
const UNAUTH_NOTIFY_INTERVAL = 20 * 60 * 1000;
const MAX_UNAUTH_NOTIFY_USERS = 1000;
const INBOUND_MEDIA_MAX_BYTES = 30 * 1024 * 1024;

type MixinAttachmentRequest = {
  attachmentId: string;
  mimeType?: string;
  size?: number;
  fileName?: string;
  duration?: number;
};

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

function buildClient(config: MixinAccountConfig) {
  return MixinApi({
    keystore: {
      app_id: config.appId!,
      session_id: config.sessionId!,
      server_public_key: config.serverPublicKey!,
      session_private_key: config.sessionPrivateKey!,
    },
    requestConfig: buildRequestConfig(config.proxy),
  });
}

function resolveInboundMediaMaxBytes(config: MixinAccountConfig): number {
  const mediaMaxMb = config.mediaMaxMb;
  if (typeof mediaMaxMb === "number" && Number.isFinite(mediaMaxMb) && mediaMaxMb > 0) {
    return Math.max(1, Math.floor(mediaMaxMb * 1024 * 1024));
  }
  return INBOUND_MEDIA_MAX_BYTES;
}

function parseInboundAttachmentRequest(category: string, data: string): MixinAttachmentRequest | null {
  if (category !== "PLAIN_DATA" && category !== "PLAIN_AUDIO") {
    return null;
  }

  try {
    const decoded = Buffer.from(data, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded) as {
      attachment_id?: unknown;
      mime_type?: unknown;
      size?: unknown;
      name?: unknown;
      duration?: unknown;
    };

    if (typeof parsed.attachment_id !== "string" || !parsed.attachment_id.trim()) {
      return null;
    }

    return {
      attachmentId: parsed.attachment_id.trim(),
      mimeType: typeof parsed.mime_type === "string" ? parsed.mime_type.trim() || undefined : undefined,
      size: typeof parsed.size === "number" && Number.isFinite(parsed.size) ? parsed.size : undefined,
      fileName: typeof parsed.name === "string" ? parsed.name.trim() || undefined : undefined,
      duration: typeof parsed.duration === "number" && Number.isFinite(parsed.duration) ? parsed.duration : undefined,
    };
  } catch {
    return null;
  }
}

function formatInboundAttachmentText(category: string, payload: MixinAttachmentRequest): string {
  if (category === "PLAIN_AUDIO") {
    const details = [
      payload.fileName,
      payload.mimeType,
      typeof payload.duration === "number" ? `${payload.duration}s` : undefined,
      typeof payload.size === "number" ? `${payload.size} bytes` : undefined,
    ].filter(Boolean);
    return details.length > 0 ? `[Mixin audio] ${details.join(" | ")}` : "[Mixin audio]";
  }

  const details = [
    payload.fileName,
    payload.mimeType,
    typeof payload.size === "number" ? `${payload.size} bytes` : undefined,
  ].filter(Boolean);
  return details.length > 0 ? `[Mixin file] ${details.join(" | ")}` : "[Mixin file]";
}

async function resolveInboundAttachment(params: {
  rt: ReturnType<typeof getMixinRuntime>;
  config: MixinAccountConfig;
  msg: MixinInboundMessage;
  log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string, e?: unknown) => void };
}): Promise<{ text: string; mediaPayload?: AgentMediaPayload }> {
  const payload = parseInboundAttachmentRequest(params.msg.category, params.msg.data);
  if (!payload) {
    return {
      text: `[${params.msg.category}]`,
    };
  }

  try {
    const client = buildClient(params.config);
    const maxBytes = resolveInboundMediaMaxBytes(params.config);
    const attachment = await client.attachment.fetch(payload.attachmentId);
    const fetched = await params.rt.channel.media.fetchRemoteMedia({
      url: attachment.view_url,
      filePathHint: payload.fileName,
      maxBytes,
    });
    const saved = await params.rt.channel.media.saveMediaBuffer(
      fetched.buffer,
      payload.mimeType ?? fetched.contentType,
      "mixin",
      maxBytes,
      payload.fileName ?? fetched.fileName,
    );

    return {
      text: formatInboundAttachmentText(params.msg.category, payload),
      mediaPayload: buildAgentMediaPayload([
        {
          path: saved.path,
          contentType: saved.contentType ?? payload.mimeType ?? fetched.contentType,
        },
      ]),
    };
  } catch (err) {
    params.log.warn(
      `[mixin] failed to resolve inbound attachment: messageId=${params.msg.messageId}, category=${params.msg.category}, error=${err instanceof Error ? err.message : String(err)}`,
    );
    return {
      text: formatInboundAttachmentText(params.msg.category, payload),
    };
  }
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

function isCollectStatusCommand(text: string): boolean {
  return /^\/collect\s+status\s+\S+/i.test(text.trim());
}

function isCollectRecentCommand(text: string): boolean {
  return /^\/collect\s+recent(?:\s+\d+)?$/i.test(text.trim());
}

function parseCollectStatusCommand(text: string): string | null {
  const match = text.trim().match(/^\/collect\s+status\s+(\S+)$/i);
  return match?.[1]?.trim() || null;
}

function parseCollectRecentLimit(text: string): number {
  const match = text.trim().match(/^\/collect\s+recent(?:\s+(\d+))?$/i);
  const parsed = Number.parseInt(match?.[1] ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 5;
  }
  return Math.min(parsed, 20);
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

function normalizeAllowEntries(entries: string[] | undefined): string[] {
  return (entries ?? []).map(normalizeAllowEntry).filter(Boolean);
}

function resolveMixinAllowFromPaths(
  rt: ReturnType<typeof getMixinRuntime>,
  accountId: string,
): string[] {
  const oauthOverride = process.env.OPENCLAW_OAUTH_DIR?.trim();
  const oauthDir = oauthOverride
    ? path.resolve(oauthOverride)
    : path.join(rt.state.resolveStateDir(process.env, os.homedir), "credentials");
  const normalizedAccountId = accountId.trim().toLowerCase();
  const paths = [path.join(oauthDir, "mixin-allowFrom.json")];
  if (normalizedAccountId) {
    paths.unshift(path.join(oauthDir, `mixin-${normalizedAccountId}-allowFrom.json`));
  }
  return Array.from(new Set(paths));
}

async function readAllowFromFile(filePath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { allowFrom?: unknown };
    return Array.isArray(parsed.allowFrom)
      ? parsed.allowFrom.map((entry) => String(entry)).map(normalizeAllowEntry).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

async function readEffectiveAllowFrom(
  rt: ReturnType<typeof getMixinRuntime>,
  accountId: string,
  configAllowFrom: string[],
  log?: { info: (m: string) => void },
): Promise<Set<string>> {
  const runtimeAllowFrom = await rt.channel.pairing.readAllowFromStore("mixin", undefined, accountId).catch(() => []);
  const filePaths = resolveMixinAllowFromPaths(rt, accountId);
  if (!loggedAllowFromAccounts.has(accountId)) {
    log?.info(`[mixin] allow-from paths: accountId=${accountId}, paths=${filePaths.join(", ")}`);
    loggedAllowFromAccounts.add(accountId);
  }
  const fileEntries = await Promise.all(filePaths.map((filePath) => readAllowFromFile(filePath)));
  const fileAllowFrom = fileEntries.flat();
  return new Set([...configAllowFrom, ...runtimeAllowFrom, ...fileAllowFrom].map(normalizeAllowEntry).filter(Boolean));
}

async function deliverMixinReply(params: {
  cfg: OpenClawConfig;
  accountId: string;
  conversationId: string;
  recipientId?: string;
  creatorId?: string;
  text: string;
  log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string, e?: unknown) => void };
}): Promise<void> {
  const { cfg, accountId, conversationId, recipientId, creatorId, text, log } = params;
  const plan = buildMixinOutboundPlanFromReplyText(text);
  if (plan.steps.length === 0) {
    return;
  }
  for (const warning of plan.warnings) {
    log.warn(`[mixin] outbound plan warning: ${warning}`);
  }
  await executeMixinOutboundPlan({
    cfg,
    accountId,
    conversationId,
    recipientId,
    creatorId,
    steps: plan.steps,
    log,
  });
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
        accountId,
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

function evaluateMixinGroupAccess(params: {
  cfg: OpenClawConfig;
  config: MixinAccountConfig;
  accountId: string;
  conversationId: string;
  senderId: string;
}): {
  allowed: boolean;
  reason: string;
  groupPolicy: "open" | "disabled" | "allowlist";
  groupAllowFrom: string[];
} {
  const conversationPolicy = resolveConversationPolicy(params.cfg, params.accountId, params.conversationId);
  if (!conversationPolicy.enabled) {
    return {
      allowed: false,
      reason: "conversation disabled",
      groupPolicy: "disabled",
      groupAllowFrom: normalizeAllowEntries(conversationPolicy.groupAllowFrom),
    };
  }

  const normalizedGroupAllowFrom = normalizeAllowEntries(conversationPolicy.groupAllowFrom);
  const decision = evaluateSenderGroupAccess({
    providerConfigPresent: true,
    configuredGroupPolicy: conversationPolicy.groupPolicy,
    defaultGroupPolicy: resolveDefaultGroupPolicy(params.cfg),
    groupAllowFrom: normalizedGroupAllowFrom,
    senderId: normalizeAllowEntry(params.senderId),
    isSenderAllowed: (senderId, allowFrom) => allowFrom.includes(normalizeAllowEntry(senderId)),
  });

  return {
    allowed: decision.allowed,
    reason: decision.reason,
    groupPolicy: decision.groupPolicy,
    groupAllowFrom: normalizedGroupAllowFrom,
  };
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

  const isTextMessage = msg.category.startsWith("PLAIN_TEXT") || msg.category.startsWith("PLAIN_POST");
  const isAttachmentMessage = msg.category === "PLAIN_DATA" || msg.category === "PLAIN_AUDIO";

  if (!isTextMessage && !isAttachmentMessage) {
    log.info(`[mixin] skip non-text message: ${msg.category}`);
    return;
  }

  let text = decodeContent(msg.category, msg.data).trim();
  let mediaPayload: AgentMediaPayload | undefined;
  if (isAttachmentMessage) {
    const resolved = await resolveInboundAttachment({ rt, config, msg, log });
    text = resolved.text.trim();
    mediaPayload = resolved.mediaPayload;
  }
  log.info(`[mixin] decoded text: messageId=${msg.messageId}, category=${msg.category}, length=${text.length}`);

  if (!text) {
    return;
  }

  const conversationPolicy = isDirect
    ? null
    : resolveConversationPolicy(cfg, accountId, msg.conversationId);

  if (
    !isDirect &&
    conversationPolicy &&
    !(isAttachmentMessage && conversationPolicy.mediaBypassMention) &&
    !shouldPassGroupFilter({
      ...config,
      requireMentionInGroup: conversationPolicy.requireMention,
    }, text)
  ) {
    log.info(`[mixin] group message filtered: ${msg.messageId}`);
    return;
  }

  const effectiveAllowFrom = await readEffectiveAllowFrom(rt, accountId, config.allowFrom, log);
  const normalizedUserId = normalizeAllowEntry(msg.userId);
  const dmPolicy = config.dmPolicy ?? "pairing";
  const groupAccess = isDirect
    ? null
    : evaluateMixinGroupAccess({
      cfg,
      config,
      accountId,
      conversationId: msg.conversationId,
      senderId: msg.userId,
    });
  const isAuthorized = isDirect
    ? dmPolicy === "open" || effectiveAllowFrom.has(normalizedUserId)
    : groupAccess?.allowed === true;

  if (!isAuthorized) {
    if (isDirect) {
      log.warn(`[mixin] user ${msg.userId} not authorized (dmPolicy=${dmPolicy})`);
    } else {
      log.warn(
        `[mixin] group sender ${msg.userId} blocked: conversationId=${msg.conversationId}, groupPolicy=${groupAccess?.groupPolicy ?? "unknown"}, reason=${groupAccess?.reason ?? "unknown"}`,
      );
    }
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

  if (isCollectStatusCommand(text)) {
    const orderId = parseCollectStatusCommand(text);
    if (orderId) {
      await refreshMixpayOrderStatus({ cfg, accountId, orderId });
    }
    const replyText = orderId ? await getMixpayOrderStatusText(orderId) : "Usage: /collect status <orderId>";
    const recipientId = isDirect ? msg.userId : undefined;
    await sendTextMessage(cfg, accountId, msg.conversationId, recipientId, replyText, log);
    return;
  }

  if (isCollectRecentCommand(text)) {
    const recipientId = isDirect ? msg.userId : undefined;
    const replyText = await getRecentMixpayOrdersText({
      accountId,
      conversationId: msg.conversationId,
      limit: parseCollectRecentLimit(text),
    });
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
  const senderAllowedForCommands = useAccessGroups
    ? isDirect
      ? effectiveAllowFrom.has(normalizedUserId)
      : groupAccess?.allowed === true
    : true;

  const commandAuthorized = shouldComputeCommandAuthorized
    ? rt.channel.commands.resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups,
        authorizers: [
          {
            configured: isDirect ? effectiveAllowFrom.size > 0 : (groupAccess?.groupAllowFrom.length ?? 0) > 0,
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
    OriginatingChannel: "mixin",
    OriginatingTo: isDirect ? msg.userId : msg.conversationId,
    ...mediaPayload,
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
          creatorId: msg.userId,
          text: replyText,
          log,
        });
      },
    },
  });
}
