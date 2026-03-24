import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { describeAccount, getAccountConfig, listAccountIds, resolveAccount, resolveDefaultAccountId } from "./config.js";
import { getMixpayStatusSnapshot } from "./mixpay-worker.js";
import { getOutboxStatus } from "./send-service.js";
import { resolveMixinStatusSnapshot } from "./status.js";

export type MixinPluginDiagnostics = {
  defaultAccountId: string;
  accountIds: string[];
  accounts: ReturnType<typeof describeAccount>[];
  outboxPending: number;
  mixpayPendingOrders: number;
  outboxDir: string;
  outboxFile: string;
  mixpayStoreDir: string | null;
  mixpayStoreFile: string | null;
  mediaMaxMb: number | null;
};

export type MixinSetupMode = "summary" | "single" | "multi";

function formatLine(label: string, value: string | number | boolean | null | undefined): string {
  return `${label}: ${value ?? "-"}`;
}

function formatAccountSummary(cfg: OpenClawConfig, accountId: string): string {
  const account = resolveAccount(cfg, accountId);
  const accountConfig = getAccountConfig(cfg, accountId);
  const status = account.enabled ? (account.configured ? "ready" : "missing-credentials") : "disabled";
  const mixpay = accountConfig.mixpay?.enabled ? "mixpay-on" : "mixpay-off";
  return [
    `${account.accountId} (${account.name ?? account.accountId})`,
    status,
    mixpay,
  ].join(" | ");
}

export async function buildMixinPluginDiagnostics(cfg: OpenClawConfig): Promise<MixinPluginDiagnostics> {
  const defaultAccountId = resolveDefaultAccountId(cfg);
  const accountIds = listAccountIds(cfg);
  const accounts = accountIds.map((accountId) => describeAccount(resolveAccount(cfg, accountId)));
  const outboxStatus = await getOutboxStatus().catch(() => null);
  const mixpayStatus = await getMixpayStatusSnapshot().catch(() => null);
  const snapshot = resolveMixinStatusSnapshot(cfg, defaultAccountId, outboxStatus, mixpayStatus);

  return {
    defaultAccountId,
    accountIds,
    accounts,
    outboxPending: snapshot.outboxPending,
    mixpayPendingOrders: snapshot.mixpayPendingOrders,
    outboxDir: snapshot.outboxDir,
    outboxFile: snapshot.outboxFile,
    mixpayStoreDir: snapshot.mixpayStoreDir,
    mixpayStoreFile: snapshot.mixpayStoreFile,
    mediaMaxMb: snapshot.mediaMaxMb,
  };
}

export function formatMixinStatusText(cfg: OpenClawConfig, diagnostics: MixinPluginDiagnostics): string {
  const lines = [
    "Mixin plugin status",
    formatLine("defaultAccountId", diagnostics.defaultAccountId),
    formatLine("accounts", diagnostics.accountIds.length),
    formatLine("outboxPending", diagnostics.outboxPending),
    formatLine("mixpayPendingOrders", diagnostics.mixpayPendingOrders),
    formatLine("outboxDir", diagnostics.outboxDir),
    formatLine("outboxFile", diagnostics.outboxFile),
    formatLine("mixpayStoreDir", diagnostics.mixpayStoreDir),
    formatLine("mixpayStoreFile", diagnostics.mixpayStoreFile),
    formatLine("mediaMaxMb", diagnostics.mediaMaxMb),
    "",
    "Accounts",
    ...diagnostics.accountIds.map((accountId) => `- ${formatAccountSummary(cfg, accountId)}`),
  ];
  return lines.join("\n");
}

export function formatMixinHelpText(): string {
  return [
    "Mixin plugin commands",
    "/setup [summary|single|multi] - open the setup guide",
    "/mixin-setup [summary|single|multi] - open the setup guide",
    "/mixin-status - show account and queue status",
    "/mixin-accounts - list configured accounts",
    "/mixin-help - show this help text",
    "",
    "Configuration",
    "channels.mixin for the default account",
    "channels.mixin.accounts.<accountId> for multi-account setups",
  ].join("\n");
}

export function buildMixinAccountsText(cfg: OpenClawConfig): string {
  const accountIds = listAccountIds(cfg);
  const lines = ["Configured accounts", ...accountIds.map((accountId) => `- ${formatAccountSummary(cfg, accountId)}`)];
  return lines.join("\n");
}

export function normalizeMixinSetupMode(input: string | undefined): MixinSetupMode {
  const mode = input?.trim().toLowerCase() ?? "";
  if (mode === "single" || mode === "multi" || mode === "summary") {
    return mode;
  }
  return "summary";
}

export function formatMixinSetupText(
  cfg: OpenClawConfig,
  diagnostics?: MixinPluginDiagnostics,
  mode: MixinSetupMode = "summary",
): string {
  const resolved = diagnostics ?? {
    defaultAccountId: resolveDefaultAccountId(cfg),
    accountIds: listAccountIds(cfg),
    accounts: listAccountIds(cfg).map((accountId) => describeAccount(resolveAccount(cfg, accountId))),
    outboxPending: 0,
    mixpayPendingOrders: 0,
    outboxDir: "-",
    outboxFile: "-",
    mixpayStoreDir: null,
    mixpayStoreFile: null,
    mediaMaxMb: null,
  };

  return [
    "Mixin setup",
    "",
    mode === "single"
      ? "Single-account flow"
      : mode === "multi"
        ? "Multi-account flow"
        : "Quick summary",
    "",
    mode === "single"
      ? "1. Put the account fields directly under channels.mixin."
      : "1. Keep or create the default account under channels.mixin.",
    mode === "single"
      ? "2. Fill in appId, sessionId, serverPublicKey, and sessionPrivateKey."
      : "2. For multi-account setups, use channels.mixin.accounts.<accountId>.",
    mode === "single"
      ? "3. Use /mixin-status after restart to confirm the account is ready."
      : "3. Fill in appId, sessionId, serverPublicKey, and sessionPrivateKey.",
    mode === "single"
      ? "4. Use /mixin-help to see the available commands."
      : "4. Use /mixin-status after restart to confirm the account is ready.",
    mode === "multi"
      ? "5. Use /mixin-accounts to verify all configured accounts."
      : "5. Use /mixin-accounts to verify all configured accounts.",
    "",
    `Default account: ${resolved.defaultAccountId}`,
    `Accounts: ${resolved.accountIds.length}`,
    ...resolved.accountIds.map((accountId) => `- ${formatAccountSummary(cfg, accountId)}`),
    "",
    "Optional fields you can adjust later:",
    "- dmPolicy / allowFrom",
    "- groupPolicy / groupAllowFrom",
    "- mixpay",
    "- proxy",
  ].join("\n");
}
