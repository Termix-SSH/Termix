import { describe, expect, it } from "vitest";
import {
  getTrustedProxyAuthConfig,
  isTrustedProxyAddress,
  parseTrustedProxyRoleMap,
  resolveProxyAuthSourceAddress,
  resolveTrustedProxyRoles,
} from "../../utils/trusted-proxy-auth.js";

describe("trusted proxy authentication config", () => {
  it("requires an explicit proxy allowlist and role map", () => {
    expect(() =>
      getTrustedProxyAuthConfig({ TRUSTED_PROXY_AUTH_ENABLED: "true" }),
    ).toThrow(/requires/);
    expect(() =>
      getTrustedProxyAuthConfig({
        TRUSTED_PROXY_AUTH_ENABLED: "true",
        TRUSTED_PROXY_AUTH_TRUSTED_PROXIES: "not-a-cidr",
        TRUSTED_PROXY_AUTH_ROLE_MAP: '{"operators":"user"}',
      }),
    ).toThrow(/Invalid trusted proxy/);
  });

  it("matches exact addresses, CIDRs, and IPv4-mapped addresses", () => {
    const trusted = ["10.20.0.0/16", "2001:db8::/32"];
    expect(isTrustedProxyAddress("10.20.1.4", trusted)).toBe(true);
    expect(isTrustedProxyAddress("::ffff:10.20.1.4", trusted)).toBe(true);
    expect(isTrustedProxyAddress("10.21.1.4", trusted)).toBe(false);
    expect(isTrustedProxyAddress("2001:db8::5", trusted)).toBe(true);
  });

  it("fails closed when a supplied external role is not mapped", () => {
    const roleMap = parseTrustedProxyRoleMap(
      JSON.stringify({ operators: ["operator"], viewers: "readonly" }),
    );
    expect(resolveTrustedProxyRoles("operators, viewers", roleMap)).toEqual([
      "operator",
      "readonly",
    ]);
    expect(resolveTrustedProxyRoles("operators, admins", roleMap)).toBeNull();
  });
});

describe("resolveProxyAuthSourceAddress", () => {
  function request(
    remoteAddress: string | undefined,
    headers: Record<string, string | string[] | undefined> = {},
  ) {
    return { socket: { remoteAddress }, headers };
  }

  it("uses the peer nginx reports when the request came over loopback", () => {
    // The backend only ever sees nginx itself on 127.0.0.1, so without this
    // the allowlist would have to contain 127.0.0.1 - and then match everyone.
    expect(
      resolveProxyAuthSourceAddress(
        request("::ffff:127.0.0.1", { "x-termix-proxy-peer": "172.18.0.5" }),
      ),
    ).toBe("172.18.0.5");
  });

  it("ignores the header when the request did not arrive over loopback", () => {
    expect(
      resolveProxyAuthSourceAddress(
        request("203.0.113.7", { "x-termix-proxy-peer": "172.18.0.5" }),
      ),
    ).toBe("203.0.113.7");
  });

  it("falls back to the peer when nginx did not set the header", () => {
    expect(resolveProxyAuthSourceAddress(request("127.0.0.1"))).toBe(
      "127.0.0.1",
    );
  });

  it("takes only the first entry of a header array or list", () => {
    expect(
      resolveProxyAuthSourceAddress(
        request("127.0.0.1", {
          "x-termix-proxy-peer": ["172.18.0.5", "10.0.0.1"],
        }),
      ),
    ).toBe("172.18.0.5");
    expect(
      resolveProxyAuthSourceAddress(
        request("127.0.0.1", { "x-termix-proxy-peer": "172.18.0.5, 10.0.0.1" }),
      ),
    ).toBe("172.18.0.5");
  });
});
