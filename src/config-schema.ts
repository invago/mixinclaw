import { DmPolicySchema } from "openclaw/plugin-sdk";
import { z } from "zod";

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

export const MixinAccountConfigSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional().default(true),
  appId: z.string().optional(),
  sessionId: z.string().optional(),
  serverPublicKey: z.string().optional(),
  sessionPrivateKey: z.string().optional(),
  dmPolicy: DmPolicySchema.optional().default("pairing"),
  allowFrom: z.array(z.string()).optional().default([]),
  requireMentionInGroup: z.boolean().optional().default(true),
  debug: z.boolean().optional().default(false),
  proxy: MixinProxyConfigSchema.optional(),
});

export type MixinAccountConfig = z.infer<typeof MixinAccountConfigSchema>;

export const MixinConfigSchema: z.ZodTypeAny = MixinAccountConfigSchema.extend({
  accounts: z.record(z.string(), MixinAccountConfigSchema.optional()).optional(),
});

export type MixinConfig = z.infer<typeof MixinConfigSchema>;
