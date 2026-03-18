import type { ReplyPayload } from "openclaw/plugin-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { createMixinCollectOrder, formatMixpayOrderSummary } from "./mixpay-worker.js";
import { buildMixinReplyPlan, resolveMixinReplyPlan } from "./reply-format.js";
import {
  sendAudioMessage,
  sendButtonGroupMessage,
  sendCardMessage,
  sendFileMessage,
  sendPostMessage,
  sendTextMessage,
} from "./send-service.js";
import type { SendLog } from "./shared.js";

export type MixinOutboundStep =
  | { kind: "text"; text: string }
  | { kind: "post"; text: string }
  | { kind: "file"; file: Parameters<typeof sendFileMessage>[4] }
  | { kind: "audio"; audio: Parameters<typeof sendAudioMessage>[4] }
  | { kind: "collect"; collect: Parameters<typeof createMixinCollectOrder>[0]["request"] }
  | { kind: "buttons"; intro?: string; buttons: Parameters<typeof sendButtonGroupMessage>[4] }
  | { kind: "card"; card: Parameters<typeof sendCardMessage>[4] }
  | { kind: "media-url"; mediaUrl: string };

export type MixinOutboundPlan = {
  steps: MixinOutboundStep[];
  warnings: string[];
};

function appendReplyTextPlan(
  steps: MixinOutboundStep[],
  warnings: string[],
  text: string,
  options?: {
    allowAttachmentTemplates?: boolean;
  },
): void {
  const resolution = resolveMixinReplyPlan(text);
  if (resolution.matchedTemplate && !resolution.plan) {
    steps.push({
      kind: "text",
      text: `Mixin template error: ${resolution.error ?? "invalid template"}`,
    });
    return;
  }

  const plan = resolution.plan ?? buildMixinReplyPlan(text);
  if (!plan) {
    return;
  }

  if ((plan.kind === "file" || plan.kind === "audio") && options?.allowAttachmentTemplates === false) {
    warnings.push(`ignored ${plan.kind} template because native media payload already contains media`);
    steps.push({
      kind: "text",
      text: `Mixin template warning: ${plan.kind} template was ignored because mediaUrl/mediaUrls is already present.`,
    });
    return;
  }

  if (plan.kind === "text") {
    steps.push({ kind: "text", text: plan.text });
    return;
  }
  if (plan.kind === "post") {
    steps.push({ kind: "post", text: plan.text });
    return;
  }
  if (plan.kind === "file") {
    steps.push({ kind: "file", file: plan.file });
    return;
  }
  if (plan.kind === "audio") {
    steps.push({ kind: "audio", audio: plan.audio });
    return;
  }
  if (plan.kind === "collect") {
    steps.push({ kind: "collect", collect: plan.collect });
    return;
  }
  if (plan.kind === "buttons") {
    steps.push({ kind: "buttons", intro: plan.intro, buttons: plan.buttons });
    return;
  }
  steps.push({ kind: "card", card: plan.card });
}

export function buildMixinOutboundPlanFromReplyText(text: string): MixinOutboundPlan {
  const steps: MixinOutboundStep[] = [];
  const warnings: string[] = [];
  appendReplyTextPlan(steps, warnings, text, { allowAttachmentTemplates: true });
  return { steps, warnings };
}

export function buildMixinOutboundPlanFromReplyPayload(payload: ReplyPayload): MixinOutboundPlan {
  const steps: MixinOutboundStep[] = [];
  const warnings: string[] = [];
  const mediaUrls = payload.mediaUrls && payload.mediaUrls.length > 0
    ? payload.mediaUrls
    : payload.mediaUrl
      ? [payload.mediaUrl]
      : [];

  if (payload.text?.trim()) {
    appendReplyTextPlan(steps, warnings, payload.text, {
      allowAttachmentTemplates: mediaUrls.length === 0,
    });
  }

  for (const mediaUrl of mediaUrls) {
    steps.push({ kind: "media-url", mediaUrl });
  }

  return { steps, warnings };
}

export async function executeMixinOutboundPlan(params: {
  cfg: OpenClawConfig;
  accountId: string;
  conversationId: string;
  recipientId?: string;
  creatorId?: string;
  steps: MixinOutboundStep[];
  log?: SendLog;
  sendMediaUrl?: (mediaUrl: string) => Promise<string | undefined>;
}): Promise<string | undefined> {
  const { cfg, accountId, conversationId, recipientId, creatorId, steps, log, sendMediaUrl } = params;
  let lastMessageId: string | undefined;

  for (const step of steps) {
    if (step.kind === "text") {
      const result = await sendTextMessage(cfg, accountId, conversationId, recipientId, step.text, log);
      if (!result.ok) {
        throw new Error(result.error ?? "mixin outbound text send failed");
      }
      lastMessageId = result.messageId ?? lastMessageId;
      continue;
    }

    if (step.kind === "post") {
      const result = await sendPostMessage(cfg, accountId, conversationId, recipientId, step.text, log);
      if (!result.ok) {
        throw new Error(result.error ?? "mixin outbound post send failed");
      }
      lastMessageId = result.messageId ?? lastMessageId;
      continue;
    }

    if (step.kind === "file") {
      const result = await sendFileMessage(cfg, accountId, conversationId, recipientId, step.file, log);
      if (!result.ok) {
        throw new Error(result.error ?? "mixin outbound file send failed");
      }
      lastMessageId = result.messageId ?? lastMessageId;
      continue;
    }

    if (step.kind === "audio") {
      const result = await sendAudioMessage(cfg, accountId, conversationId, recipientId, step.audio, log);
      if (!result.ok) {
        throw new Error(result.error ?? "mixin outbound audio send failed");
      }
      lastMessageId = result.messageId ?? lastMessageId;
      continue;
    }

    if (step.kind === "collect") {
      const order = await createMixinCollectOrder({
        cfg,
        accountId,
        conversationId,
        recipientId,
        creatorId: creatorId ?? recipientId ?? conversationId,
        request: step.collect,
      });
      const result = await sendTextMessage(cfg, accountId, conversationId, recipientId, formatMixpayOrderSummary(order), log);
      if (!result.ok) {
        throw new Error(result.error ?? "mixin outbound MixPay collect send failed");
      }
      lastMessageId = result.messageId ?? lastMessageId;
      continue;
    }

    if (step.kind === "buttons") {
      if (step.intro) {
        const introResult = await sendTextMessage(cfg, accountId, conversationId, recipientId, step.intro, log);
        if (!introResult.ok) {
          throw new Error(introResult.error ?? "mixin outbound intro send failed");
        }
        lastMessageId = introResult.messageId ?? lastMessageId;
      }
      const result = await sendButtonGroupMessage(cfg, accountId, conversationId, recipientId, step.buttons, log);
      if (!result.ok) {
        throw new Error(result.error ?? "mixin outbound buttons send failed");
      }
      lastMessageId = result.messageId ?? lastMessageId;
      continue;
    }

    if (step.kind === "card") {
      const result = await sendCardMessage(cfg, accountId, conversationId, recipientId, step.card, log);
      if (!result.ok) {
        throw new Error(result.error ?? "mixin outbound card send failed");
      }
      lastMessageId = result.messageId ?? lastMessageId;
      continue;
    }

    if (!sendMediaUrl) {
      throw new Error("mixin outbound mediaUrl handler not configured");
    }
    lastMessageId = await sendMediaUrl(step.mediaUrl) ?? lastMessageId;
  }

  return lastMessageId;
}
