import type { OpenClawPluginApi, OpenClawConfig } from "openclaw/plugin-sdk";
import { mixinPlugin } from "./src/channel.js";
import {
  buildMixinAccountsText,
  buildMixinPluginDiagnostics,
  formatMixinHelpText,
  formatMixinSetupText,
  formatMixinStatusText,
  normalizeMixinSetupMode,
} from "./src/plugin-admin.js";
import { setMixinRuntime } from "./src/runtime.js";

process.on("unhandledRejection", (reason, promise) => {
  console.error("[mixin] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[mixin] Uncaught Exception:", error);
});

async function buildStatusText(cfg: OpenClawConfig): Promise<string> {
  const diagnostics = await buildMixinPluginDiagnostics(cfg);
  return formatMixinStatusText(cfg, diagnostics);
}

async function buildSetupText(cfg: OpenClawConfig, mode?: string): Promise<string> {
  const diagnostics = await buildMixinPluginDiagnostics(cfg);
  return formatMixinSetupText(cfg, diagnostics, normalizeMixinSetupMode(mode ?? ""));
}

const plugin = {
  id: "mixin",
  name: "Mixin Messenger Channel",
  description: "Mixin Messenger channel via Blaze WebSocket",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  register(api: OpenClawPluginApi): void {
    setMixinRuntime(api.runtime);
    api.registerChannel({ plugin: mixinPlugin });
    api.registerService({
      id: "mixin-diagnostics",
      start: () => api.logger.info("[mixin] diagnostics service ready"),
      stop: () => api.logger.info("[mixin] diagnostics service stopped"),
    });
    api.registerGatewayMethod("mixin.status", async ({ respond }) => {
      const cfg = api.config as OpenClawConfig;
      const diagnostics = await buildMixinPluginDiagnostics(cfg);
      respond(true, {
        status: formatMixinStatusText(cfg, diagnostics),
        diagnostics,
      });
    });
    api.registerGatewayMethod("mixin.accounts", async ({ respond }) => {
      const cfg = api.config as OpenClawConfig;
      respond(true, {
        accounts: buildMixinAccountsText(cfg),
      });
    });
    api.registerGatewayMethod("mixin.setup", async ({ respond }) => {
      const cfg = api.config as OpenClawConfig;
      respond(true, {
        setup: await buildSetupText(cfg),
      });
    });
    api.registerCommand({
      name: "setup",
      description: "Show Mixin setup guide",
      acceptsArgs: true,
      handler: async (ctx: { config: OpenClawConfig; args?: string }) => ({
        text: await buildSetupText(ctx.config, ctx.args),
      }),
    });
    api.registerCommand({
      name: "mixin-setup",
      description: "Show Mixin setup guide",
      acceptsArgs: true,
      handler: async (ctx: { config: OpenClawConfig; args?: string }) => ({
        text: await buildSetupText(ctx.config, ctx.args),
      }),
    });
    api.registerCommand({
      name: "mixin-status",
      description: "Show Mixin plugin status",
      handler: async (ctx: { config: OpenClawConfig }) => ({
        text: await buildStatusText(ctx.config),
      }),
    });
    api.registerCommand({
      name: "mixin-accounts",
      description: "List configured Mixin accounts",
      handler: async (ctx: { config: OpenClawConfig }) => ({
        text: buildMixinAccountsText(ctx.config),
      }),
    });
    api.registerCommand({
      name: "mixin-help",
      description: "Show Mixin plugin help",
      handler: async () => ({
        text: formatMixinHelpText(),
      }),
    });
  },
};

export default plugin;
