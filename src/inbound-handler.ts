import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { buildAgentMediaPayload, evaluateSenderGroupAccess, resolveDefaultGroupPolicy } from "openclaw/plugin-sdk";
import type { AgentMediaPayload, OpenClawConfig } from "openclaw/plugin-sdk";
import { getAccountConfig, resolveConversationPolicy } from "./config.js";
import type { MixinAccountConfig } from "./config-schema.js";
import { decryptMixinMessage } from "./crypto.js";
import { getMixpayOrderStatusText, getRecentMixpayOrdersText, refreshMixpayOrderStatus } from "./mixpay-worker.js";
import { buildMixinOutboundPlanFromReplyText, executeMixinOutboundPlan } from "./outbound-plan.js";
import { getMixinRuntime } from "./runtime.js";
import {
  getOutboxStatus,
  purgePermanentInvalidOutboxEntries,
  sendTextMessage,
} from "./send-service.js";
import { buildClient } from "./shared.js";
import { rememberMixinMessage, resolveMixinReplyContext } from "./message-context.js";

export interface MixinInboundMessage {
  conversationId: string;
  userId: string;
  messageId: string;
  category: string;
  data: string;
  createdAt: string;
  quoteMessageId?: string;
  publicKey?: string;
}

const processedMessages = new Set<string>();
const MAX_DEDUP_SIZE = 2000;
const unauthNotifiedUsers = new Map<string, number>();
const unauthNotifiedGroups = new Map<string, number>();
const loggedAllowFromAccounts = new Set<string>();
const UNAUTH_NOTIFY_INTERVAL = 20 * 60 * 1000;
const MAX_UNAUTH_NOTIFY_USERS = 1000;
const MAX_UNAUTH_NOTIFY_GROUPS = 1000;
const INBOUND_MEDIA_MAX_BYTES = 30 * 1024 * 1024;
const USER_PROFILE_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_USER_PROFILE_CACHE = 2000;
const GROUP_PROFILE_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_GROUP_PROFILE_CACHE = 1000;
const BOT_PROFILE_CACHE_TTL_MS = 10 * 60 * 1000;
const SESSION_LABEL_MAX_LENGTH = 64;
const requireFromHere = createRequire(import.meta.url);

type CachedUserProfile = {
  fullName: string;
  expiresAt: number;
};

type CachedGroupProfile = {
  name: string;
  expiresAt: number;
};

type CachedBotProfile = {
  name: string;
  expiresAt: number;
};

type CachedBotIdentity = {
  name: string;
  userId: string;
  identityNumber: string;
  expiresAt: number;
};

type MixinAttachmentRequest = {
  attachmentId: string;
  mimeType?: string;
  size?: number;
  fileName?: string;
  duration?: number;
};

const cachedUserProfiles = new Map<string, CachedUserProfile>();
const cachedGroupProfiles = new Map<string, CachedGroupProfile>();
const cachedBotProfiles = new Map<string, CachedBotProfile>();
const cachedBotIdentities = new Map<string, CachedBotIdentity>();
let cachedUpdateSessionStore:
  | ((storePath: string, mutator: (store: Record<string, Record<string, unknown>>) => void | Promise<void>) => Promise<unknown>)
  | null
  | undefined;

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

