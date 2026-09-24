import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";

const FETCH_TIMEOUT_MS = 8000;
const MAX_FAVICON_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_CACHE_TTL_SECONDS = 24 * 60 * 60;

interface RssItem {
  title: string;
  link: string;
  pubDate: string | null;
  description: string | null;
}

async function readBufferLimited(
  response: globalThis.Response,
  maxBytes: number,
): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Response exceeds ${maxBytes} bytes`);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`Response exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

async function readTextLimited(
  response: globalThis.Response,
  maxBytes: number,
): Promise<string> {
  const buffer = await readBufferLimited(response, maxBytes);
  return buffer.toString("utf8");
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
 * The favicon, RSS, ping and proxy routes all make outbound requests. Every
 * one goes through ctx.fetch, which keeps the existing safe-outbound rules
 * (http/https only, no embedded credentials, DNS pinned, private and
 * loopback addresses refused).
 */
export function registerOutboundRoutes(
  router: Router,
  ctx: PluginContext,
): void {
  const faviconCache = new Map<
    string,
    { data: Buffer; contentType: string; expires: number }
  >();
  const FAVICON_CACHE_SIZE = 100;
  const FAVICON_CACHE_TTL_MS = 1000 * 60 * 60 * 24;

  const rssCache = new Map<string, { data: RssItem[]; expires: number }>();
  const RSS_CACHE_SIZE = 50;
  const RSS_CACHE_TTL_MS = 1000 * 60 * 15;

  interface PingCacheEntry {
    ok: boolean;
    statusCode: number | null;
    latencyMs: number;
    expires: number;
  }
  const pingCache = new Map<string, PingCacheEntry>();
  const PING_CACHE_SIZE = 200;

  const proxyCache = new Map<string, { data: unknown; expires: number }>();
  const PROXY_CACHE_SIZE = 50;

  /**
   * @openapi
   * /plugin-api/homepage/favicon:
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
  router.get("/favicon", async (req: Request, res: Response) => {
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
      const response = await ctx.fetch(faviconUrl, {
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      if (!response.ok)
        throw new Error(`Favicon fetch failed: ${response.status}`);
      const data = await readBufferLimited(response, MAX_FAVICON_BYTES);
      const contentType =
        response.headers.get("content-type") || "image/x-icon";

      if (faviconCache.size >= FAVICON_CACHE_SIZE) {
        const oldest = faviconCache.keys().next().value;
        if (oldest) faviconCache.delete(oldest);
      }
      faviconCache.set(domain, {
        data,
        contentType,
        expires: Date.now() + FAVICON_CACHE_TTL_MS,
      });
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(data);
    } catch {
      ctx.log.warn(`Failed to fetch favicon for ${domain}`);
      res.status(500).json({ error: "Failed to fetch favicon" });
    }
  });

  /**
   * @openapi
   * /plugin-api/homepage/rss:
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
  router.get("/rss", async (req: Request, res: Response) => {
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
      const response = await ctx.fetch(feedUrl, {
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      if (!response.ok) throw new Error(`RSS fetch failed: ${response.status}`);
      const xml = await readTextLimited(response, MAX_RESPONSE_BYTES);
      const items = parseRss(xml);

      if (rssCache.size >= RSS_CACHE_SIZE) {
        const oldest = rssCache.keys().next().value;
        if (oldest) rssCache.delete(oldest);
      }
      rssCache.set(feedUrl, {
        data: items,
        expires: Date.now() + RSS_CACHE_TTL_MS,
      });

      res.json(items.slice(0, max));
    } catch {
      ctx.log.warn(`Failed to fetch RSS feed ${feedUrl}`);
      res.status(500).json({ error: "Failed to fetch feed" });
    }
  });

  /**
   * @openapi
   * /plugin-api/homepage/ping:
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
  router.get("/ping", async (req: Request, res: Response) => {
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

    const requestStatus = async (
      url: string,
      method: "HEAD" | "GET",
    ): Promise<number | null> => {
      const response = await ctx.fetch(url, {
        method,
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      await response.body?.cancel().catch(() => {});
      return response.status ?? null;
    };

    const start = performance.now();
    try {
      let code = await requestStatus(targetUrl, "HEAD");
      if (code === 405) {
        code = await requestStatus(targetUrl, "GET");
      }
      const result = {
        ok: code !== null && code < 400,
        statusCode: code,
        latencyMs: Math.round(performance.now() - start),
      };
      if (pingCache.size >= PING_CACHE_SIZE) {
        const oldest = pingCache.keys().next().value;
        if (oldest) pingCache.delete(oldest);
      }
      pingCache.set(targetUrl, { ...result, expires: Date.now() + ttl });
      res.json(result);
    } catch (err) {
      ctx.log.warn(`Ping failed for ${targetUrl}: ${String(err)}`);
      res.status(500).json({ error: "Ping failed" });
    }
  });

  /**
   * @openapi
   * /plugin-api/homepage/proxy:
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
  router.get("/proxy", async (req: Request, res: Response) => {
    const targetUrl = req.query.url as string;
    const ttl =
      Math.min(
        MAX_CACHE_TTL_SECONDS,
        Math.max(10, Number(req.query.ttl) || 60),
      ) * 1000;

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
      const response = await ctx.fetch(targetUrl, {
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      if (!response.ok)
        throw new Error(`Proxy fetch failed: ${response.status}`);
      const text = await readTextLimited(response, MAX_RESPONSE_BYTES);
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Response is not valid JSON");
      }

      if (proxyCache.size >= PROXY_CACHE_SIZE) {
        const oldest = proxyCache.keys().next().value;
        if (oldest) proxyCache.delete(oldest);
      }
      proxyCache.set(targetUrl, { data, expires: Date.now() + ttl });
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log.warn(`Proxy fetch failed for ${targetUrl}: ${msg}`);
      if (msg.includes("not valid JSON")) {
        return res.status(400).json({ error: "Response is not valid JSON" });
      }
      res.status(500).json({ error: "Failed to fetch URL" });
    }
  });
}
