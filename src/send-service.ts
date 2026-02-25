import { MixinApi } from "@mixin.dev/mixin-node-sdk";
import type { MixinAccountConfig } from "./config-schema.js";

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

function buildClient(config: MixinAccountConfig) {
  return MixinApi({
    keystore: {
      app_id: config.appId!,
      session_id: config.sessionId!,
      server_public_key: config.serverPublicKey!,
      session_private_key: config.sessionPrivateKey!,
    },
  });
}

export async function sendTextMessage(
  config: MixinAccountConfig,
  conversationId: string,
  recipientId: string,
  text: string,
  log?: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void }
): Promise<SendResult> {
  try {
    const client = buildClient(config);
    await client.message.sendText(recipientId, text);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.error(`[mixin] sendText failed: ${msg}`, err);
    return { ok: false, error: msg };
  }
}

export async function acknowledgeMessage(
  config: MixinAccountConfig,
  messageId: string
): Promise<void> {
  try {
    const client = buildClient(config);
    await client.message.sendAcknowledgement(
      { message_id: messageId, status: "READ" }
    );
  } catch {
    // ACK 失败不阻断主流程
  }
}
