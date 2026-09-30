import type { IncomingMessage } from "http";

const JWT_PROTOCOL_PREFIX = "termix.jwt.";

/**
 * A browser attaches the jwt cookie to a socket opened from any page on the
 * same site, including a sibling subdomain. The cookie only counts when the
 * page that opened the socket is this server. A non-web origin (the desktop
 * app) or no Origin at all is not a browser page on another host.
 */
export function isCookieOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
  const hosts = [req.headers.host, req.headers["x-forwarded-host"]]
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.includes(parsed.host.toLowerCase())) return true;
  // The Vite dev proxy rewrites Host, so loopback to loopback is allowed.
  if (
    isLoopback(parsed.hostname) &&
    hosts.some((host) => isLoopback(host.replace(/:\d+$/, "")))
  ) {
    return true;
  }
  return (process.env.TERMIX_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .includes(parsed.origin.toLowerCase());
}

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

export function extractWebSocketToken(
  req: IncomingMessage,
): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (cookieHeader && isCookieOriginAllowed(req)) {
    const match = cookieHeader.match(/(?:^|;\s*)jwt=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }

  const protocols = String(req.headers["sec-websocket-protocol"] || "")
    .split(",")
    .map((protocol) => protocol.trim());
  const jwtProtocol = protocols.find((protocol) =>
    protocol.startsWith(JWT_PROTOCOL_PREFIX),
  );
  return jwtProtocol?.slice(JWT_PROTOCOL_PREFIX.length);
}
