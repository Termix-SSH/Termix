import { describe, expect, it } from "vitest";
import { websocketAuthProtocols } from "@/lib/ws-auth";

describe("websocketAuthProtocols", () => {
  it("moves a JWT into the WebSocket protocol header", () => {
    expect(websocketAuthProtocols("header.payload.sig")).toEqual([
      "termix.jwt.header.payload.sig",
    ]);
  });

  it("does not advertise an authentication protocol without a token", () => {
    expect(websocketAuthProtocols(null)).toEqual([]);
  });
});
