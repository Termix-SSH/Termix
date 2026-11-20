import type http from "node:http";
import type { Readable } from "node:stream";

/**
 * Feeds a body core streams to the plugin into the request rebuilt for its
 * router. The request is marked complete before it ends, as Node's HTTP
 * parser does: an IncomingMessage that ends incomplete is destroyed as
 * aborted, and a body parser still finishing, like multer, fails the upload.
 */
export function streamRequestBody(
  req: http.IncomingMessage,
  bodyPort: Readable,
): void {
  bodyPort.on("data", (chunk: Buffer) => {
    if (!req.push(chunk)) bodyPort.pause();
  });
  req._read = () => bodyPort.resume();
  bodyPort.on("end", () => {
    req.complete = true;
    req.push(null);
  });
  bodyPort.on("error", (error) => req.destroy(error));
}
