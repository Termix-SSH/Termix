import type { NextFunction, Request, Response } from "express";
import { apiLogger } from "../utils/logger.js";

/**
 * Status of an error that is the caller's fault (bad JSON, body too large,
 * upload too big), or null. Upload errors from multer carry a code instead.
 */
const BAD_BODY =
  /^(Malformed part header|Unexpected end of form|Multipart: Boundary not found|Malformed urlencoded form)$/;

export function clientErrorStatus(error: unknown): number | null {
  const value = error as {
    status?: unknown;
    statusCode?: unknown;
    name?: unknown;
    code?: unknown;
  } | null;
  if (value?.name === "MulterError") {
    return value.code === "LIMIT_FILE_SIZE" ? 413 : 400;
  }
  // Multer hands on busboy's parse errors as plain errors: a bad body, not a fault.
  if (
    error instanceof Error &&
    BAD_BODY.test(error.message) &&
    /busboy|multer/.test(error.stack ?? "")
  ) {
    return 400;
  }
  const status = value?.status ?? value?.statusCode;
  return typeof status === "number" && status >= 400 && status < 500
    ? status
    : null;
}

const CLIENT_MESSAGES: Record<number, string> = {
  413: "Request is too large",
};

/**
 * Last error handler. The answer never carries the error text, a stack or a
 * path; those go to the log only.
 */
export function finalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  void _next;
  const status = clientErrorStatus(err);
  if (status === null) {
    apiLogger.error("Unhandled error in request", err, {
      operation: "error_handler",
      method: req.method,
      url: req.path,
      userAgent: req.get("User-Agent"),
    });
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  if (status !== null) {
    res
      .status(status)
      .json({ error: CLIENT_MESSAGES[status] ?? "Invalid request" });
    return;
  }
  res.status(500).json({ error: "Internal Server Error" });
}
