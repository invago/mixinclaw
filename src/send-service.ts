import { MixinApi } from "@mixin.dev/mixin-node-sdk";
import type { MixinAccountConfig } from "./config-schema.js";
import crypto from "crypto";

// 重试配置：最大重试 10 次，指数退避（1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 512s）
const MAX_RETRIES = 10;
const BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
  recipientId: string | undefined,
  text: string,
  log?: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void; warn: (msg: string) => void }
): Promise<SendResult> {
  const messageData = Buffer.from(text).toString('base64');
  const messageId = crypto.randomUUID();
  
  // 指数退避重试
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log?.info(`[mixin] sendTextMessage (attempt ${attempt}/${MAX_RETRIES}): conversation=${conversationId}, recipient=${recipientId ?? 'N/A'}, text=${text.substring(0, 50)}`);
      
      const client = buildClient(config);
      
      log?.info(`[mixin] sendOne: message_id=${messageId}, category=PLAIN_TEXT`);
      
      // 私聊需要 recipient_id，群聊不需要
      const messagePayload: any = {
        conversation_id: conversationId,
        message_id: messageId,
        category: 'PLAIN_TEXT',
        data_base64: messageData,
      };
      
      // 只在私聊时添加 recipient_id
      if (recipientId) {
        messagePayload.recipient_id = recipientId;
      }
      
      const result = await client.message.sendOne(messagePayload);
      
      log?.info(`[mixin] sendOne completed: ${JSON.stringify(result)}`);
      
      if (attempt > 1) {
        log?.warn(`[mixin] message sent successfully after ${attempt} attempts`);
      }
      
      return { ok: true, messageId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET');
      
      if (isTimeout && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        log?.warn(`[mixin] sendText failed (attempt ${attempt}/${MAX_RETRIES}): ${msg}. Retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        log?.error(`[mixin] sendText failed (attempt ${attempt}/${MAX_RETRIES}): ${msg}`, err);
        return { ok: false, error: msg };
      }
    }
  }
  
  // 不应该到这里，但为了类型安全
  return { ok: false, error: 'Max retries exceeded' };
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
