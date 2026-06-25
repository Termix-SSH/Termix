import type { Request, Response } from "express";
import { homepageLogger } from "../../utils/logger.js";
import express from "express";
import https from "https";
import http from "http";

export const homepageFaviconRouter = express.Router();

// Simple LRU cache: url -> { data: Buffer, contentType: string, expires: number }
const faviconCache = new Map<
  string,
  { data: Buffer; contentType: string; expires: number }
>();
const CACHE_SIZE = 100;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

function evictIfNeeded() {
  if (faviconCache.size >= CACHE_SIZE) {
    const oldest = faviconCache.keys().next().value;
    if (oldest) faviconCache.delete(oldest);
  }
}

function fetchUrl(url: string): Promise<{ data: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { timeout: 5000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          data: Buffer.concat(chunks),
          contentType: res.headers["content-type"] || "image/x-icon",
        });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Favicon fetch timeout"));
    });
  });
}

/**
 * @openapi
 * /homepage/favicon:
 *   get:
 *     summary: Proxy favicon fetch
 *     description: Fetches and caches a site favicon server-side to avoid CORS issues.
 *     tags:
 *       - Homepage
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Favicon image.
 *       400:
 *         description: Invalid URL.
 *       500:
 *         description: Failed to fetch favicon.
 */
homepageFaviconRouter.get("/", async (req: Request, res: Response) => {
  const rawUrl = req.query.url as string;
  if (!rawUrl) return res.status(400).json({ error: "url is required" });

  let domain: string;
  try {
    domain = new URL(rawUrl).hostname;
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  const cached = faviconCache.get(domain);
  if (cached && cached.expires > Date.now()) {
    res.setHeader("Content-Type", cached.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(cached.data);
  }

  const faviconUrl = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(domain)}`;

  try {
    const { data, contentType } = await fetchUrl(faviconUrl);
    evictIfNeeded();
    faviconCache.set(domain, {
      data,
      contentType,
      expires: Date.now() + CACHE_TTL_MS,
    });
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(data);
  } catch (err) {
    homepageLogger.warn("Failed to fetch favicon", { domain });
    res.status(500).json({ error: "Failed to fetch favicon" });
  }
});
