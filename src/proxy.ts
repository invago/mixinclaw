import type { RequestConfig } from "@mixin.dev/mixin-node-sdk";
import { ProxyAgent } from "proxy-agent";
import type { Agent } from "http";
import type { MixinProxyConfig } from "./config-schema.js";

export function buildProxyUrl(proxy?: MixinProxyConfig): string | undefined {
  if (!proxy?.enabled || !proxy.url) {
    return undefined;
  }

  const url = new URL(proxy.url);
  if (proxy.username) {
    url.username = proxy.username;
  }
  if (proxy.password) {
    url.password = proxy.password;
  }
  return url.toString();
}

export function createProxyAgent(proxy?: MixinProxyConfig): Agent | undefined {
  const proxyUrl = buildProxyUrl(proxy);
  if (!proxyUrl) {
    return undefined;
  }
  return new ProxyAgent({
    getProxyForUrl: () => proxyUrl,
  }) as Agent;
}

export function buildRequestConfig(proxy?: MixinProxyConfig): RequestConfig | undefined {
  const agent = createProxyAgent(proxy);
  if (!agent) {
    return undefined;
  }

  return {
    proxy: false,
    httpAgent: agent,
    httpsAgent: agent,
  };
}
