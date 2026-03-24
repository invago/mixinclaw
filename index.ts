import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { mixinPlugin } from "./src/channel.js";
import { setMixinRuntime } from "./src/runtime.js";

process.on("unhandledRejection", (reason, promise) => {
  console.error("[mixin] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[mixin] Uncaught Exception:", error);
});

const plugin = {
  id: "mixin",
  name: "Mixin Messenger Channel",
  description: "Mixin Messenger channel via Blaze WebSocket or HTTP Webhook",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi): void {
    setMixinRuntime(api.runtime);
    api.registerChannel({ plugin: mixinPlugin });
  },
};

export default plugin;
