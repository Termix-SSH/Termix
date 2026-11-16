/**
 * Pictures from other sites for plugin views. A plugin frame may load
 * images only from its own assets, data: and blob: URLs, so nothing it shows
 * can carry data to another origin. It fetches a remote picture through
 * GET /plugins/:id/image instead: the server gets it, checks it really is an
 * image and hands back the bytes, which the frame shows from a blob: URL.
 *
 * Only for a plugin that may reach other sites anyway (network:outbound or
 * network:sockets). LAN addresses work, as they do for ctx.fetch with a
 * private host allowed; this machine itself and cloud metadata never do.
 */
import { isIP } from "node:net";
import {
  isLoopbackAddress,
  safeOutboundFetch,
} from "../utils/safe-outbound-fetch.js";

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;

export class ImageProxyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Fetch = typeof safeOutboundFetch;

function checkUrl(raw: unknown): URL {
  if (typeof raw !== "string" || raw.length > 4096) {
    throw new ImageProxyError("A picture needs an http or https address", 400);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageProxyError("A picture needs an http or https address", 400);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username) {
    throw new ImageProxyError("A picture needs an http or https address", 400);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isLoopbackAddress(host)) {
    throw new ImageProxyError("This address is not allowed", 403);
  }
  return url;
}

async function readLimited(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
    throw new ImageProxyError("The picture is too large", 413);
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > IMAGE_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ImageProxyError("The picture is too large", 413);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function fetchImage(
  raw: unknown,
  fetchImpl: Fetch = safeOutboundFetch,
): Promise<{ type: string; body: Buffer }> {
  let url = checkUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    let response: Response;
    try {
      response = await fetchImpl(
        url.href,
        {
          method: "GET",
          redirect: "manual",
          headers: { accept: "image/*" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
        [host],
        {},
        TIMEOUT_MS,
        isLoopbackAddress,
      );
    } catch (error) {
      if (error instanceof ImageProxyError) throw error;
      throw new ImageProxyError("The picture could not be loaded", 502);
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => {});
      url = checkUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new ImageProxyError("The picture could not be loaded", 502);
    }
    const type = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!/^image\/[a-z0-9.+-]+$/.test(type)) {
      await response.body?.cancel().catch(() => {});
      throw new ImageProxyError("That address is not a picture", 415);
    }
    return { type, body: await readLimited(response) };
  }
  throw new ImageProxyError("Too many redirects", 502);
}
