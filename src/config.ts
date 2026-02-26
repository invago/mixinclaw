import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { MixinAccountConfigSchema, type MixinAccountConfig, type MixinConfig } from "./config-schema.js";

function getRawConfig(cfg: OpenClawConfig): any {
  return (cfg.channels as Record<string, unknown>)?.mixin ?? {};
}

export function listAccountIds(cfg: OpenClawConfig): string[] {
  const raw = getRawConfig(cfg);
  if (raw.accounts && Object.keys(raw.accounts).length > 0) {
    return Object.keys(raw.accounts);
  }
  return ["default"];
}

export function getAccountConfig(cfg: OpenClawConfig, accountId?: string): MixinAccountConfig {
  const raw = getRawConfig(cfg);
  let accountRaw: Partial<MixinAccountConfig>;

  if (accountId && accountId !== "default" && raw.accounts?.[accountId]) {
    accountRaw = raw.accounts[accountId] as Partial<MixinAccountConfig>;
  } else {
    const { accounts: _accounts, ...rest } = raw as MixinConfig & { accounts?: unknown };
    accountRaw = rest as Partial<MixinAccountConfig>;
  }

  const result = MixinAccountConfigSchema.safeParse(accountRaw);
  if (result.success) return result.data;
  return MixinAccountConfigSchema.parse({});
}

export function resolveAccount(cfg: OpenClawConfig, accountId?: string) {
  const id = accountId ?? "default";
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
