import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { getAccountConfig, resolveDefaultAccountId } from "./config.js";
import { getOutboxPathsSnapshot, type OutboxStatus } from "./send-service.js";
import type { getMixpayStatusSnapshot } from "./mixpay-worker.js";

type RuntimeLifecycleSnapshot = {
  running?: boolean | null;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
};

type MixinChannelStatusSnapshot = {
  configured?: boolean | null;
  running?: boolean | null;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  defaultAccountId?: string | null;
  outboxDir?: string | null;
  outboxFile?: string | null;
  outboxPending?: number | null;
  mediaMaxMb?: number | null;
  mixpayPendingOrders?: number | null;
  mixpayStoreDir?: string | null;
  mixpayStoreFile?: string | null;
};

type MixinStatusAccount = {
  accountId: string;
  name?: string;
  enabled?: boolean;
  configured?: boolean;
  config: {
    requireMentionInGroup?: boolean;
    mediaBypassMentionInGroup?: boolean;
    mediaMaxMb?: number;
    audioAutoDetectDuration?: boolean;
    audioSendAsVoiceByDefault?: boolean;
    audioRequireFfprobe?: boolean;
  };
};

function buildBaseChannelStatusSummary(snapshot: MixinChannelStatusSnapshot): {
  configured: boolean;
  running: boolean;
  lastStartAt: number | null;
  lastStopAt: number | null;
  lastError: string | null;
} {
  return {
    configured: snapshot.configured ?? false,
    running: snapshot.running ?? false,
    lastStartAt: snapshot.lastStartAt ?? null,
    lastStopAt: snapshot.lastStopAt ?? null,
    lastError: snapshot.lastError ?? null,
  };
}

function buildRuntimeAccountStatusSnapshot(params: {
  runtime?: RuntimeLifecycleSnapshot | null;
  probe?: unknown;
}): {
  running: boolean;
  lastStartAt: number | null;
  lastStopAt: number | null;
  lastError: string | null;
  probe?: unknown;
} {
  const { runtime, probe } = params;
  return {
    running: runtime?.running ?? false,
    lastStartAt: runtime?.lastStartAt ?? null,
    lastStopAt: runtime?.lastStopAt ?? null,
    lastError: runtime?.lastError ?? null,
    probe,
  };
}

function buildBaseAccountStatusSnapshot(params: {
  account: MixinStatusAccount;
  runtime?: RuntimeLifecycleSnapshot | null;
  probe?: unknown;
}): {
  accountId: string;
  name?: string;
  enabled?: boolean;
  configured?: boolean;
  running: boolean;
  lastStartAt: number | null;
  lastStopAt: number | null;
  lastError: string | null;
  probe?: unknown;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
} {
  const { account, runtime, probe } = params;
  return {
    accountId: account.accountId,
    name: account.name,
    enabled: account.enabled,
    configured: account.configured,
    ...buildRuntimeAccountStatusSnapshot({ runtime, probe }),
    lastInboundAt: runtime?.lastInboundAt ?? null,
    lastOutboundAt: runtime?.lastOutboundAt ?? null,
  };
}

export function resolveMixinStatusSnapshot(
  cfg: OpenClawConfig,
  accountId?: string,
  outboxStatus?: OutboxStatus | null,
  mixpayStatus?: Awaited<ReturnType<typeof getMixpayStatusSnapshot>> | null,
): {
  defaultAccountId: string;
  outboxDir: string;
  outboxFile: string;
  outboxPending: number;
  mediaMaxMb: number | null;
  mixpayPendingOrders: number;
  mixpayStoreDir: string | null;
  mixpayStoreFile: string | null;
} {
  const defaultAccountId = resolveDefaultAccountId(cfg);
  const resolvedAccountId = accountId ?? defaultAccountId;
  const accountConfig = getAccountConfig(cfg, resolvedAccountId);
  const { outboxDir, outboxFile } = getOutboxPathsSnapshot();
  return {
    defaultAccountId,
    outboxDir,
    outboxFile,
    outboxPending: outboxStatus?.totalPending ?? 0,
    mediaMaxMb: accountConfig.mediaMaxMb ?? null,
    mixpayPendingOrders: mixpayStatus?.pendingOrders ?? 0,
    mixpayStoreDir: mixpayStatus?.storeDir ?? null,
    mixpayStoreFile: mixpayStatus?.storeFile ?? null,
  };
}

export function buildMixinChannelSummary(params: {
  snapshot: MixinChannelStatusSnapshot;
}) {
  const { snapshot } = params;
  return {
    ...buildBaseChannelStatusSummary(snapshot),
    defaultAccountId: snapshot.defaultAccountId ?? null,
    outboxDir: snapshot.outboxDir ?? null,
    outboxFile: snapshot.outboxFile ?? null,
    outboxPending: snapshot.outboxPending ?? 0,
    mediaMaxMb: snapshot.mediaMaxMb ?? null,
    mixpayPendingOrders: snapshot.mixpayPendingOrders ?? 0,
    mixpayStoreDir: snapshot.mixpayStoreDir ?? null,
    mixpayStoreFile: snapshot.mixpayStoreFile ?? null,
  };
}

export function buildMixinAccountSnapshot(params: {
  account: MixinStatusAccount;
  runtime?: RuntimeLifecycleSnapshot | null;
  probe?: unknown;
  defaultAccountId?: string | null;
  outboxPending?: number | null;
}) {
  const { account, runtime, probe, defaultAccountId, outboxPending } = params;
  return {
    ...buildBaseAccountStatusSnapshot({ account, runtime, probe }),
    defaultAccountId: defaultAccountId ?? null,
    outboxPending: outboxPending ?? 0,
    requireMentionInGroup: account.config.requireMentionInGroup ?? true,
    mediaBypassMentionInGroup: account.config.mediaBypassMentionInGroup ?? true,
    mediaMaxMb: account.config.mediaMaxMb ?? null,
    audioAutoDetectDuration: account.config.audioAutoDetectDuration ?? true,
    audioSendAsVoiceByDefault: account.config.audioSendAsVoiceByDefault ?? true,
    audioRequireFfprobe: account.config.audioRequireFfprobe ?? false,
  };
}
