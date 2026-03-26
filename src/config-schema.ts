import { z } from "zod";

const DmPolicySchema = z.enum([
  "pairing",
  "allowlist",
  "open",
  "disabled",
]);

const GroupPolicySchema = z.enum([
  "open",
  "disabled",
  "allowlist",
]);

export const MixinProxyConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  url: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
}).superRefine((value, ctx) => {
  if (!value.enabled) {
    return;
  }

  if (!value.url) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "proxy.url is required when proxy.enabled is true",
      path: ["url"],
    });
  }
});

export type MixinProxyConfig = z.infer<typeof MixinProxyConfigSchema>;

export const MixinConversationConfigSchema = z.object({
  enabled: z.boolean().optional(),
  requireMention: z.boolean().optional(),
  allowFrom: z.array(z.string()).optional(),
  mediaBypassMention: z.boolean().optional(),
  groupPolicy: GroupPolicySchema.optional(),
});

export type MixinConversationConfig = z.infer<typeof MixinConversationConfigSchema>;

export const MixinMixpayConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  apiBaseUrl: z.string().optional(),
  payeeId: z.string().optional(),
  defaultQuoteAssetId: z.string().optional(),
  defaultSettlementAssetId: z.string().optional(),
  expireMinutes: z.number().positive().optional().default(15),
  pollIntervalSec: z.number().positive().optional().default(30),
  allowedCreators: z.array(z.string()).optional().default([]),
  notifyOnPending: z.boolean().optional().default(false),
  notifyOnPaidLess: z.boolean().optional().default(true),
});

export type MixinMixpayConfig = z.infer<typeof MixinMixpayConfigSchema>;

export const MixinAccountConfigSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional().default(true),
  appId: z.string().optional(),
  sessionId: z.string().optional(),
  serverPublicKey: z.string().optional(),
  sessionPrivateKey: z.string().optional(),
  dmPolicy: DmPolicySchema.optional().default("pairing"),
  allowFrom: z.array(z.string()).optional().default([]),
  groupPolicy: GroupPolicySchema.optional(),
  groupAllowFrom: z.array(z.string()).optional(),
  requireMentionInGroup: z.boolean().optional().default(true),
  mediaBypassMentionInGroup: z.boolean().optional().default(true),
  mediaMaxMb: z.number().positive().optional(),
  audioAutoDetectDuration: z.boolean().optional().default(true),
  audioSendAsVoiceByDefault: z.boolean().optional().default(true),
  audioRequireFfprobe: z.boolean().optional().default(false),
  mixpay: MixinMixpayConfigSchema.optional(),
  conversations: z.record(z.string(), MixinConversationConfigSchema.optional()).optional(),
  debug: z.boolean().optional().default(false),
  proxy: MixinProxyConfigSchema.optional(),
});

export type MixinAccountConfig = z.infer<typeof MixinAccountConfigSchema>;

export const MixinConfigSchema: z.ZodTypeAny = MixinAccountConfigSchema.extend({
  defaultAccount: z.string().optional(),
  accounts: z.record(z.string(), MixinAccountConfigSchema.optional()).optional(),
});

export type MixinConfig = z.infer<typeof MixinConfigSchema>;
