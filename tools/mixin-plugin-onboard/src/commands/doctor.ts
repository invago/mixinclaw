import { buildContext, checkWritableDir, findMixinPluginDirs, isPluginEnabled, readMixinConfig, runFfprobeCheck } from "../utils.ts";

export async function runDoctor(): Promise<number> {
  const ctx = await buildContext();
  const pluginDirs = await findMixinPluginDirs(ctx.extensionsDir);
  const mixinConfig = readMixinConfig(ctx.config);
  const checks = [
    { label: "config_found", ok: Boolean(ctx.configPath) },
    { label: "mixin_config_present", ok: Boolean(mixinConfig) },
    { label: "plugin_enabled", ok: isPluginEnabled(ctx.config) },
    { label: "plugin_installed", ok: pluginDirs.length > 0 },
    { label: "outbox_writable", ok: await checkWritableDir(ctx.outboxDir) },
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
  }, null, 2));

  return checks.every((item) => item.ok) ? 0 : 1;
}
