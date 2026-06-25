import type { Request, Response } from "express";
import express from "express";
import https from "https";
import http from "http";
import { homepageLogger } from "../../utils/logger.js";

export const homepageRssRouter = express.Router();

const rssCache = new Map<string, { data: RssItem[]; expires: number }>();
const CACHE_TTL_MS = 1000 * 60 * 15; // 15 minutes
const CACHE_SIZE = 50;
const FETCH_TIMEOUT_MS = 8000;

interface RssItem {
  title: string;
  link: string;
  pubDate: string | null;
  description: string | null;
}

function fetchXml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { timeout: FETCH_TIMEOUT_MS }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("RSS fetch timeout"));
    });
  });
}

function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  const getText = (tag: string, src: string): string | null => {
    const m = new RegExp(
      `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
      "i",
    ).exec(src);
    if (!m) return null;
    return (m[1] ?? m[2]).trim();
  };

  const getLink = (src: string): string => {
    // Self-closing <link rel="alternate" href="..." /> (BBC style)
    const selfClose = /<link[^>]+href="([^"]+)"[^>]*\/?>/i.exec(src);
    if (selfClose) return selfClose[1];
    // Plain text <link>url</link>
    return getText("link", src) ?? "";
  };

  while ((match = itemRegex.exec(xml)) !== null) {
    const src = match[1];
    items.push({
      title: getText("title", src) ?? "(no title)",
      link: getLink(src),
      pubDate: getText("pubDate", src) ?? getText("updated", src),
      description: getText("description", src) ?? getText("summary", src),
    });
    if (items.length >= 50) break;
  }

  // Atom feed fallback
  if (items.length === 0) {
    const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
    while ((match = entryRegex.exec(xml)) !== null) {
      const src = match[1];
      const linkMatch = /<link[^>]+href="([^"]+)"/.exec(src);
      items.push({
        title: getText("title", src) ?? "(no title)",
        link: linkMatch?.[1] ?? "",
        pubDate: getText("published", src) ?? getText("updated", src),
        description: getText("summary", src) ?? getText("content", src),
      });
      if (items.length >= 50) break;
    }
  }

  return items;
}

/**
 * @openapi
 * /homepage/rss:
 *   get:
 *     summary: Proxy and parse an RSS/Atom feed
 *     tags:
 *       - Homepage
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: max
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Array of feed items.
 *       400:
 *         description: Invalid or missing URL.
 *       500:
 *         description: Failed to fetch or parse the feed.
 */
homepageRssRouter.get("/", async (req: Request, res: Response) => {
  const feedUrl = req.query.url as string;
  const max = Math.min(50, Math.max(1, Number(req.query.max) || 10));

  if (!feedUrl) return res.status(400).json({ error: "url is required" });

  try {
    new URL(feedUrl);
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  const cached = rssCache.get(feedUrl);
  if (cached && cached.expires > Date.now()) {
    return res.json(cached.data.slice(0, max));
  }

  try {
    const xml = await fetchXml(feedUrl);
    const items = parseRss(xml);

    if (rssCache.size >= CACHE_SIZE) {
      const oldest = rssCache.keys().next().value;
      if (oldest) rssCache.delete(oldest);
    }
    rssCache.set(feedUrl, { data: items, expires: Date.now() + CACHE_TTL_MS });

    res.json(items.slice(0, max));
  } catch (err) {
    homepageLogger.warn("Failed to fetch RSS feed", { feedUrl });
    res.status(500).json({ error: "Failed to fetch feed" });
  }
});
