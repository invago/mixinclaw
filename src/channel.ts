import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildChannelConfigSchema,
  createDefaultChannelRuntimeState,
  formatPairingApproveHint,
  resolveChannelMediaMaxBytes,
} from "openclaw/plugin-sdk";
import type { ChannelGatewayContext, OpenClawConfig, ReplyPayload } from "openclaw/plugin-sdk";
import { runBlazeLoop } from "./blaze-service.js";
import { MixinConfigSchema } from "./config-schema.js";
import { describeAccount, isConfigured, listAccountIds, resolveAccount, resolveDefaultAccountId, resolveMediaMaxMb } from "./config.js";
import { handleMixinMessage, type MixinInboundMessage } from "./inbound-handler.js";
import { getMixpayStatusSnapshot, startMixpayWorker } from "./mixpay-worker.js";
import { buildMixinOutboundPlanFromReplyPayload, executeMixinOutboundPlan } from "./outbound-plan.js";
import { getMixinRuntime } from "./runtime.js";
import { getOutboxStatus, sendAudioMessage, sendFileMessage, sendTextMessage, startSendWorker } from "./send-service.js";
import { buildMixinAccountSnapshot, buildMixinChannelSummary, resolveMixinStatusSnapshot } from "./status.js";

type ResolvedMixinAccount = ReturnType<typeof resolveAccount>;

const BASE_DELAY = 1000;
const MAX_DELAY = 3000;
const MULTIPLIER = 1.5;
const MEDIA_MAX_BYTES = 30 * 1024 * 1024;
const execFileAsync = promisify(execFile);

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maskKey(key: string): string {
  if (!key || key.length < 8) {
    return "****";
  }
  return key.slice(0, 4) + "****" + key.slice(-4);
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
  return resolveChannelMediaMaxBytes({
    cfg,
    resolveChannelLimitMb: ({ cfg, accountId }) => resolveMediaMaxMb(cfg, accountId),
    accountId,
  }) ?? MEDIA_MAX_BYTES;
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

  configSchema: buildChannelConfigSchema(MixinConfigSchema),

  capabilities: {
    chatTypes: ["direct", "group"] as Array<"direct" | "group">,
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: false,
  },

  config: {
    listAccountIds,
    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) =>
      resolveAccount(cfg, accountId ?? undefined),
    defaultAccountId: (cfg: OpenClawConfig) => resolveDefaultAccountId(cfg),
  },

  pairing: {
    idLabel: "Mixin UUID",
    normalizeAllowEntry: (entry: string) => entry.trim().toLowerCase(),
  },

  security: {
    resolveDmPolicy: ({ account, accountId }: { account: ResolvedMixinAccount; accountId?: string | null }) => {
      const allowFrom = account.config.allowFrom ?? [];
      const basePath = accountId && accountId !== "default" ? `.accounts.${accountId}` : "";
      const policy = account.config.dmPolicy ?? "pairing";

      return {
        policy,
        allowFrom,
        policyPath: `channels.mixin${basePath}.dmPolicy`,
        allowFromPath: `channels.mixin${basePath}.allowFrom`,
        approveHint: policy === "pairing"
          ? formatPairingApproveHint("mixin")
          : allowFrom.length > 0
            ? `已配置白名单用户数 ${allowFrom.length}，将用户的 Mixin UUID 添加到 allowFrom 列表即可授权`
            : "将用户的 Mixin UUID 添加到 allowFrom 列表即可授权",
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

                  const isDirect = rawMsg.conversation_id === undefined
                    ? true
                    : !rawMsg.representative_id;

                  const msg: MixinInboundMessage = {
                    conversationId: rawMsg.conversation_id ?? "",
                    userId: rawMsg.user_id,
                    messageId: rawMsg.message_id,
                    category: rawMsg.category ?? "PLAIN_TEXT",
                    data: rawMsg.data_base64 ?? rawMsg.data ?? "",
                    createdAt: rawMsg.created_at ?? new Date().toISOString(),
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
    defaultRuntime: createDefaultChannelRuntimeState("default"),
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