function pruneUnauthNotifiedGroups(now: number): void {
  for (const [conversationId, lastNotified] of unauthNotifiedGroups) {
    if (now - lastNotified > UNAUTH_NOTIFY_INTERVAL) {
      unauthNotifiedGroups.delete(conversationId);
    }
  }

  while (unauthNotifiedGroups.size >= MAX_UNAUTH_NOTIFY_GROUPS) {
    const first = unauthNotifiedGroups.keys().next().value;
    if (!first) {
      break;
    }
    unauthNotifiedGroups.delete(first);
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildUserProfileCacheKey(accountId: string, userId: string): string {
  return `${accountId}:${userId.trim().toLowerCase()}`;
}

function buildGroupProfileCacheKey(accountId: string, conversationId: string): string {
  return `${accountId}:${conversationId.trim().toLowerCase()}`;
}

function buildBotProfileCacheKey(accountId: string): string {
  return accountId.trim().toLowerCase();
}

function pruneUserProfileCache(now: number): void {
  for (const [key, cached] of cachedUserProfiles) {
    if (cached.expiresAt <= now) {
      cachedUserProfiles.delete(key);
    }
  }

  while (cachedUserProfiles.size >= MAX_USER_PROFILE_CACHE) {
    const first = cachedUserProfiles.keys().next().value;
    if (!first) {
      break;
    }
    cachedUserProfiles.delete(first);
  }
}

function pruneGroupProfileCache(now: number): void {
  for (const [key, cached] of cachedGroupProfiles) {
    if (cached.expiresAt <= now) {
      cachedGroupProfiles.delete(key);
    }
  }

  while (cachedGroupProfiles.size >= MAX_GROUP_PROFILE_CACHE) {
    const first = cachedGroupProfiles.keys().next().value;
    if (!first) {
      break;
    }
    cachedGroupProfiles.delete(first);
  }
}

function pruneBotProfileCache(now: number): void {
  for (const [key, cached] of cachedBotProfiles) {
    if (cached.expiresAt <= now) {
      cachedBotProfiles.delete(key);
    }
  }
}

function normalizePresentationName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sliceUtf16Safe(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  let sliced = value.slice(0, maxLength);
  const lastCodeUnit = sliced.charCodeAt(sliced.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    sliced = sliced.slice(0, -1);
  }
  return sliced;
}

function clampSessionLabel(label: string): string {
  const trimmed = normalizePresentationName(label);
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= SESSION_LABEL_MAX_LENGTH) {
    return trimmed;
  }
  return sliceUtf16Safe(trimmed, SESSION_LABEL_MAX_LENGTH);
}

async function loadUpdateSessionStore(log: {
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string, e?: unknown) => void;
}): Promise<
  ((storePath: string, mutator: (store: Record<string, Record<string, unknown>>) => void | Promise<void>) => Promise<unknown>) | null
> {
  if (cachedUpdateSessionStore !== undefined) {
    return cachedUpdateSessionStore;
  }

  try {
    const openclawEntryPath = requireFromHere.resolve("openclaw");
    const openclawEntryDir = path.dirname(openclawEntryPath);
    const distDir = path.basename(openclawEntryDir).toLowerCase() === "dist" ? openclawEntryDir : path.join(openclawEntryDir, "dist");

    const entries = await fs.readdir(distDir, { withFileTypes: true });
    const sessionModules = entries
      .filter((entry) => entry.isFile() && /^sessions-.*\.js$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    if (!sessionModules.length) {
      cachedUpdateSessionStore = null;
      return null;
    }

    for (const sessionModule of sessionModules) {
      try {
        const moduleUrl = pathToFileURL(path.join(distDir, sessionModule)).href;
        const imported = (await import(moduleUrl)) as Record<string, unknown>;
        const candidate = Object.values(imported).find((val) => {
          if (typeof val !== "function" || val.length !== 2) {
            return false;
          }
          return true;
        });
        if (candidate) {
          cachedUpdateSessionStore = candidate as (
            storePath: string,
            mutator: (store: Record<string, Record<string, unknown>>) => void | Promise<void>,
          ) => Promise<unknown>;
          return cachedUpdateSessionStore;
        }
      } catch {
        continue;
      }
    }

    log.warn("[mixin] no matching updateSessionStore export found in session modules");
    cachedUpdateSessionStore = null;
    return null;
  } catch (err) {
    log.warn(
      `[mixin] failed to load OpenClaw session store updater: error=${err instanceof Error ? err.message : String(err)}`,
    );
    cachedUpdateSessionStore = null;
    return null;
  }
}

async function resolveSenderName(params: {
  accountId: string;
  config: MixinAccountConfig;
  userId: string;
  log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string, e?: unknown) => void };
}): Promise<string> {
  const userId = params.userId.trim();
  if (!userId) {
    return "";
  }

  const now = Date.now();
  const cacheKey = buildUserProfileCacheKey(params.accountId, userId);
  const cached = cachedUserProfiles.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.fullName;
  }

  pruneUserProfileCache(now);

  try {
    const client = buildClient(params.config);
    const user = await client.user.fetch(userId);
    const fullName = typeof user.full_name === "string" && user.full_name.trim() ? user.full_name.trim() : userId;
    cachedUserProfiles.set(cacheKey, {
      fullName,
      expiresAt: now + USER_PROFILE_CACHE_TTL_MS,
    });
    return fullName;
  } catch (err) {
    params.log.warn(
      `[mixin] failed to resolve sender profile: accountId=${params.accountId}, userId=${userId}, error=${err instanceof Error ? err.message : String(err)}`,
    );
    return userId;
  }
}

