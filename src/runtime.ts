import type { PluginRuntime } from "openclaw/plugin-sdk";
import type { MixinSupportedMessageCategory } from "./send-service.js";

let runtime: PluginRuntime | null = null;
const blazeSenders = new Map<string, MixinBlazeSender>();

export type MixinBlazeOutboundMessage = {
  conversationId: string;
  messageId: string;
  category: MixinSupportedMessageCategory;
  dataBase64: string;
};

export type MixinBlazeSender = (message: MixinBlazeOutboundMessage) => Promise<void>;

export function setMixinRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getMixinRuntime(): PluginRuntime {
  if (!runtime) throw new Error("Mixin runtime not initialized");
  return runtime;
}

export function setMixinBlazeSender(accountId: string, sender: MixinBlazeSender | null): void {
  if (!accountId.trim()) {
    return;
  }
  if (sender) {
    blazeSenders.set(accountId, sender);
    return;
  }
  blazeSenders.delete(accountId);
}

export function getMixinBlazeSender(accountId: string): MixinBlazeSender | null {
  return blazeSenders.get(accountId) ?? null;
}
