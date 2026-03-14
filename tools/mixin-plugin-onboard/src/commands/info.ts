import { buildContext, findMixinPluginDirs, isPluginEnabled, readMixinConfig, runFfprobeCheck } from "../utils.ts";

export async function runInfo(): Promise<number> {
  const ctx = await buildContext();
  const pluginDirs = await findMixinPluginDirs(ctx.extensionsDir);
  const mixinConfig = readMixinConfig(ctx.config);

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
    ffprobeAvailable: runFfprobeCheck(),
  }, null, 2));

  return 0;
}