async function resolveGroupName(params: {
  accountId: string;
  config: MixinAccountConfig;
  conversationId: string;
  log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string, e?: unknown) => void };
}): Promise<string> {
  const conversationId = params.conversationId.trim();
  if (!conversationId) {
    return "";
  }

  const now = Date.now();
  const cacheKey = buildGroupProfileCacheKey(params.accountId, conversationId);
  const cached = cachedGroupProfiles.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.name;
  }

  pruneGroupProfileCache(now);

  try {
    const client = buildClient(params.config);
    const conversation = await client.conversation.fetch(conversationId);
    const name = normalizePresentationName(String(conversation.name ?? "")) || conversationId;
    cachedGroupProfiles.set(cacheKey, {
      name,
      expiresAt: now + GROUP_PROFILE_CACHE_TTL_MS,
    });
    return name;
  } catch (err) {
    params.log.warn(
      `[mixin] failed to resolve group profile: accountId=${params.accountId}, conversationId=${conversationId}, error=${err instanceof Error ? err.message : String(err)}`,
    );
    return conversationId;
  }
}

async function resolveBotIdentity(params: {
  accountId: string;
  config: MixinAccountConfig;
  log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string, e?: unknown) => void };
}): Promise<CachedBotIdentity> {
  const cacheKey = buildBotProfileCacheKey(params.accountId);
  const cached = cachedBotIdentities.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const now = Date.now();
  const configuredName = normalizePresentationName(params.config.name ?? "");
  const configuredIdentity: CachedBotIdentity = {
    name: configuredName || params.accountId,
    userId: params.config.appId?.trim() || params.accountId,
    identityNumber: "",
    expiresAt: now + BOT_PROFILE_CACHE_TTL_MS,
  };
  if (configuredName) {
    cachedBotIdentities.set(cacheKey, configuredIdentity);
    return configuredIdentity;
  }

  pruneBotProfileCache(now);

  try {
    const client = buildClient(params.config);
    const profile = await client.user.profile();
    const identity: CachedBotIdentity = {
      name: normalizePresentationName(String(profile.full_name ?? "")) || params.accountId,
      userId: normalizePresentationName(String(profile.user_id ?? "")) || params.config.appId?.trim() || params.accountId,
      identityNumber: normalizePresentationName(String(profile.identity_number ?? "")),
      expiresAt: now + BOT_PROFILE_CACHE_TTL_MS,
    };
    cachedBotIdentities.set(cacheKey, identity);
    return identity;
  } catch (err) {
    params.log.warn(
      `[mixin] failed to resolve bot profile: accountId=${params.accountId}, error=${err instanceof Error ? err.message : String(err)}`,
    );
    cachedBotIdentities.set(cacheKey, configuredIdentity);
    return configuredIdentity;
  }
}

