import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  MixinAccountConfigSchema,
  MixinConversationConfigSchema,
  type MixinAccountConfig,
  type MixinConversationConfig,
  type MixinMixpayConfig,
} from "./config-schema.js";

type RawMixinConfig = Partial<MixinAccountConfig> & {
  defaultAccount?: string;
  accounts?: Record<string, Partial<MixinAccountConfig> | undefined>;
};

function getRawConfig(cfg: OpenClawConfig): RawMixinConfig {
  return ((cfg.channels as Record<string, unknown>)?.mixin ?? {}) as RawMixinConfig;
}

function hasTopLevelAccountConfig(raw: RawMixinConfig): boolean {
  return Boolean(raw.appId || raw.sessionId || raw.serverPublicKey || raw.sessionPrivateKey || raw.name);
}

export function resolveDefaultAccountId(cfg: OpenClawConfig): string {
  const raw = getRawConfig(cfg);
  const configuredDefault = raw.defaultAccount?.trim();
  if (configuredDefault && raw.accounts?.[configuredDefault]) {
    return configuredDefault;
  }
  if (configuredDefault === "default") {
    return "default";
  }
  if (raw.accounts && Object.keys(raw.accounts).length > 0) {
    if (hasTopLevelAccountConfig(raw)) {
      return "default";
    }
    return Object.keys(raw.accounts)[0] ?? "default";
  }
  return "default";
}

export function listAccountIds(cfg: OpenClawConfig): string[] {
  const raw = getRawConfig(cfg);
  const accountIds = raw.accounts ? Object.keys(raw.accounts) : [];
  if (hasTopLevelAccountConfig(raw) || accountIds.length === 0) {
    return ["default", ...accountIds.filter((accountId) => accountId !== "default")];
  }
  return accountIds;
}

export function getAccountConfig(cfg: OpenClawConfig, accountId?: string): MixinAccountConfig {
  const raw = getRawConfig(cfg);
  const resolvedAccountId = accountId ?? resolveDefaultAccountId(cfg);
  let accountRaw: Partial<MixinAccountConfig>;

  if (resolvedAccountId !== "default" && raw.accounts?.[resolvedAccountId]) {
    accountRaw = raw.accounts[resolvedAccountId] as Partial<MixinAccountConfig>;
  } else {
    accountRaw = raw;
  }

  const result = MixinAccountConfigSchema.safeParse(accountRaw);
  if (result.success) return result.data;
  return MixinAccountConfigSchema.parse({});
}

export function resolveAccount(cfg: OpenClawConfig, accountId?: string) {
  const id = accountId ?? resolveDefaultAccountId(cfg);
  const config = getAccountConfig(cfg, id);
  const configured = Boolean(config.appId && config.sessionId && config.serverPublicKey && config.sessionPrivateKey);
  return {
    accountId: id,
    enabled: config.enabled !== false,
    configured,
    name: config.name,
    appId: config.appId,
    sessionId: config.sessionId,
    serverPublicKey: config.serverPublicKey,
    sessionPrivateKey: config.sessionPrivateKey,
    dmPolicy: config.dmPolicy,
    allowFrom: config.allowFrom,
    requireMentionInGroup: config.requireMentionInGroup,
    debug: config.debug,
    config,
  };
}

export function resolveMediaMaxMb(cfg: OpenClawConfig, accountId?: string): number | undefined {
  return getAccountConfig(cfg, accountId).mediaMaxMb;
}

export function getMixpayConfig(cfg: OpenClawConfig, accountId?: string): MixinMixpayConfig | undefined {
  return getAccountConfig(cfg, accountId).mixpay;
}

function getRawAccountConfig(cfg: OpenClawConfig, accountId?: string): Partial<MixinAccountConfig> {
  const raw = getRawConfig(cfg);
  const resolvedAccountId = accountId ?? resolveDefaultAccountId(cfg);
  if (resolvedAccountId !== "default" && raw.accounts?.[resolvedAccountId]) {
    return raw.accounts[resolvedAccountId] as Partial<MixinAccountConfig>;
  }
  return raw;
}

export function getConversationConfig(
  cfg: OpenClawConfig,
  accountId: string,
  conversationId: string,
): {
  exists: boolean;
  config: MixinConversationConfig;
} {
  const accountRaw = getRawAccountConfig(cfg, accountId);
  const conversationRaw = accountRaw.conversations?.[conversationId] as Partial<MixinConversationConfig> | undefined;
  const result = MixinConversationConfigSchema.safeParse(conversationRaw ?? {});
  return {
    exists: Boolean(conversationRaw),
    config: result.success ? result.data : MixinConversationConfigSchema.parse({}),
  };
}

export function resolveConversationPolicy(
  cfg: OpenClawConfig,
  accountId: string,
  conversationId: string,
): {
  enabled: boolean;
  requireMention: boolean;
  mediaBypassMention: boolean;
  groupPolicy: MixinAccountConfig["groupPolicy"];
  groupAllowFrom: string[];
  hasConversationOverride: boolean;
} {
  const accountConfig = getAccountConfig(cfg, accountId);
  const conversation = getConversationConfig(cfg, accountId, conversationId);
  return {
    enabled: conversation.config.enabled !== false,
    requireMention: conversation.config.requireMention ?? accountConfig.requireMentionInGroup,
    mediaBypassMention: conversation.config.mediaBypassMention ?? accountConfig.mediaBypassMentionInGroup,
    groupPolicy: conversation.config.groupPolicy ?? accountConfig.groupPolicy,
    groupAllowFrom: conversation.config.allowFrom ?? accountConfig.groupAllowFrom ?? [],
    hasConversationOverride: conversation.exists,
  };
}

export function isConfigured(account: ReturnType<typeof resolveAccount>): boolean {
  return account.configured;
}

export function describeAccount(account: ReturnType<typeof resolveAccount>) {
  const { config, accountId } = account;
  return {
    accountId,
    name: config.name ?? accountId,
    configured: account.configured,
    enabled: account.enabled,
  };
}
