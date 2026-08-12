import compression from "compression";
import type { Request, Response } from "express";
import type { RequestHandler } from "express";

/**
 * Below this, compressing costs more than it saves.
 *
 * The default is 1KB; this is slightly higher because almost every response
 * under a few KB here is a small status or preference object where the CPU and
 * the extra headers are not worth it. The payloads that matter — host lists,
 * audit pages, fleet inventories — are orders of magnitude above this.
 */
const MIN_RESPONSE_BYTES = 2048;

/**
 * Streaming endpoints that must not be buffered.
 *
 * Compression holds bytes back to build a block, which is exactly wrong for a
 * response whose value is arriving incrementally: SSE heartbeats and download
 * streams would stall until the buffer filled or the request ended.
 */
function isStreamingResponse(res: Response): boolean {
  const contentType = String(res.getHeader("Content-Type") ?? "");
  return (
    contentType.includes("text/event-stream") ||
    contentType.includes("application/octet-stream")
  );
}

/**
 * gzip for JSON API responses.
 *
 * The host list is the reason this exists: it is one big JSON array whose rows
 * repeat the same ~77 keys, so it compresses about 69x. Without this an install
 * with a few thousand hosts ships tens of megabytes per refresh.
 *
 * Deliberately not brotli: it compresses better but costs noticeably more CPU
 * per response, and the difference matters far less than the 60x that gzip
 * already recovers.
 */
export function createCompressionMiddleware(): RequestHandler {
  return compression({
    threshold: MIN_RESPONSE_BYTES,
    filter: (req: Request, res: Response) => {
      // Lets a caller opt out explicitly, which is useful when debugging.
      if (req.headers["x-no-compression"]) return false;
      if (isStreamingResponse(res)) return false;
      return compression.filter(req, res);
    },
  });
}
