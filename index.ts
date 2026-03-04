import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { mixinPlugin } from "./src/channel.js";
import { setMixinRuntime } from "./src/runtime.js";

// 全局错误处理
process.on('unhandledRejection', (reason, promise) => {
  console.error('[mixin] Unhandled Rejection at:', promise, 'reason:', reason);
  // 但不退出进程，让OpenClaw处理
});

process.on('uncaughtException', (error) => {
  console.error('[mixin] Uncaught Exception:', error);
  // 但不退出进程，让OpenClaw处理
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
