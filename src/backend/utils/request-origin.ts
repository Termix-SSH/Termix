import type { Request } from "express";
import type { IncomingMessage } from "http";

export function getRequestOrigin(req: Request | IncomingMessage): string {
  let protocol: string;
  const protoHeader = req.headers["x-forwarded-proto"];

  if (protoHeader) {
    const raw =
      typeof protoHeader === "string"
        ? protoHeader.split(",")[0].trim()
        : protoHeader[0];
    // Normalize WebSocket protocols to their HTTP equivalents
    protocol = raw === "wss" ? "https" : raw === "ws" ? "http" : raw;
  } else if ("protocol" in req && req.protocol) {
    protocol = req.protocol;
  } else {
    protocol = (req.socket as unknown as { encrypted?: boolean }).encrypted
      ? "https"
      : "http";
  }

  const portHeader = req.headers["x-forwarded-port"];
  let port: string | undefined =
    typeof portHeader === "string"
      ? portHeader.split(",")[0].trim()
      : undefined;

  const hostHeaderRaw =
    req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const hostHeader =
    typeof hostHeaderRaw === "string"
      ? hostHeaderRaw.split(",")[0].trim()
      : String(hostHeaderRaw);

  if (!port && hostHeader.includes(":")) {
    const parts = hostHeader.split(":");
    if (parts.length === 2 && !parts[0].includes("[")) {
      port = parts[1];
    }
  }

  const hostWithoutPort = hostHeader.split(":")[0];
  if (port) {
    const isDefaultPort =
      (protocol === "http" && port === "80") ||
      (protocol === "https" && port === "443");

    return isDefaultPort
      ? `${protocol}://${hostWithoutPort}`
      : `${protocol}://${hostWithoutPort}:${port}`;
  }

  return `${protocol}://${hostWithoutPort}`;
}

export function getRequestOriginWithForceHTTPS(
  req: Request | IncomingMessage,
): string {
  if (process.env.OIDC_FORCE_HTTPS === "true") {
    const origin = getRequestOrigin(req);
    return origin.replace(/^http:/, "https:");
  }
  return getRequestOrigin(req);
}
