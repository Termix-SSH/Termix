import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "http";
import { extractWebSocketToken } from "../../utils/ws-auth.js";

function request(headers: Record<string, string>): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe("extractWebSocketToken", () => {
  it("reads JWTs from the WebSocket subprotocol without using the URL", () => {
    expect(
      extractWebSocketToken(
        request({ "sec-websocket-protocol": "termix.jwt.header.payload.sig" }),
      ),
    ).toBe("header.payload.sig");
  });

  it("prefers the HttpOnly cookie over renderer-provided protocols", () => {
    expect(
      extractWebSocketToken(
        request({
          cookie: "jwt=cookie-token",
          "sec-websocket-protocol": "termix.jwt.protocol-token",
        }),
      ),
    ).toBe("cookie-token");
  });
});
