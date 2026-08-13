import { describe, expect, it } from "vitest";
import {
  getTrustedProxyAuthConfig,
  isTrustedProxyAddress,
  parseTrustedProxyRoleMap,
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