async function updateSessionPresentation(params: {
  storePath: string;
  sessionKey: string;
  label: string;
  displayName?: string;
  log: { info: (m: string) => void; warn: (m: string) => void; error: (m: string, e?: unknown) => void };
}): Promise<void> {
  const nextLabel = clampSessionLabel(params.label);
  const nextDisplayName = clampSessionLabel(params.displayName ?? "");
  if (!nextLabel && !nextDisplayName) {
    return;
  }

  try {
    const updateSessionStore = await loadUpdateSessionStore(params.log);
    if (!updateSessionStore) {
      return;
    }
    await updateSessionStore(params.storePath, (store: Record<string, Record<string, unknown>>) => {
      const entry = store[params.sessionKey];
      if (!entry || typeof entry !== "object") {
        return;
      }

      let changed = false;
      if (nextLabel && entry.label !== nextLabel) {
        entry.label = nextLabel;
        changed = true;
      }
      if (nextDisplayName && entry.displayName !== nextDisplayName) {
        entry.displayName = nextDisplayName;
        changed = true;
      }
      if (changed) {
        entry.updatedAt = new Date().toISOString();
      }
    });
  } catch (err) {
    params.log.warn(
      `[mixin] failed to update session presentation: sessionKey=${params.sessionKey}, error=${err instanceof Error ? err.message : String(err)}`,
    );
  }
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

function buildQuotedMessageContextNote(params: {
  quoteMessageId: string;
  found: boolean;
}): string[] {
  if (params.found) {
    return [];
  }

  return [
    `Quoted message id: ${params.quoteMessageId}`,
    "Quoted message body was not available in cache.",
  ];
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

function hasBotMention(text: string, botName?: string): boolean {
  const normalizedBotName = normalizePresentationName(botName ?? "").replace(/^@+/, "");
  if (!normalizedBotName) {
    return false;
  }

  const mentionPattern = new RegExp(`@\\s*${escapeRegExp(normalizedBotName)}(?=$|[\\s:：,，.!?。；;、])`, "i");
  return mentionPattern.test(text);
}

function shouldPassGroupFilter(
  config: MixinAccountConfig,
  text: string,
  replyContext?: { id: string } | null,
  botAliases: string[] = [],
): boolean {
  if (!config.requireMentionInGroup) {
    return true;
  }
  if (replyContext?.id) {
    return true;
  }
  if (botAliases.some((alias) => hasBotMention(text, alias))) {
    return true;
  }
  if (text.trim().startsWith("/")) {
    return true;
  }
  const lower = text.toLowerCase();
  return lower.includes("?") || /帮我|请|分析|总结|help/i.test(lower);
}

function isOutboxCommand(text: string): boolean {
  return /(^|\s)\/mixin-outbox(?:\s|$)/i.test(text.trim());
}

function isOutboxPurgeInvalidCommand(text: string): boolean {
  return /(^|\s)\/mixin-outbox\s+purge-invalid(?:\s|$)/i.test(normalizeCommandText(text));
}

function isMixinGroupAuthCommand(text: string): boolean {
  return /(^|\s)\/mixin-group-auth(?:\s|$)/i.test(normalizeCommandText(text));
}

function isMixinGroupApproveCommand(text: string): boolean {
  return /(^|\s)\/mixin-group-approve\s+\S+(?:\s|$)/i.test(normalizeCommandText(text));
}

function parseMixinGroupApproveCode(text: string): string | null {
  const match = normalizeCommandText(text).match(/(?:^|\s)\/mixin-group-approve\s+(\S+)(?:\s|$)/i);
  return match?.[1]?.trim() || null;
}

function isCollectStatusCommand(text: string): boolean {
  return /(^|\s)\/collect\s+status\s+\S+(?:\s|$)/i.test(normalizeCommandText(text));
}

function isCollectRecentCommand(text: string): boolean {
  return /(^|\s)\/collect\s+recent(?:\s+\d+)?(?:\s|$)/i.test(normalizeCommandText(text));
}

function parseCollectStatusCommand(text: string): string | null {
  const match = normalizeCommandText(text).match(/(?:^|\s)\/collect\s+status\s+(\S+)(?:\s|$)/i);
  return match?.[1]?.trim() || null;
}

function parseCollectRecentLimit(text: string): number {
  const match = normalizeCommandText(text).match(/(?:^|\s)\/collect\s+recent(?:\s+(\d+))?(?:\s|$)/i);
  const parsed = Number.parseInt(match?.[1] ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 5;
  }
  return Math.min(parsed, 20);
}

function normalizeCommandText(text: string): string {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

function formatMixinGroupAuthReply(params: {
  code: string;
  created: boolean;
  conversationId: string;
  accountId: string;
}): string {
  const lines = [
    params.created ? "Group auth request created." : "Group auth request already exists.",
    `Code: ${params.code}`,
    `conversationId: ${params.conversationId}`,
    "",
    "Approve it in the OpenClaw terminal with:",
    params.accountId === "default"
      ? `openclaw pairing approve mixin ${params.code}`
      : `openclaw pairing approve --account ${params.accountId} mixin ${params.code}`,
  ];
  return lines.join("\n");
}

function buildGroupScopedPairingId(params: {
  conversationId: string;
}): string {
  return `group:${params.conversationId.trim().toLowerCase()}`;
}

function buildGroupScopedPairingMeta(params: {
  conversationId: string;
  userId: string;
}): Record<string, string> {
  return {
    kind: "group-auth",
    conversationId: params.conversationId.trim(),
    requestedBy: params.userId.trim(),
  };
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
    const reply = `OpenClaw: access not configured.\n\nYour Mixin UUID: ${msg.userId}\n\nAsk the bot owner to add your Mixin UUID to channels.mixin.allowFrom.`;
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
    log.info(
      `[mixin] skip non-text message: messageId=${msg.messageId}, category=${msg.category}, quoteMessageId=${msg.quoteMessageId ?? "none"}`,
    );
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

  const botIdentity = await resolveBotIdentity({
    accountId,
    config,
    log,
  });
  const replyContext = resolveMixinReplyContext({
    accountId,
    conversationId: msg.conversationId,
    quoteMessageId: msg.quoteMessageId,
  });
  rememberMixinMessage({
    accountId,
    conversationId: msg.conversationId,
    messageId: msg.messageId,
    senderId: msg.userId,
    body: text,
    timestamp: msg.createdAt,
    direction: "inbound",
    quoteMessageId: msg.quoteMessageId,
  });
  if (replyContext?.found) {
    log.info(
      `[mixin] reply context resolved: messageId=${msg.messageId}, quoteMessageId=${replyContext.id}, sender=${replyContext.sender ?? "unknown"}`,
    );
  } else if (replyContext?.id) {
    log.info(
      `[mixin] reply context missing from cache: messageId=${msg.messageId}, quoteMessageId=${replyContext.id}`,
    );
  }

  const conversationPolicy = isDirect
    ? null
    : resolveConversationPolicy(cfg, accountId, msg.conversationId);

  const botAliases = [
    botIdentity.identityNumber,
    botIdentity.userId,
  ].filter((value): value is string => Boolean(value && value.trim()));
  const groupMentioned = !isDirect && botAliases.some((alias) => hasBotMention(text, alias));
  if (!isDirect) {
    log.info(
      `[mixin] group trigger check: messageId=${msg.messageId}, botName=${botIdentity.name}, botUserId=${botIdentity.userId}, botIdentityNumber=${botIdentity.identityNumber || "none"}, replyContext=${replyContext?.id ?? "none"}, mentioned=${groupMentioned}`,
    );
  }

  if (
    !isDirect &&
    conversationPolicy &&
    !(isAttachmentMessage && conversationPolicy.mediaBypassMention) &&
    !shouldPassGroupFilter(
      {
        ...config,
        requireMentionInGroup: conversationPolicy.requireMention,
      },
      text,
      replyContext,
      botAliases,
    )
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
  const groupPairingAuthorized = isDirect
    ? false
    : effectiveAllowFrom.has(normalizeAllowEntry(buildGroupScopedPairingId({
      conversationId: msg.conversationId,
    })));
  const isAuthorized = isDirect
    ? dmPolicy === "open" || effectiveAllowFrom.has(normalizedUserId)
    : groupAccess?.allowed === true || groupPairingAuthorized;

  if (!isAuthorized) {
    if (!isDirect && isMixinGroupAuthCommand(text)) {
      const now = Date.now();
      const lastNotified = unauthNotifiedGroups.get(msg.conversationId) ?? 0;
      const shouldNotify = lastNotified === 0 || now - lastNotified > UNAUTH_NOTIFY_INTERVAL;
      if (!shouldNotify) {
        markProcessed(msg.messageId);
        return;
      }
      pruneUnauthNotifiedGroups(now);
      unauthNotifiedGroups.set(msg.conversationId, now);
      const { code, created } = await rt.channel.pairing.upsertPairingRequest({
        channel: "mixin",
        id: buildGroupScopedPairingId({
          conversationId: msg.conversationId,
        }),
        accountId,
        meta: buildGroupScopedPairingMeta({
          conversationId: msg.conversationId,
          userId: msg.userId,
        }),
      });
      markProcessed(msg.messageId);
      await sendTextMessage(
        cfg,
        accountId,
        msg.conversationId,
        undefined,
        formatMixinGroupAuthReply({
          code,
          created,
          accountId,
          conversationId: msg.conversationId,
        }),
        log,
      );
      return;
    }
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

  if (isMixinGroupAuthCommand(text)) {
    const recipientId = isDirect ? msg.userId : undefined;
    if (isDirect) {
      await sendTextMessage(cfg, accountId, msg.conversationId, recipientId, "Use /mixin-group-auth in a group chat.", log);
      return;
    }
    const { code, created } = await rt.channel.pairing.upsertPairingRequest({
      channel: "mixin",
      id: buildGroupScopedPairingId({
        conversationId: msg.conversationId,
      }),
      accountId,
      meta: buildGroupScopedPairingMeta({
        conversationId: msg.conversationId,
        userId: msg.userId,
      }),
    });
    await sendTextMessage(
      cfg,
      accountId,
      msg.conversationId,
      recipientId,
      formatMixinGroupAuthReply({
        code,
        created,
        accountId,
        conversationId: msg.conversationId,
      }),
      log,
    );
    return;
  }

  if (isMixinGroupApproveCommand(text)) {
    const code = parseMixinGroupApproveCode(text);
    const recipientId = isDirect ? msg.userId : undefined;
    if (!code) {
      await sendTextMessage(cfg, accountId, msg.conversationId, recipientId, "Usage: openclaw pairing approve mixin <code>", log);
      return;
    }
    await sendTextMessage(
      cfg,
      accountId,
      msg.conversationId,
      recipientId,
      [
        "Group auth approval must be done in the OpenClaw terminal.",
        "",
        accountId === "default"
          ? `Run: openclaw pairing approve mixin ${code}`
          : `Run: openclaw pairing approve --account ${accountId} mixin ${code}`,
      ].join("\n"),
      log,
    );
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
      : groupAccess?.allowed === true || groupPairingAuthorized
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

  const senderName = await resolveSenderName({
    accountId,
    config,
    userId: msg.userId,
    log,
  });
  const groupName = isDirect
    ? ""
    : await resolveGroupName({
      accountId,
      config,
      conversationId: msg.conversationId,
      log,
    });
  const conversationLabel = isDirect
    ? clampSessionLabel(`${botIdentity.name}-${senderName || msg.userId}`)
    : clampSessionLabel(`${botIdentity.name}-${groupName || msg.conversationId}`);

  const ctx = rt.channel.reply.finalizeInboundContext({
    Body: text,
    RawBody: text,
    CommandBody: text,
    From: isDirect ? msg.userId : msg.conversationId,
    SenderId: msg.userId,
    SenderName: senderName,
    SessionKey: route.sessionKey,
    AccountId: accountId,
    ChatType: isDirect ? "direct" : "group",
    ConversationLabel: conversationLabel,
    GroupSubject: isDirect ? undefined : groupName || msg.conversationId,
    Provider: "mixin",
    Surface: "mixin",
    MessageSid: msg.messageId,
    ReplyToId: replyContext?.id,
    ReplyToBody: replyContext?.body,
    ReplyToSender: replyContext?.sender,
    ReplyToIsQuote: replyContext ? true : undefined,
    UntrustedContext: replyContext?.id ? buildQuotedMessageContextNote({
      quoteMessageId: replyContext.id,
      found: replyContext.found,
    }) : undefined,
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
  await updateSessionPresentation({
    storePath,
    sessionKey: route.sessionKey,
    label: conversationLabel,
    displayName: conversationLabel,
    log,
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
