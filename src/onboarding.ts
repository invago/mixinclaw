import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingDmPolicy,
  DmPolicy,
  OpenClawConfig,
  WizardPrompter,
} from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, promptAccountId } from "openclaw/plugin-sdk";
import { getAccountConfig, listAccountIds, resolveAccount, resolveDefaultAccountId } from "./config.js";
import type { MixinAccountConfig } from "./config-schema.js";

const channel = "mixin" as const;

type MixinConfigRoot = Partial<MixinAccountConfig> & {
  defaultAccount?: string;
  accounts?: Record<string, Partial<MixinAccountConfig> | undefined>;
};

type MixinGroupPolicy = NonNullable<MixinAccountConfig["groupPolicy"]>;

type MixinDmPolicy = NonNullable<MixinAccountConfig["dmPolicy"]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getMixinRoot(cfg: OpenClawConfig): MixinConfigRoot {
  const root = cfg as unknown as Record<string, unknown>;
  const channels = isRecord(root.channels) ? root.channels : undefined;
  const channelConfig = channels && isRecord(channels.mixin) ? channels.mixin : undefined;
  if (channelConfig) {
    return channelConfig as MixinConfigRoot;
  }

  const legacyNamedConfig = isRecord(root.mixin) ? root.mixin : undefined;
  if (legacyNamedConfig) {
    return legacyNamedConfig as MixinConfigRoot;
  }

  const plugins = isRecord(root.plugins) ? root.plugins : undefined;
  const entries = plugins && isRecord(plugins.entries) ? plugins.entries : undefined;
  const mixinEntry = entries && isRecord(entries.mixin) ? entries.mixin : undefined;
  const pluginEntryConfig = mixinEntry && isRecord(mixinEntry.config) ? mixinEntry.config : undefined;
  if (pluginEntryConfig) {
    return pluginEntryConfig as MixinConfigRoot;
  }

  return isRecord(root) ? (root as MixinConfigRoot) : {};
}

function updateMixinRoot(cfg: OpenClawConfig, patch: Partial<MixinConfigRoot>): OpenClawConfig {
  const current = getMixinRoot(cfg);
  return {
    ...cfg,
    channels: {
      ...(cfg.channels ?? {}),
      mixin: {
        ...current,
        ...patch,
      },
    },
  } as OpenClawConfig;
}

function updateMixinAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
  patch: Partial<MixinAccountConfig>,
): OpenClawConfig {
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return updateMixinRoot(cfg, patch);
  }

  const current = getMixinRoot(cfg);
  const accounts = current.accounts ?? {};

  return updateMixinRoot(cfg, {
    accounts: {
      ...accounts,
      [accountId]: {
        ...(accounts[accountId] ?? {}),
        ...patch,
      },
    },
  });
}

function mergeAllowFrom(values: string[] | undefined, nextValue: string): string[] {
  const parts = nextValue
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set([...(values ?? []), ...parts])];
}


async function promptAccountGuide(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "Mixin uses Blaze WebSocket and needs one account block per bot account.",
      "Required fields: appId, sessionId, serverPublicKey, sessionPrivateKey.",
      "Single-account setup lives directly under channels.mixin.",
      "Multi-account setup lives under channels.mixin.accounts.<accountId>.",
      "Optional fields: dmPolicy, allowFrom, groupPolicy, mixpay, proxy.",
      "Docs: README.md / README.zh-CN.md",
    ].join("\n"),
    "Mixin setup guide",
  );
}

function setRootDmPolicy(cfg: OpenClawConfig, policy: DmPolicy): OpenClawConfig {
  return updateMixinRoot(cfg, {
    dmPolicy: policy as MixinDmPolicy,
  });
}

function normalizeDmPolicy(value: unknown): MixinDmPolicy {
  return value === "allowlist" || value === "open" || value === "disabled" ? value : "pairing";
}

function normalizeGroupPolicy(value: unknown): MixinGroupPolicy {
  return value === "allowlist" || value === "open" || value === "disabled" ? value : "open";
}

function defaultMixpayConfig(existing?: MixinAccountConfig["mixpay"]): NonNullable<MixinAccountConfig["mixpay"]> {
  return {
    enabled: existing?.enabled ?? false,
    apiBaseUrl: existing?.apiBaseUrl,
    payeeId: existing?.payeeId,
    defaultQuoteAssetId: existing?.defaultQuoteAssetId,
    defaultSettlementAssetId: existing?.defaultSettlementAssetId,
    expireMinutes: existing?.expireMinutes ?? 15,
    pollIntervalSec: existing?.pollIntervalSec ?? 30,
    allowedCreators: existing?.allowedCreators ?? [],
    notifyOnPending: existing?.notifyOnPending ?? false,
    notifyOnPaidLess: existing?.notifyOnPaidLess ?? true,
  };
}

async function promptAllowFrom(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
  accountId?: string;
}): Promise<OpenClawConfig> {
  const accountId = params.accountId ?? DEFAULT_ACCOUNT_ID;
  const current = getAccountConfig(params.cfg, accountId).allowFrom ?? [];
  await params.prompter.note(
    [
      "Enter Mixin UUID values separated by commas or new lines.",
      "Example: 12345678-1234-1234-1234-123456789abc",
      "Leave blank if you want to keep pairing-only access.",
    ].join("\n"),
    "Mixin allowFrom",
  );
  const raw = await params.prompter.text({
    message: "Allowed Mixin UUIDs",
    placeholder: "uuid-one, uuid-two",
    initialValue: current.join(", ") || undefined,
    validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
  });
  const allowFrom = mergeAllowFrom(current, String(raw));
  return updateMixinAccountConfig(params.cfg, accountId, { allowFrom });
}

