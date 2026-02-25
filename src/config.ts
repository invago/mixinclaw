import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { MixinAccountConfigSchema, type MixinAccountConfig, type MixinConfig } from "./config-schema.js";

const CHANNEL_KEY = "channels.mixin";

function getRawConfig(cfg: OpenClawConfig): any {
  return (cfg as Record<string, unknown>)[CHANNEL_KEY] ?? {};
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
  return {
    accountId: id,
    config,
    enabled: config.enabled !== false,
    configured: Boolean(config.appId && config.sessionId && config.sessionPrivateKey),
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
