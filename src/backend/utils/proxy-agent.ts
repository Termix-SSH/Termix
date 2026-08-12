import { Agent, ProxyAgent } from "undici";
import type { Dispatcher } from "undici-types";

const directAgent = new Agent({
  connect: {
    autoSelectFamily: true,
    autoSelectFamilyAttemptTimeout: 250,
  },
});

export function getProxyAgent(targetUrl?: string): Dispatcher | undefined {
  const proxyUrl =
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY;

  if (!proxyUrl) return undefined;

  if (targetUrl) {
    const noProxy = process.env.no_proxy || process.env.NO_PROXY || "";
    const hostname = new URL(targetUrl).hostname.toLowerCase();

    for (const entry of noProxy.split(",")) {
      const trimmed = entry.trim().toLowerCase();
      if (!trimmed) continue;

      const normalized = trimmed.replace(/^\*\./, "").replace(/^\./, "");

      if (hostname === normalized || hostname.endsWith(`.${normalized}`)) {
        return undefined;
      }
    }
  }

  return new ProxyAgent(proxyUrl) as unknown as Dispatcher;
}

export function getFetchDispatcher(targetUrl: string): Dispatcher {
  return getProxyAgent(targetUrl) ?? (directAgent as unknown as Dispatcher);
}
