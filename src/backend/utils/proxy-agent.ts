import { HttpsProxyAgent } from "https-proxy-agent";
import type { Agent } from "http";

export function getProxyAgent(targetUrl?: string): Agent | undefined {
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

  return new HttpsProxyAgent(proxyUrl);
}