async function promptAccountConfig(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
  accountId: string;
}): Promise<OpenClawConfig> {
  const resolved = resolveAccount(params.cfg, params.accountId);
  const current = getAccountConfig(params.cfg, params.accountId);
  let next = params.cfg;

  const appId = String(
    await params.prompter.text({
      message: "Mixin appId",
      initialValue: resolved.appId ?? undefined,
      validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
    }),
  ).trim();

  const sessionId = String(
    await params.prompter.text({
      message: "Mixin sessionId",
      initialValue: resolved.sessionId ?? undefined,
      validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
    }),
  ).trim();

  const serverPublicKey = String(
    await params.prompter.text({
      message: "Mixin serverPublicKey",
      initialValue: resolved.serverPublicKey ?? undefined,
      validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
    }),
  ).trim();

  const sessionPrivateKey = String(
    await params.prompter.text({
      message: "Mixin sessionPrivateKey",
      initialValue: resolved.sessionPrivateKey ?? undefined,
      validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
    }),
  ).trim();

  next = updateMixinAccountConfig(next, params.accountId, {
    enabled: true,
    appId,
    sessionId,
    serverPublicKey,
    sessionPrivateKey,
  });

  const dmPolicy = await params.prompter.select<MixinDmPolicy>({
    message: "DM policy",
    initialValue: normalizeDmPolicy(current.dmPolicy),
    options: [
      { value: "pairing", label: "Pairing", hint: "Accept DMs after pairing approval" },
      { value: "allowlist", label: "Allowlist", hint: "Only accept DMs from allowFrom" },
      { value: "open", label: "Open", hint: "Accept DMs without an allowlist" },
      { value: "disabled", label: "Disabled", hint: "Disable DMs for this account" },
    ],
  });
  next = setRootDmPolicy(next, dmPolicy);
  next = updateMixinAccountConfig(next, params.accountId, {
    dmPolicy,
  });

  if (dmPolicy === "allowlist") {
    next = await promptAllowFrom({ cfg: next, prompter: params.prompter, accountId: params.accountId });
  }

  const groupPolicy = await params.prompter.select<MixinGroupPolicy>({
    message: "Group policy",
    initialValue: normalizeGroupPolicy(current.groupPolicy),
    options: [
      { value: "open", label: "Open", hint: "Allow all configured group chats" },
      { value: "allowlist", label: "Allowlist", hint: "Only accept listed group chats" },
      { value: "disabled", label: "Disabled", hint: "Disable group access" },
    ],
  });
  next = updateMixinAccountConfig(next, params.accountId, {
    groupPolicy,
  });

  const addGroupAllowFrom = groupPolicy === "allowlist"
    ? await params.prompter.confirm({
        message: "Add initial group allowFrom entries now?",
        initialValue: true,
      })
    : false;
  if (addGroupAllowFrom) {
    const groupAllowFrom = String(
      await params.prompter.text({
        message: "Group allowFrom",
        placeholder: "conversation-id-one, conversation-id-two",
        validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
      }),
    )
      .split(/[\n,;]+/g)
      .map((entry) => entry.trim())
      .filter(Boolean);
    next = updateMixinAccountConfig(next, params.accountId, {
      groupAllowFrom,
    });
  }

  const mixpayEnabled = await params.prompter.confirm({
    message: "Enable MixPay for this account?",
    initialValue: Boolean(current.mixpay?.enabled),
  });
  if (mixpayEnabled) {
    next = updateMixinAccountConfig(next, params.accountId, {
      mixpay: {
        ...defaultMixpayConfig(current.mixpay),
        enabled: true,
      },
    });
  }

  return next;
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "Mixin",
  channel,
  policyKey: "channels.mixin.dmPolicy",
  allowFromKey: "channels.mixin.allowFrom",
  getCurrent: (cfg) => normalizeDmPolicy((cfg.channels?.mixin as { dmPolicy?: unknown } | undefined)?.dmPolicy),
  setPolicy: (cfg, policy) => setRootDmPolicy(cfg, policy as DmPolicy),
  promptAllowFrom,
};

export const mixinOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const accountIds = listAccountIds(cfg);
    const configured = accountIds.some((accountId) => resolveAccount(cfg, accountId).configured);
    return {
      channel,
      configured,
      statusLines: [
        `Mixin: ${configured ? "configured" : "needs credentials"}`,
        `Accounts: ${accountIds.length}`,
      ],
      selectionHint: configured ? "configured" : "Blaze WebSocket Mixin bridge",
      quickstartScore: configured ? 1 : 4,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds }) => {
    await promptAccountGuide(prompter);

    const mixinOverride = accountOverrides.mixin?.trim();
    const defaultAccountId = resolveDefaultAccountId(cfg);
    let accountId = mixinOverride || defaultAccountId;
    if (shouldPromptAccountIds && !mixinOverride) {
      accountId = await promptAccountId({
        cfg,
        prompter,
        label: "Mixin",
        currentId: accountId,
        listAccountIds,
        defaultAccountId,
      });
    }

    const next = await promptAccountConfig({ cfg, prompter, accountId });
    await prompter.outro(
      [
        `Configured account: ${accountId}`,
        "Restart the Gateway after saving the config.",
        "Use /mixin-status to verify the connection.",
      ].join("\n"),
    );

    return {
      cfg: next,
      accountId,
    };
  },
  dmPolicy,
};
