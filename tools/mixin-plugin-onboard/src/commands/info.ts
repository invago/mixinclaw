import { buildContext, findMixinPluginDirs, isPluginEnabled, readMixinConfig, resolveMixpayStorePaths, runFfprobeCheck } from "../utils.ts";

export async function runInfo(): Promise<number> {
  const ctx = await buildContext();
  const pluginDirs = await findMixinPluginDirs(ctx.extensionsDir);
  const mixinConfig = readMixinConfig(ctx.config);
  const mixpay = mixinConfig && typeof mixinConfig.mixpay === "object"
    ? (mixinConfig.mixpay as Record<string, unknown>)
    : null;
  const mixpayStore = resolveMixpayStorePaths();

  console.log(JSON.stringify({
    homeDir: ctx.homeDir,
    stateDir: ctx.stateDir,
    extensionsDir: ctx.extensionsDir,
    configPath: ctx.configPath,
    pluginDirs,
    pluginEnabled: isPluginEnabled(ctx.config),
    mixinConfigured: Boolean(mixinConfig),
    defaultAccount: typeof mixinConfig?.defaultAccount === "string" ? mixinConfig.defaultAccount : "default",
    outboxDir: ctx.outboxDir,
    outboxFile: ctx.outboxFile,
    mixpayEnabled: mixpay?.enabled === true,
    mixpayPayeeId: typeof mixpay?.payeeId === "string" ? mixpay.payeeId : null,
    mixpayStoreDir: mixpayStore.storeDir,
    mixpayStoreFile: mixpayStore.storeFile,
    ffprobeAvailable: runFfprobeCheck(),
  }, null, 2));

  return 0;
}
