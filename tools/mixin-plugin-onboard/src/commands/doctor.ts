import { buildContext, checkWritableDir, findMixinPluginDirs, isPluginEnabled, readMixinConfig, resolveMixpayStorePaths, runFfprobeCheck } from "../utils.ts";

export async function runDoctor(): Promise<number> {
  const ctx = await buildContext();
  const pluginDirs = await findMixinPluginDirs(ctx.extensionsDir);
  const mixinConfig = readMixinConfig(ctx.config);
  const mixpay = mixinConfig && typeof mixinConfig.mixpay === "object"
    ? (mixinConfig.mixpay as Record<string, unknown>)
    : null;
  const mixpayStore = resolveMixpayStorePaths();
  const checks = [
    { label: "config_found", ok: Boolean(ctx.configPath) },
    { label: "mixin_config_present", ok: Boolean(mixinConfig) },
    { label: "plugin_enabled", ok: isPluginEnabled(ctx.config) },
    { label: "plugin_installed", ok: pluginDirs.length > 0 },
    { label: "outbox_writable", ok: await checkWritableDir(ctx.outboxDir) },
    { label: "mixpay_store_writable", ok: await checkWritableDir(mixpayStore.storeDir) },
    { label: "mixpay_config_complete", ok: !mixpay || mixpay.enabled !== true || (typeof mixpay.payeeId === "string" && mixpay.payeeId.trim().length > 0) },
    { label: "ffprobe_available", ok: runFfprobeCheck() },
  ];

  const stageDirs = pluginDirs.filter((dir) => dir.includes(".openclaw-install-stage-"));
  console.log(JSON.stringify({
    ok: checks.every((item) => item.ok),
    checks,
    stageDirs,
    pluginDirs,
    configPath: ctx.configPath,
    outboxDir: ctx.outboxDir,
    outboxFile: ctx.outboxFile,
    mixpayStoreDir: mixpayStore.storeDir,
    mixpayStoreFile: mixpayStore.storeFile,
  }, null, 2));

  return checks.every((item) => item.ok) ? 0 : 1;
}
