import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { uniqueConversationID } from "@mixin.dev/mixin-node-sdk";
import {
  buildChannelConfigSchema,
} from "openclaw/plugin-sdk";
import type { ChannelGatewayContext, OpenClawConfig, ReplyPayload } from "openclaw/plugin-sdk";
import { runBlazeLoop } from "./blaze-service.js";
import { buildClient, sleep } from "./shared.js";
import { MixinConfigSchema } from "./config-schema.js";
import { describeAccount, isConfigured, listAccountIds, resolveAccount, resolveDefaultAccountId, resolveMediaMaxMb } from "./config.js";
import type { MixinAccountConfig } from "./config-schema.js";
import { handleMixinMessage, type MixinInboundMessage } from "./inbound-handler.js";
import { getMixpayStatusSnapshot, startMixpayWorker } from "./mixpay-worker.js";
import { mixinOnboardingAdapter } from "./onboarding.js";
import { buildMixinOutboundPlanFromReplyPayload, executeMixinOutboundPlan } from "./outbound-plan.js";
import { getMixinRuntime, setMixinBlazeSender } from "./runtime.js";
import { getOutboxStatus, sendAudioMessage, sendFileMessage, sendTextMessage, startSendWorker } from "./send-service.js";
import { buildMixinAccountSnapshot, buildMixinChannelSummary, resolveMixinStatusSnapshot } from "./status.js";

type ResolvedMixinAccount = ReturnType<typeof resolveAccount>;

const BASE_DELAY = 1000;
const MAX_DELAY = 3000;
const MULTIPLIER = 1.5;
const MEDIA_MAX_BYTES = 30 * 1024 * 1024;
const MB = 1024 * 1024;
const execFileAsync = promisify(execFile);
const CONVERSATION_CATEGORY_CACHE_TTL_MS = 5 * 60 * 1000;

function createDefaultMixinRuntimeState(accountId: string): {
  accountId: string;
  running: boolean;
  lastStartAt: number | null;
  lastStopAt: number | null;
  lastError: string | null;
} {
  return {
    accountId,
    running: false,
    lastStartAt: null,
    lastStopAt: null,
    lastError: null,
  };
}

function formatMixinPairingApproveHint(channelId: string): string {
  return `Approve via: \`openclaw pairing list ${channelId}\` / \`openclaw pairing approve ${channelId} <code>\``;
}

const conversationCategoryCache = new Map<string, {
  category: "CONTACT" | "GROUP";
  expiresAt: number;
}>();

function maskKey(key: string): string {
  if (!key || key.length < 8) {
    return "****";
  }
  return key.slice(0, 4) + "****" + key.slice(-4);
}

function extractQuoteMessageId(rawMsg: unknown): string | undefined {
  const seen = new Set<unknown>();
  const stack: unknown[] = [rawMsg];

  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== "object" || seen.has(value)) {
      continue;
    }
    seen.add(value);

    const record = value as Record<string, unknown>;
    const quoteMessageId = record.quote_message_id;
    if (typeof quoteMessageId === "string" && quoteMessageId.trim()) {
      return quoteMessageId.trim();
    }
    const camelQuoteMessageId = record.quoteMessageId;
    if (typeof camelQuoteMessageId === "string" && camelQuoteMessageId.trim()) {
      return camelQuoteMessageId.trim();
    }

    for (const nested of Object.values(record)) {
      if (nested && typeof nested === "object") {
        stack.push(nested);
      }
    }
  }

  return undefined;
}

