import { MixinApi } from "@mixin.dev/mixin-node-sdk";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk";
import type { ChannelGatewayContext, OpenClawConfig } from "openclaw/plugin-sdk";
import { MixinConfigSchema } from "./config-schema.js";
import {
  listAccountIds,
  resolveAccount,
  isConfigured,
  describeAccount,
  getAccountConfig,
} from "./config.js";
import { handleMixinMessage, type MixinInboundMessage } from "./inbound-handler.js";
import { sendTextMessage } from "./send-service.js";

type ResolvedMixinAccount = ReturnType<typeof resolveAccount>;

const RECONNECT_DELAYS = [2000, 5000, 10000, 20000, 40000, 60000];

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const mixinPlugin = {
  id: "mixin",

  meta: {
    id: "mixin",
    label: "Mixin Messenger",
    selectionLabel: "Mixin Messenger (Blaze WebSocket)",
    docsPath: "/channels/mixin",
    blurb: "通过 Mixin Blaze WebSocket 接入 Mixin Messenger 消息。",
    aliases: ["mixin-messenger", "mixin"],
  },

  configSchema: buildChannelConfigSchema(MixinConfigSchema),

  capabilities: {
    chatTypes: ["direct", "group"] as Array<"direct" | "group">,
    reactions: false,
    threads: false,
    media: false,
    nativeCommands: false,
    blockStreaming: false,
  },

  config: {
    listAccountIds,
    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) =>
      resolveAccount(cfg, accountId ?? undefined),
    defaultAccountId: () => "default",
  },

  security: {
    resolveDmPolicy: ({ account, accountId }: { account: ResolvedMixinAccount; accountId?: string | null }) => ({
      policy: account.config.dmPolicy ?? "open",
      allowFrom: account.config.allowFrom ?? [],
      allowFromPath: `channels.mixin${accountId && accountId !== "default" ? `.accounts.${accountId}` : ""}.allowFrom`,
      approveHint: "将用户的 Mixin UUID 添加到 allowFrom 列表中",
    }),
  },

  outbound: {
    deliveryMode: "direct" as const,

    sendText: async (ctx: {
      cfg: OpenClawConfig;
      to: string;
      text: string;
      accountId?: string | null;
    }) => {
      const id = ctx.accountId ?? "default";
      const config = getAccountConfig(ctx.cfg, id);
      const result = await sendTextMessage(config, ctx.to, ctx.to, ctx.text);
      if (result.ok) {
        return { channel: "mixin", messageId: result.messageId ?? ctx.to };
      }
      throw new Error(result.error ?? "sendText failed");
    },
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

      let stopped = false;
      const stop = () => { stopped = true; };
      abortSignal?.addEventListener("abort", stop);

      let attempt = 0;

      const runLoop = async () => {
        while (!stopped) {
          try {
            log.info(`connecting to Mixin Blaze (attempt ${attempt + 1})`);

            const client = MixinApi({
              keystore: {
                app_id: config.appId!,
                session_id: config.sessionId!,
                server_public_key: config.serverPublicKey!,
                session_private_key: config.sessionPrivateKey!,
              },
              blazeOptions: { parse: true, syncAck: true },
            });

            await new Promise<void>((resolve, reject) => {
              if (stopped) { resolve(); return; }

              try {
                client.blaze.loop({
                  onMessage: async (rawMsg: any) => {
                    if (stopped) return;

                    const data = rawMsg?.data;
                    if (!data || rawMsg.action !== "CREATE_MESSAGE") return;
                    if (!data.user_id || data.user_id === config.appId) return;

                    // Mixin conversation_id 为群组时与私聊不同
                    // 私聊: uniqueConversationID(appId, userId)，群组: 群组 UUID
                    const isDirect = data.conversation_id === undefined
                      ? true
                      : !data.representative_id;

                    const msg: MixinInboundMessage = {
                      conversationId: data.conversation_id ?? "",
                      userId: data.user_id,
                      messageId: data.message_id,
                      category: data.category ?? "PLAIN_TEXT",
                      data: data.data_base64 ?? data.data ?? "",
                      createdAt: data.created_at ?? new Date().toISOString(),
                    };

                    try {
                      await handleMixinMessage({ cfg, accountId, msg, isDirect, log });
                    } catch (err) {
                      log.error(`error handling message ${msg.messageId}`, err);
                    }
                  },
                });
              } catch (err) {
                reject(err);
                return;
              }

              abortSignal?.addEventListener("abort", () => resolve());
            });

            if (stopped) break;
            attempt = 0;
          } catch (err) {
            if (stopped) break;
            const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
            log.warn(`connection lost, retrying in ${delay}ms (attempt ${attempt + 1})`);
            attempt++;
            await sleep(delay);
          }
        }

        log.info("gateway stopped");
      };

      runLoop().catch((err) => {
        log.error("fatal error in gateway loop", err);
      });

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
