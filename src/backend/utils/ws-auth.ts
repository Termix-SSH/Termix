import type { IncomingMessage } from "http";

const JWT_PROTOCOL_PREFIX = "termix.jwt.";

export function extractWebSocketToken(
  req: IncomingMessage,
): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
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
