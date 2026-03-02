import { z } from "zod";

export const MixinAccountConfigSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional().default(true),

// Mixin Bot 凭证（从 https://developers.mixin.one/dashboard 获取）
  appId: z.string().optional(),
  sessionId: z.string().optional(),
  serverPublicKey: z.string().optional(),
  sessionPrivateKey: z.string().optional(),

  // 访问控制
  allowFrom: z.array(z.string()).optional().default([]),

  // 群组消息过滤：是否要求@机器人才响应
  requireMentionInGroup: z.boolean().optional().default(true),

  // 调试模式
  debug: z.boolean().optional().default(false),
});

export type MixinAccountConfig = z.infer<typeof MixinAccountConfigSchema>;

// 顶层 schema 支持单账号 + 多账号
export const MixinConfigSchema: z.ZodTypeAny = MixinAccountConfigSchema.extend({
  accounts: z.record(z.string(), MixinAccountConfigSchema.optional()).optional(),
});

export type MixinConfig = z.infer<typeof MixinConfigSchema>;
