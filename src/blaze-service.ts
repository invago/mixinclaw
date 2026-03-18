import {
  decodeMessage,
  sendRaw,
  signAccessToken,
  type BlazeHandler,
  type BlazeOptions,
} from "@mixin.dev/mixin-node-sdk";
import WebSocket from "ws";
import crypto from "crypto";
import type { MixinAccountConfig } from "./config-schema.js";
import { createProxyAgent } from "./proxy.js";
import type { MixinBlazeOutboundMessage } from "./runtime.js";
import type { SendLog } from "./shared.js";

function buildKeystore(config: MixinAccountConfig) {
  return {
    app_id: config.appId!,
    session_id: config.sessionId!,
    server_public_key: config.serverPublicKey!,
    session_private_key: config.sessionPrivateKey!,
  };
}

async function dispatchMessage(handler: BlazeHandler, msg: any): Promise<void> {
  if (msg.source === "ACKNOWLEDGE_MESSAGE_RECEIPT" && handler.onAckReceipt) {
    await handler.onAckReceipt(msg);
    return;
  }

  if (msg.category === "SYSTEM_CONVERSATION" && handler.onConversation) {
    await handler.onConversation(msg);
    return;
  }

  if (msg.category === "SYSTEM_ACCOUNT_SNAPSHOT" && handler.onTransfer) {
    await handler.onTransfer(msg);
    return;
  }

  await handler.onMessage(msg);
}

export async function runBlazeLoop(params: {
  config: MixinAccountConfig;
  options?: BlazeOptions;
  handler: BlazeHandler;
  log: SendLog;
  abortSignal?: AbortSignal;
  onSenderReady?: ((sender: ((message: MixinBlazeOutboundMessage) => Promise<void>) | null) => void) | undefined;
}): Promise<void> {
  const { config, options, handler, log, abortSignal, onSenderReady } = params;
  const keystore = buildKeystore(config);
  const jwtToken = signAccessToken("GET", "/", "", crypto.randomUUID(), keystore) || "";
  const agent = createProxyAgent(config.proxy);

  await new Promise<void>((resolve, reject) => {
    let ws: WebSocket | undefined;
    let opened = false;
    let settled = false;
    let pingTimeout: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (pingTimeout) {
        clearTimeout(pingTimeout);
        pingTimeout = null;
      }
      onSenderReady?.(null);
      abortSignal?.removeEventListener("abort", onAbort);
    };

    const finish = (err?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (err) {
        reject(err);
        return;
      }
      resolve();
    };

    const terminate = () => {
      if (!ws) {
        return;
      }
      ws.terminate();
      ws = undefined;
    };

    const heartbeat = () => {
      if (pingTimeout) {
        clearTimeout(pingTimeout);
      }
      pingTimeout = setTimeout(() => {
        terminate();
      }, 30_000);
    };

    const onAbort = () => {
      terminate();
      finish();
    };

    ws = new WebSocket("wss://blaze.mixin.one", "Mixin-Blaze-1", {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
      },
      handshakeTimeout: 3000,
      agent,
    });

    abortSignal?.addEventListener("abort", onAbort);

    ws.on("open", () => {
      opened = true;
      heartbeat();
      onSenderReady?.(async (message) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          throw new Error("blaze sender unavailable: socket not open");
        }
        const ok = await sendRaw(ws, {
          id: crypto.randomUUID(),
          action: "CREATE_MESSAGE",
          params: {
            conversation_id: message.conversationId,
            status: "SENT",
            message_id: message.messageId,
            category: message.category,
            data: message.dataBase64,
          },
        });
        if (!ok) {
          throw new Error("blaze sender timeout");
        }
      });
      void sendRaw(ws!, {
        id: crypto.randomUUID(),
        action: "LIST_PENDING_MESSAGES",
      });
    });

    ws.on("ping", () => {
      heartbeat();
    });

    ws.on("message", async (data) => {
      try {
        const msg = decodeMessage(data as Uint8Array, options ?? { parse: false, syncAck: false });
        if (!msg) {
          return;
        }

        if (options?.syncAck && msg.message_id) {
          await sendRaw(ws!, {
            id: crypto.randomUUID(),
            action: "ACKNOWLEDGE_MESSAGE_RECEIPT",
            params: {
              message_id: msg.message_id,
              status: "READ",
            },
          });
        }

        await dispatchMessage(handler, msg);
      } catch (err) {
        log.error("[mixin] blaze message error", err);
      }
    });

    ws.on("close", () => {
      finish();
    });

    ws.on("error", (err) => {
      if (!opened) {
        finish(err);
        return;
      }
      log.error("[mixin] blaze websocket error", err);
    });
  });
}
