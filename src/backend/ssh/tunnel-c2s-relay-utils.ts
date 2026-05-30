import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import type { ClientChannel } from "ssh2";
import type { WebSocket } from "ws";

const C2S_WS_HIGH_WATERMARK = 1024 * 1024;
const C2S_WS_LOW_WATERMARK = 256 * 1024;
const C2S_STREAM_WRITE_LIMIT = 8 * 1024 * 1024;

export function extractRequestToken(req: IncomingMessage): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)jwt=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }

  return undefined;
}

export function sendC2SError(ws: WebSocket, message: string): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "error", error: message }));
  }
}

export function describeC2SRelayError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("administratively prohibited") ||
    lowerMessage.includes("forwarding disabled") ||
    lowerMessage.includes("open failed")
  ) {
    return `SSH forwarding was rejected by the endpoint server: ${message}`;
  }
  if (
    lowerMessage.includes("address already in use") ||
    lowerMessage.includes("unable to bind") ||
    lowerMessage.includes("bind")
  ) {
    return `Remote port is not available on the endpoint server: ${message}`;
  }
  if (
    lowerMessage.includes("name or service not known") ||
    lowerMessage.includes("enotfound") ||
    lowerMessage.includes("econnrefused")
  ) {
    return `Tunnel target is not reachable from the endpoint host: ${message}`;
  }

  return message || "Failed to open relay";
}

function pauseSourceForC2SWebSocket(ws: WebSocket, source?: Duplex): void {
  if (!source) return;
  if (ws.bufferedAmount <= C2S_WS_HIGH_WATERMARK) return;

  source.pause();
  const resumeTimer = setInterval(() => {
    if (
      ws.readyState !== 1 ||
      source.destroyed ||
      ws.bufferedAmount <= C2S_WS_LOW_WATERMARK
    ) {
      clearInterval(resumeTimer);
      if (ws.readyState === 1 && !source.destroyed) {
        source.resume();
      }
    }
  }, 25);
}

export function sendC2SMessage(
  ws: WebSocket,
  message: Record<string, unknown>,
  source?: Duplex,
): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message), (error) => {
      if (error && source && !source.destroyed) {
        source.destroy(error);
      }
    });
    pauseSourceForC2SWebSocket(ws, source);
  }
}

export function writeC2SRemoteChunk(
  target: ClientChannel,
  chunk: Buffer,
  ws: WebSocket,
  closeTarget: () => void,
): void {
  if (!target || target.destroyed) return;

  if (target.writableLength > C2S_STREAM_WRITE_LIMIT) {
    closeTarget();
    return;
  }

  const canContinue = target.write(chunk);
  if (!canContinue) {
    ws.pause();
    target.once("drain", () => {
      if (ws.readyState === 1) {
        ws.resume();
      }
    });
  }
}