async function resolveIsDirectMessage(params: {
  config: MixinAccountConfig;
  conversationId?: string;
  userId?: string;
  log: {
    info: (m: string) => void;
    warn: (m: string) => void;
  };
}): Promise<boolean> {
  const conversationId = params.conversationId?.trim();
  if (!conversationId) {
    return true;
  }

  const cached = conversationCategoryCache.get(conversationId);
  if (cached && cached.expiresAt > Date.now()) {
    params.log.info(`[mixin] conversation category resolved from cache: conversationId=${conversationId}, category=${cached.category}`);
    return cached.category !== "GROUP";
  }

  const now = Date.now();
  for (const [key, entry] of conversationCategoryCache) {
    if (entry.expiresAt <= now) {
      conversationCategoryCache.delete(key);
    }
  }

  try {
    const client = buildClient(params.config);
    const conversation = await client.conversation.fetch(conversationId);
    const category = conversation.category === "GROUP" ? "GROUP" : "CONTACT";
    conversationCategoryCache.set(conversationId, {
      category,
      expiresAt: Date.now() + CONVERSATION_CATEGORY_CACHE_TTL_MS,
    });
    params.log.info(`[mixin] conversation category resolved: conversationId=${conversationId}, category=${category}`);
    return category !== "GROUP";
  } catch (err) {
    const userId = params.userId?.trim();
    if (userId && params.config.appId) {
      const directConversationId = uniqueConversationID(params.config.appId, userId);
      if (directConversationId === conversationId) {
        params.log.info(
          `[mixin] conversation category inferred locally: conversationId=${conversationId}, category=CONTACT`,
        );
        conversationCategoryCache.set(conversationId, {
          category: "CONTACT",
          expiresAt: Date.now() + CONVERSATION_CATEGORY_CACHE_TTL_MS,
        });
        return true;
      }
    }
    params.log.warn(
      `[mixin] failed to resolve conversation category: conversationId=${conversationId}, error=${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

async function resolveAudioDurationSeconds(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { timeout: 15_000, windowsHide: true },
    );
    const seconds = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return null;
    }
    return Math.max(1, Math.ceil(seconds));
  } catch {
    return null;
  }
}

function resolveMixinMediaMaxBytes(cfg: OpenClawConfig, accountId?: string | null): number {
  const channelLimitMb = resolveMediaMaxMb(cfg, accountId ?? undefined);
  if (channelLimitMb) {
    return channelLimitMb * MB;
  }
  if (cfg.agents?.defaults?.mediaMaxMb) {
    return cfg.agents.defaults.mediaMaxMb * MB;
  }
  return MEDIA_MAX_BYTES;
}

async function deliverOutboundMixinPayload(params: {
  cfg: OpenClawConfig;
  to: string;
  text?: string;
  mediaUrls?: string[];
  mediaLocalRoots?: readonly string[];
  accountId?: string | null;
}): Promise<{ channel: "mixin"; messageId: string }> {
  const accountId = params.accountId ?? resolveDefaultAccountId(params.cfg);
  const account = resolveAccount(params.cfg, accountId);
  const mediaMaxBytes = resolveMixinMediaMaxBytes(params.cfg, accountId);
  const runtime = getMixinRuntime();

  const sendMediaUrl = async (mediaUrl: string): Promise<string | undefined> => {
    const loaded = await runtime.media.loadWebMedia(mediaUrl, {
      maxBytes: mediaMaxBytes,
      localRoots: params.mediaLocalRoots,
    });
    const saved = await runtime.channel.media.saveMediaBuffer(
      loaded.buffer,
      loaded.contentType,
      "mixin",
      mediaMaxBytes,
      loaded.fileName,
    );

    if (loaded.kind === "audio" && account.config.audioSendAsVoiceByDefault !== false) {
      const duration = account.config.audioAutoDetectDuration === false
        ? null
        : await resolveAudioDurationSeconds(saved.path);
      if (duration !== null) {
        const audioResult = await sendAudioMessage(
          params.cfg,
          accountId,
          params.to,
          undefined,
          {
            filePath: saved.path,
            mimeType: saved.contentType ?? loaded.contentType,
            duration,
          },
        );
        if (!audioResult.ok) {
          throw new Error(audioResult.error ?? "mixin outbound audio send failed");
        }
        return audioResult.messageId;
      }
      if (account.config.audioRequireFfprobe) {
        throw new Error("ffprobe is required to send mediaUrl audio as Mixin voice");
      }
    }

    const fileResult = await sendFileMessage(
      params.cfg,
      accountId,
      params.to,
      undefined,
      {
        filePath: saved.path,
        fileName: loaded.fileName,
        mimeType: saved.contentType ?? loaded.contentType,
      },
    );
    if (!fileResult.ok) {
      throw new Error(fileResult.error ?? "mixin outbound file send failed");
    }
    return fileResult.messageId;
  };

  const payloadPlan = buildMixinOutboundPlanFromReplyPayload({
    text: params.text,
    mediaUrl: params.mediaUrls?.[0],
    mediaUrls: params.mediaUrls,
  } as ReplyPayload);
  for (const warning of payloadPlan.warnings) {
    console.warn(`[mixin] outbound plan warning: ${warning}`);
  }

  const lastMessageId = await executeMixinOutboundPlan({
    cfg: params.cfg,
    accountId,
    conversationId: params.to,
    steps: payloadPlan.steps,
    sendMediaUrl,
  });

  return { channel: "mixin", messageId: lastMessageId ?? params.to };
}

export const mixinPlugin = {
  id: "mixin",

  meta: {
    id: "mixin",
    label: "Mixin Messenger",
    selectionLabel: "Mixin Messenger (Blaze WebSocket)",
    docsPath: "/channels/mixin",
    blurb: "Mixin Messenger channel via Blaze WebSocket",
    aliases: ["mixin-messenger", "mixin"],
  },

  configSchema: {
    ...buildChannelConfigSchema(MixinConfigSchema),
    uiHints: {
      appId: { label: "Mixin App ID" },
      sessionId: { label: "Session ID", sensitive: true },
      serverPublicKey: { label: "Server Public Key", sensitive: true },
      sessionPrivateKey: { label: "Session Private Key", sensitive: true },
      "proxy.url": { label: "Proxy URL", advanced: true },
      "proxy.username": { label: "Proxy Username", advanced: true },
      "proxy.password": { label: "Proxy Password", sensitive: true, advanced: true },
      "mixpay.payeeId": { label: "MixPay Payee ID", advanced: true },
    },
  },

  reload: {
    configPrefixes: ["channels.mixin"],
  },

  capabilities: {
    chatTypes: ["direct", "group"] as Array<"direct" | "group">,
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: false,
  },

    onboarding: mixinOnboardingAdapter,
    config: {
      listAccountIds,
      resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) =>
        resolveAccount(cfg, accountId ?? undefined),
      defaultAccountId: (cfg: OpenClawConfig) => resolveDefaultAccountId(cfg),
      inspectAccount: (cfg: OpenClawConfig, accountId?: string | null) => {
        const resolvedAccount = resolveAccount(cfg, accountId ?? undefined);
        const statusSnapshot = resolveMixinStatusSnapshot(cfg, resolvedAccount.accountId);
        return buildMixinAccountSnapshot({
          account: resolvedAccount,
          runtime: null,
          probe: null,
          defaultAccountId: statusSnapshot.defaultAccountId,
          outboxPending: statusSnapshot.outboxPending,
        });
      },
    },

  pairing: {
    idLabel: "Mixin UUID",
    normalizeAllowEntry: (entry: string) => entry.trim().toLowerCase(),
  },

  security: {
    resolveDmPolicy: (
      { account, accountId }: { account?: ResolvedMixinAccount; accountId?: string | null },
    ) => {
      const allowFrom = account?.config?.allowFrom ?? [];
      const basePath = accountId && accountId !== "default" ? `.accounts.${accountId}` : "";
      const policy = account?.config?.dmPolicy ?? "pairing";

      return {
        policy,
        allowFrom,
        policyPath: `channels.mixin${basePath}.dmPolicy`,
        allowFromPath: `channels.mixin${basePath}.allowFrom`,
        approveHint: policy === "pairing"
          ? formatMixinPairingApproveHint("mixin")
          : allowFrom.length > 0
            ? `宸查厤缃櫧鍚嶅崟鐢ㄦ埛鏁?${allowFrom.length}锛屽皢鐢ㄦ埛鐨?Mixin UUID 娣诲姞鍒?allowFrom 鍒楄〃鍗冲彲鎺堟潈`
            : "灏嗙敤鎴风殑 Mixin UUID 娣诲姞鍒?allowFrom 鍒楄〃鍗冲彲鎺堟潈",
      };
    },
  },

  outbound: {
    deliveryMode: "direct" as const,
    textChunkLimit: 4000,
    sendPayload: async (ctx: {
      cfg: OpenClawConfig;
      to: string;
      payload: ReplyPayload;
      mediaLocalRoots?: readonly string[];
      accountId?: string | null;
    }) =>
      deliverOutboundMixinPayload({
        cfg: ctx.cfg,
        to: ctx.to,
        text: ctx.payload.text,
        mediaUrls: ctx.payload.mediaUrls && ctx.payload.mediaUrls.length > 0
          ? ctx.payload.mediaUrls
          : ctx.payload.mediaUrl
            ? [ctx.payload.mediaUrl]
            : [],
        mediaLocalRoots: ctx.mediaLocalRoots,
        accountId: ctx.accountId,
      }),

    sendText: async (ctx: {
      cfg: OpenClawConfig;
      to: string;
      text: string;
      accountId?: string | null;
    }) => {
      const id = ctx.accountId ?? resolveDefaultAccountId(ctx.cfg);
      const result = await sendTextMessage(ctx.cfg, id, ctx.to, undefined, ctx.text);
      if (result.ok) {
        return { channel: "mixin", messageId: result.messageId ?? ctx.to };
      }
      throw new Error(result.error ?? "sendText failed");
    },
    sendMedia: async (ctx: {
      cfg: OpenClawConfig;
      to: string;
      text: string;
      mediaUrl?: string;
      mediaLocalRoots?: readonly string[];
      accountId?: string | null;
    }) =>
      deliverOutboundMixinPayload({
        cfg: ctx.cfg,
        to: ctx.to,
        text: ctx.text,
        mediaUrls: ctx.mediaUrl ? [ctx.mediaUrl] : [],
        mediaLocalRoots: ctx.mediaLocalRoots,
        accountId: ctx.accountId,
      }),
  },

  gateway: {
    startAccount: async (ctx: ChannelGatewayContext<ResolvedMixinAccount>): Promise<unknown> => {
      const { account, cfg, abortSignal } = ctx;
      const log = (ctx as any).log ?? {
        info: (m: string) => console.log(`[mixin] ${m}`),
        warn: (m: string) => console.warn(`[mixin] ${m}`),
        error: (m: string, e?: unknown) => console.error(`[mixin] ${m}`, e),
      };
      const accountId = account.accountId;
      const config = account.config;

      await startSendWorker(cfg, log);
      const outboxStatus = await getOutboxStatus().catch(() => null);
      await startMixpayWorker(cfg, log);
      const mixpayStatus = await getMixpayStatusSnapshot().catch(() => null);
      const statusSnapshot = resolveMixinStatusSnapshot(cfg, accountId, outboxStatus, mixpayStatus);
      ctx.setStatus({
        accountId,
        ...statusSnapshot,
      });

      let stopped = false;
      const stop = () => {
        stopped = true;
        setMixinBlazeSender(accountId, null);
      };
      abortSignal?.addEventListener("abort", stop);

      let attempt = 1;
      let delay = BASE_DELAY;

      const runLoop = async () => {
        while (!stopped) {
          try {
            log.info(`connecting to Mixin Blaze (attempt ${attempt})`);
            log.info(`config: appId=${maskKey(config.appId!)}, sessionId=${maskKey(config.sessionId!)}`);

            await runBlazeLoop({
              config,
              options: { parse: false, syncAck: true },
              log,
              abortSignal,
              onSenderReady: (sender) => {
                setMixinBlazeSender(accountId, sender);
              },
              handler: {
                onMessage: async (rawMsg: any) => {
                  if (stopped) {
                    return;
                  }
                  if (!rawMsg || !rawMsg.message_id) {
                    return;
                  }
                  if (!rawMsg.user_id || rawMsg.user_id === config.appId) {
                    return;
                  }

                  const isDirect = await resolveIsDirectMessage({
                    config,
                    conversationId: rawMsg.conversation_id,
                    userId: rawMsg.user_id,
                    log,
                  });
                  const quoteMessageId = extractQuoteMessageId(rawMsg);
                  const rawCategory = typeof rawMsg.category === "string" ? rawMsg.category : "PLAIN_TEXT";
                  const rawData = typeof rawMsg.data_base64 === "string"
                    ? rawMsg.data_base64
                    : typeof rawMsg.data === "string"
                      ? rawMsg.data
                      : "";
                  log.info(
                    `[mixin] blaze inbound: messageId=${rawMsg.message_id}, conversationId=${rawMsg.conversation_id ?? ""}, userId=${rawMsg.user_id}, category=${rawCategory}, isDirect=${isDirect}, quoteMessageId=${quoteMessageId ?? "none"}, dataLength=${rawData.length}`,
                  );
                  log.info(
                    `[mixin] inbound route context: messageId=${rawMsg.message_id}, conversationId=${rawMsg.conversation_id ?? ""}, userId=${rawMsg.user_id}, isDirect=${isDirect}`,
                  );

                  const msg: MixinInboundMessage = {
                    conversationId: rawMsg.conversation_id ?? "",
                    userId: rawMsg.user_id,
                    messageId: rawMsg.message_id,
                    category: rawCategory,
                    data: rawData,
                    createdAt: rawMsg.created_at ?? new Date().toISOString(),
                    quoteMessageId,
                  };

                  try {
                    await handleMixinMessage({ cfg, accountId, msg, isDirect, log });
                  } catch (err) {
                    log.error(`error handling message ${msg.messageId}`, err);
                  }
                },
              },
            });

            if (stopped) {
              break;
            }

            attempt = 1;
            delay = BASE_DELAY;
          } catch (err) {
            if (stopped) {
              break;
            }
            const errorMsg = err instanceof Error ? err.message : String(err);
            log.error(`connection error: ${errorMsg}`, err);
            log.warn(`retrying in ${delay}ms (attempt ${attempt})`);
            await sleep(delay);
            delay = Math.min(delay * MULTIPLIER, MAX_DELAY);
            attempt++;
          }
        }

        log.info("gateway stopped");
      };

      try {
        await runLoop();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`[internal] unexpected loop error: ${msg}`, err);
      }

      return { stop };
    },
  },

  status: {
    defaultRuntime: createDefaultMixinRuntimeState("default"),
    buildChannelSummary: (params: {
      snapshot: {
        configured?: boolean | null;
        running?: boolean | null;
        lastStartAt?: number | null;
        lastStopAt?: number | null;
        lastError?: string | null;
        defaultAccountId?: string | null;
        outboxDir?: string | null;
        outboxFile?: string | null;
        outboxPending?: number | null;
        mediaMaxMb?: number | null;
      };
    }) => buildMixinChannelSummary({ snapshot: params.snapshot }),
    buildAccountSnapshot: (params: {
      account: ResolvedMixinAccount;
      runtime?: {
        running?: boolean | null;
        lastStartAt?: number | null;
        lastStopAt?: number | null;
        lastError?: string | null;
        lastInboundAt?: number | null;
        lastOutboundAt?: number | null;
      } | null;
      probe?: unknown;
      cfg: OpenClawConfig;
    }) => {
      const { account, runtime, probe, cfg } = params;
      const statusSnapshot = resolveMixinStatusSnapshot(cfg, account.accountId);
      return buildMixinAccountSnapshot({
        account,
        runtime,
        probe,
        defaultAccountId: statusSnapshot.defaultAccountId,
        outboxPending: statusSnapshot.outboxPending,
      });
    },
  },
};

export { describeAccount, isConfigured };





