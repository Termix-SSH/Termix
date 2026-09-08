import { describe, expect, it } from "vitest";
import {
  RESERVED_TUNNEL_NAME_PREFIX,
  buildWebEndpointTunnelName,
  isReservedTunnelName,
  parseReservedTunnelName,
} from "../../hosts/tunnel/utils.js";

describe("reserved tunnel names", () => {
  it("builds a name from a host id and endpoint id", () => {
    expect(buildWebEndpointTunnelName(7, "e1")).toBe("web:7:e1");
  });

  it("recognises its own names and nothing else", () => {
    expect(isReservedTunnelName(buildWebEndpointTunnelName(7, "e1"))).toBe(
      true,
    );
    expect(isReservedTunnelName("my-tunnel")).toBe(false);
    expect(isReservedTunnelName("website")).toBe(false);
    expect(isReservedTunnelName(RESERVED_TUNNEL_NAME_PREFIX)).toBe(true);
  });

  it("round-trips through parse", () => {
    expect(
      parseReservedTunnelName(buildWebEndpointTunnelName(7, "e1")),
    ).toEqual({
      hostId: 7,
      endpointId: "e1",
    });
  });

  it("keeps an endpoint id containing colons intact", () => {
    // Endpoint ids are client-supplied strings with no character restriction,
    // so splitting on the LAST colon would corrupt them. The host id segment
    // is digits only, so splitting on the first colon after it is safe.
    expect(parseReservedTunnelName("web:7:a:b:c")).toEqual({
      hostId: 7,
      endpointId: "a:b:c",
    });
  });

  it("returns null for anything it cannot verify", () => {
    // Callers use this for an ownership check, so null must mean "cannot
    // verify" and they must fail closed. Never return a partial guess.
    for (const name of [
      "my-tunnel",
      "web:",
      "web:7",
      "web::e1",
      "web:abc:e1",
      "web:-1:e1",
      "web:0:e1",
      "web:7:",
      "web:7.5:e1",
    ]) {
      expect(parseReservedTunnelName(name)).toBeNull();
    }
  });
});
