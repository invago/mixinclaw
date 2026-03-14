import { buildBaseAccountStatusSnapshot, buildBaseChannelStatusSummary } from "openclaw/plugin-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { getAccountConfig, resolveDefaultAccountId } from "./config.js";
import { getOutboxPathsSnapshot, type OutboxStatus } from "./send-service.js";

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

export function resolveMixinStatusSnapshot(
  cfg: OpenClawConfig,
  accountId?: string,
  outboxStatus?: OutboxStatus | null,
): {
  defaultAccountId: string;
  outboxDir: string;
  outboxFile: string;
  outboxPending: number;
  mediaMaxMb: number | null;
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
