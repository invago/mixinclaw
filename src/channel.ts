import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildChannelConfigSchema, formatPairingApproveHint } from "openclaw/plugin-sdk";
import type { ChannelGatewayContext, OpenClawConfig, ReplyPayload } from "openclaw/plugin-sdk";
import { runBlazeLoop } from "./blaze-service.js";
import { MixinConfigSchema } from "./config-schema.js";
import { describeAccount, isConfigured, listAccountIds, resolveAccount } from "./config.js";
import { handleMixinMessage, type MixinInboundMessage } from "./inbound-handler.js";
import { getMixinRuntime } from "./runtime.js";
import { sendAudioMessage, sendFileMessage, sendTextMessage, startSendWorker } from "./send-service.js";

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

function resolvePayloadMediaUrls(payload: ReplyPayload): string[] {
  if (payload.mediaUrls && payload.mediaUrls.length > 0) {
    return payload.mediaUrls;
  }
  return payload.mediaUrl ? [payload.mediaUrl] : [];
}

async function deliverOutboundMixinPayload(params: {
  cfg: OpenClawConfig;
  to: string;
  text?: string;
  mediaUrls?: string[];
  mediaLocalRoots?: readonly string[];
  accountId?: string | null;
}): Promise<{ channel: "mixin"; messageId: string }> {
  const accountId = params.accountId ?? "default";
  let lastMessageId = params.to;

  if (params.text?.trim()) {
    const textResult = await sendTextMessage(params.cfg, accountId, params.to, undefined, params.text);
    if (!textResult.ok) {
      throw new Error(textResult.error ?? "mixin outbound text send failed");
    }
    lastMessageId = textResult.messageId ?? lastMessageId;
  }

  const runtime = getMixinRuntime();
  for (const mediaUrl of params.mediaUrls ?? []) {
    const loaded = await runtime.media.loadWebMedia(mediaUrl, {
      maxBytes: MEDIA_MAX_BYTES,
      localRoots: params.mediaLocalRoots,
    });
    const saved = await runtime.channel.media.saveMediaBuffer(
      loaded.buffer,
      loaded.contentType,
      "mixin",
      MEDIA_MAX_BYTES,
      loaded.fileName,
    );

    if (loaded.kind === "audio") {
      const duration = await resolveAudioDurationSeconds(saved.path);
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
        lastMessageId = audioResult.messageId ?? lastMessageId;
        continue;
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
    lastMessageId = fileResult.messageId ?? lastMessageId;
  }

  return { channel: "mixin", messageId: lastMessageId };
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
    defaultAccountId: () => "default",
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
        mediaUrls: resolvePayloadMediaUrls(ctx.payload),
        mediaLocalRoots: ctx.mediaLocalRoots,
        accountId: ctx.accountId,
      }),

    sendText: async (ctx: {
      cfg: OpenClawConfig;
      to: string;
      text: string;
      accountId?: string | null;
    }) => {
      const id = ctx.accountId ?? "default";
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
    defaultRuntime: {
      accountId: "default",
      running: false,
      status: "stopped" as const,
    },
  },
};

export { describeAccount, isConfigured };
