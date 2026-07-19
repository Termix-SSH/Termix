import type { Request } from "express";
import type { IncomingMessage } from "http";

function firstHeaderValue(value: string | string[] | undefined): string {
  if (!value) return "";
  const raw = Array.isArray(value) ? value[0] : value;
  return raw.split(",")[0].trim();
}

function normalizePort(value: string | string[] | undefined): string {
  const raw = firstHeaderValue(value);
  if (!/^\d+$/.test(raw)) return "";

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "";

  return String(port);
}

function splitHostHeader(value: string | string[] | undefined): {
  host: string;
  port: string;
} {
  const raw = firstHeaderValue(value) || "localhost";

  if (raw.startsWith("[")) {
    const match = raw.match(/^(\[[^\]]+\])(?::(.+))?$/);
    return {
      host: match?.[1] || raw,
      port: normalizePort(match?.[2]),
    };
  }

  const parts = raw.split(":");
  if (parts.length === 2) {
    return {
      host: parts[0] || "localhost",
      port: normalizePort(parts[1]),
    };
  }

  return {
    host: raw,
    port: "",
  };
}

export function normalizeBasePath(value: unknown): string {
  if (typeof value !== "string") return "";
  let basePath = value.split(",")[0].trim();
  if (!basePath) return "";

  try {
    if (/^https?:\/\//i.test(basePath)) {
      basePath = new URL(basePath).pathname;
    }
  } catch {
    return "";
  }

  basePath = basePath.split("?")[0].split("#")[0].trim();
  if (!basePath || basePath === "/") return "";
  if (!basePath.startsWith("/")) basePath = `/${basePath}`;
  return basePath.replace(/\/+$/, "");
}

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

  let port = normalizePort(req.headers["x-forwarded-port"]);
  const { host, port: hostPort } = splitHostHeader(
    req.headers["x-forwarded-host"] || req.headers.host,
  );
  port ||= hostPort;

  if (port) {
    const isDefaultPort =
      (protocol === "http" && port === "80") ||
      (protocol === "https" && port === "443");

    return isDefaultPort
      ? `${protocol}://${host}`
      : `${protocol}://${host}:${port}`;
  }

  return `${protocol}://${host}`;
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

export function getRequestBasePath(req: Request | IncomingMessage): string {
  const envBasePath = normalizeBasePath(
    process.env.BASE_PATH || process.env.VITE_BASE_PATH,
  );
  if (envBasePath) return envBasePath;

  return (
    normalizeBasePath(firstHeaderValue(req.headers["x-forwarded-prefix"])) ||
    normalizeBasePath(firstHeaderValue(req.headers["x-script-name"])) ||
    normalizeBasePath(firstHeaderValue(req.headers["x-original-prefix"]))
  );
}

export function getRequestBaseUrl(req: Request | IncomingMessage): string {
  return `${getRequestOrigin(req)}${getRequestBasePath(req)}`;
}

export function getRequestBaseUrlWithForceHTTPS(
  req: Request | IncomingMessage,
): string {
  return `${getRequestOriginWithForceHTTPS(req)}${getRequestBasePath(req)}`;
}
