import { MixinApi } from "@mixin.dev/mixin-node-sdk";
import type { MixinAccountConfig } from "./config-schema.js";
import { buildRequestConfig } from "./proxy.js";

export type SendLog = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string, err?: unknown) => void;
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildClient(config: MixinAccountConfig) {
  return MixinApi({
    keystore: {
      app_id: config.appId!,
      session_id: config.sessionId!,
      server_public_key: config.serverPublicKey!,
      session_private_key: config.sessionPrivateKey!,
    },
    requestConfig: buildRequestConfig(config.proxy),
  });
}
