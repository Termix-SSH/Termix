import { getErrorMessage } from "../../utils/error-message.js";
import express, { type Request, type Response } from "express";
import { homepageLogger } from "../../utils/logger.js";
import {
  readResponseTextLimited,
  safeOutboundFetch,
} from "../../utils/safe-outbound-fetch.js";

export const homepageProxyRouter = express.Router();

interface ProxyCacheEntry {
  data: unknown;
  expires: number;
}

const proxyCache = new Map<string, ProxyCacheEntry>();
const CACHE_SIZE = 50;
const FETCH_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_CACHE_TTL_SECONDS = 24 * 60 * 60;

async function fetchJson(rawUrl: string): Promise<unknown> {
  const response = await safeOutboundFetch(rawUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Proxy fetch failed: ${response.status}`);
  const text = await readResponseTextLimited(response, MAX_RESPONSE_BYTES);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Response is not valid JSON");
  }
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
  const ttl =
    Math.min(MAX_CACHE_TTL_SECONDS, Math.max(10, Number(req.query.ttl) || 60)) *
    1000;

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
    const msg = getErrorMessage(err);
    homepageLogger.warn("Proxy fetch failed", { targetUrl, msg });
    if (msg.includes("not valid JSON")) {
      return res.status(400).json({ error: "Response is not valid JSON" });
    }
    res.status(500).json({ error: "Failed to fetch URL" });
  }
});
