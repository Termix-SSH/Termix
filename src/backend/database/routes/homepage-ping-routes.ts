import type { Request, Response } from "express";
import express from "express";
import https from "https";
import http from "http";
import { homepageLogger } from "../../utils/logger.js";

export const homepagePingRouter = express.Router();

interface PingCacheEntry {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  expires: number;
}

const pingCache = new Map<string, PingCacheEntry>();
const CACHE_SIZE = 200;
const FETCH_TIMEOUT_MS = 5000;

function pingUrl(
  url: string,
): Promise<{ ok: boolean; statusCode: number | null; latencyMs: number }> {
  return new Promise((resolve) => {
    const start = performance.now();
    const mod = url.startsWith("https") ? https : http;

    const done = (ok: boolean, statusCode: number | null) => {
      resolve({
        ok,
        statusCode,
        latencyMs: Math.round(performance.now() - start),
      });
    };

    const tryGet = () => {
      const req = mod.get(url, { timeout: FETCH_TIMEOUT_MS }, (res) => {
        res.resume();
        const code = res.statusCode ?? null;
        done(code !== null && code < 400, code);
      });
      req.on("error", () => done(false, null));
      req.on("timeout", () => {
        req.destroy();
        done(false, null);
      });
    };

    const req = mod.request(
      url,
      { method: "HEAD", timeout: FETCH_TIMEOUT_MS },
      (res) => {
        res.resume();
        const code = res.statusCode ?? null;
        if (code === 405) {
          tryGet();
        } else {
          done(code !== null && code < 400, code);
        }
      },
    );
    req.on("error", () => done(false, null));
    req.on("timeout", () => {
      req.destroy();
      done(false, null);
    });
    req.end();
  });
}

/**
 * @openapi
 * /homepage/ping:
 *   get:
 *     summary: Check the HTTP reachability and latency of a URL
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
 *           description: Cache TTL in seconds (min 10)
 *     responses:
 *       200:
 *         description: Ping result with ok, statusCode and latencyMs.
 *       400:
 *         description: Invalid or missing URL.
 */
homepagePingRouter.get("/", async (req: Request, res: Response) => {
  let targetUrl = req.query.url as string;
  const ttl = Math.max(10, Number(req.query.ttl) || 30) * 1000;

  if (!targetUrl) return res.status(400).json({ error: "url is required" });
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = `https://${targetUrl}`;
  try {
    new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  const cached = pingCache.get(targetUrl);
  if (cached && cached.expires > Date.now()) {
    return res.json({
      ok: cached.ok,
      statusCode: cached.statusCode,
      latencyMs: cached.latencyMs,
    });
  }

  try {
    const result = await pingUrl(targetUrl);
    if (pingCache.size >= CACHE_SIZE) {
      const oldest = pingCache.keys().next().value;
      if (oldest) pingCache.delete(oldest);
    }
    pingCache.set(targetUrl, { ...result, expires: Date.now() + ttl });
    res.json(result);
  } catch (err) {
    homepageLogger.warn("Ping failed", { targetUrl });
    res.status(500).json({ error: "Ping failed" });
  }
});
