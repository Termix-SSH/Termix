import type { Request, Response } from "express";
import express from "express";
import https from "https";
import http from "http";
import { lookup } from "dns/promises";
import { BlockList, isIP } from "net";
import { homepageLogger } from "../../utils/logger.js";

export const homepageProxyRouter = express.Router();

interface ProxyCacheEntry {
  data: unknown;
  expires: number;
}

const proxyCache = new Map<string, ProxyCacheEntry>();
const CACHE_SIZE = 50;
const FETCH_TIMEOUT_MS = 8000;

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  return (
    family === 0 ||
    blockedAddresses.check(address, family === 4 ? "ipv4" : "ipv6")
  );
}

async function resolvePublicUrl(rawUrl: string): Promise<{
  url: URL;
  address: string;
}> {
  const url = new URL(rawUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Invalid URL");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isBlockedAddress(address))
  ) {
    throw new Error("Private destinations are not allowed");
  }

  return { url, address: addresses[0].address };
}

async function fetchJson(rawUrl: string): Promise<unknown> {
  const { url, address } = await resolvePublicUrl(rawUrl);
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.get(
      {
        protocol: url.protocol,
        hostname: address,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        headers: { Host: url.host },
        servername: url.protocol === "https:" ? url.hostname : undefined,
        timeout: FETCH_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const text = Buffer.concat(chunks).toString("utf-8");
            resolve(JSON.parse(text));
          } catch {
            reject(new Error("Response is not valid JSON"));
          }
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Fetch timeout"));
    });
  });
}

/**
 * @openapi
 * /homepage/proxy:
 *   get:
 *     summary: Proxy a JSON API URL and return the parsed response
 *     tags:
 *       - Homepage
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: ttl
 *         schema:
 *           type: integer
 *           description: Cache TTL in seconds (min 10, default 60)
 *     responses:
 *       200:
 *         description: The JSON body returned by the target URL.
 *       400:
 *         description: Invalid or missing URL, or non-JSON response.
 *       500:
 *         description: Failed to fetch the target URL.
 */
homepageProxyRouter.get("/", async (req: Request, res: Response) => {
  const targetUrl = req.query.url as string;
  const ttl = Math.max(10, Number(req.query.ttl) || 60) * 1000;

  if (!targetUrl) return res.status(400).json({ error: "url is required" });
  try {
    new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  const cached = proxyCache.get(targetUrl);
  if (cached && cached.expires > Date.now()) {
    return res.json(cached.data);
  }

  try {
    const data = await fetchJson(targetUrl);
    if (proxyCache.size >= CACHE_SIZE) {
      const oldest = proxyCache.keys().next().value;
      if (oldest) proxyCache.delete(oldest);
    }
    proxyCache.set(targetUrl, { data, expires: Date.now() + ttl });
    res.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    homepageLogger.warn("Proxy fetch failed", { targetUrl, msg });
    if (msg.includes("not valid JSON")) {
      return res.status(400).json({ error: "Response is not valid JSON" });
    }
    res.status(500).json({ error: "Failed to fetch URL" });
  }
});
