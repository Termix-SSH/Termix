import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "http";
import {
  extractWebSocketToken,
  isCookieOriginAllowed,
} from "../../utils/ws-auth.js";

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

describe("the jwt cookie on a socket", () => {
  it("counts when the page is this server", () => {
    expect(
      extractWebSocketToken(
        request({
          cookie: "jwt=cookie-token",
          host: "termix.example.com",
          origin: "https://termix.example.com",
        }),
      ),
    ).toBe("cookie-token");
  });

  it("is ignored when another site opened the socket", () => {
    expect(
      extractWebSocketToken(
        request({
          cookie: "jwt=cookie-token",
          host: "termix.example.com",
          origin: "https://evil.example.com",
        }),
      ),
    ).toBeUndefined();
  });

  it("still takes an explicit token from another origin", () => {
    expect(
      extractWebSocketToken(
        request({
          cookie: "jwt=cookie-token",
          host: "termix.example.com",
          origin: "https://evil.example.com",
          "sec-websocket-protocol": "termix.jwt.protocol-token",
        }),
      ),
    ).toBe("protocol-token");
  });

  it("allows the dev proxy, which rewrites Host to loopback", () => {
    expect(
      isCookieOriginAllowed(
        request({ host: "127.0.0.1:30001", origin: "http://localhost:5173" }),
      ),
    ).toBe(true);
  });

  it("allows the desktop app, which is not a web origin", () => {
    expect(
      isCookieOriginAllowed(
        request({ host: "termix.example.com", origin: "file://" }),
      ),
    ).toBe(true);
  });
});
