import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { isAllowedWebSocketOrigin } from "../../utils/ws-origin.js";

function handshake(headers: Record<string, string>) {
  return {
    headers,
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
}

const proxied = {
  host: "termix.example.com",
  "x-forwarded-proto": "https",
  "x-forwarded-host": "termix.example.com",
};

describe("isAllowedWebSocketOrigin", () => {
  it("accepts a handshake from the app's own origin", () => {
    expect(
      isAllowedWebSocketOrigin(
        handshake({ ...proxied, origin: "https://termix.example.com" }),
      ),
    ).toBe(true);
  });

  it("rejects a handshake a foreign page started", () => {
    expect(
      isAllowedWebSocketOrigin(
        handshake({ ...proxied, origin: "https://evil.example" }),
      ),
    ).toBe(false);
  });

  it("accepts non-browser clients, which send no Origin at all", () => {
    expect(isAllowedWebSocketOrigin(handshake(proxied))).toBe(true);
  });

  it("accepts the desktop app", () => {
    expect(
      isAllowedWebSocketOrigin(handshake({ ...proxied, origin: "file://" })),
    ).toBe(true);
  });
});
