import { describe, expect, it } from "vitest";
import { resolveJumpTunnelEndpoint } from "../../../hosts/guacamole/jump-tunnel-endpoint.js";

describe("resolveJumpTunnelEndpoint", () => {
  it("keeps an in-process guacd tunnel on loopback", () => {
    expect(resolveJumpTunnelEndpoint("localhost")).toEqual({
      bindHost: "127.0.0.1",
      advertisedHost: "127.0.0.1",
    });
  });

  it("exposes the tunnel to a separate guacd container", () => {
    expect(resolveJumpTunnelEndpoint("guacd")).toEqual({
      bindHost: "0.0.0.0",
      advertisedHost: "termix",
    });
  });

  it("supports a custom backend hostname for external guacd", () => {
    expect(
      resolveJumpTunnelEndpoint("guacd.example", "termix-backend"),
    ).toEqual({
      bindHost: "0.0.0.0",
      advertisedHost: "termix-backend",
    });
  });
});
