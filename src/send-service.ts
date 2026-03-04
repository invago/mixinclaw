import { MixinApi } from "@mixin.dev/mixin-node-sdk";
import type { MixinAccountConfig } from "./config-schema.js";
import crypto from "crypto";

// 重试配置：永不放弃，温和递增退避
const BASE_DELAY = 1000;      // 1 秒起
const MAX_DELAY = 3000;       // 最多 3 秒（上限）
const MULTIPLIER = 1.5;       // 每次增加 50%

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
  
  let attempt = 1;
  let delay = BASE_DELAY;
  
  // 永不放弃的重试
  while (true) {
    try {
      log?.info(`[mixin] sendTextMessage (attempt ${attempt}): conversation=${conversationId}, recipient=${recipientId ?? 'N/A'}`);
      
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
      
      // 记录失败，继续重试
      log?.warn(`[mixin] sendText failed (attempt ${attempt}): ${msg}. Retrying in ${delay}ms...`);
      
      // 等待后重试
      await sleep(delay);
      
      // 递增延迟，不超过上限
      delay = Math.min(delay * MULTIPLIER, MAX_DELAY);
      
      attempt++;
    }
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
