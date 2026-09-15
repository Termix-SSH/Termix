import { describe, expect, it } from "vitest";
import {
  currentTunnelHost,
  resolveWebEndpointUrl,
  separatedTunnelHost,
  unreachableTunnelReason,
} from "@/lib/web-endpoint-url";
import type { WebEndpoint } from "@/types/index";

function endpoint(overrides: Partial<WebEndpoint> = {}): WebEndpoint {
  return {
    id: "e1",
    label: "Proxmox",
    scheme: "https",
    port: 8006,
    access: "direct",
    render: "external",
    ...overrides,
  };
}

describe("resolveWebEndpointUrl", () => {
  it("builds a direct URL at the host address", () => {
    expect(
      resolveWebEndpointUrl({
        hostAddress: "192.168.1.10",
        endpoint: endpoint(),
      }),
    ).toBe("https://192.168.1.10:8006/");
  });

  it("builds a direct URL for a hostname", () => {
    expect(
      resolveWebEndpointUrl({
        hostAddress: "nas.local",
        endpoint: endpoint({ port: 443 }),
      }),
    ).toBe("https://nas.local:443/");
  });

  it("uses the local port for tunnel access, dropping the endpoint's own port", () => {
    expect(
      resolveWebEndpointUrl({
        hostAddress: "192.168.1.10",
        endpoint: endpoint({ access: "tunnel", scheme: "http", port: 8006 }),
        localPort: 41234,
      }),
    ).toBe("http://127.0.0.1:41234/");
  });

  it("defaults a missing path to /", () => {
    expect(
      resolveWebEndpointUrl({
        hostAddress: "10.0.0.5",
        endpoint: endpoint({ scheme: "http", port: 80, path: undefined }),
      }),
    ).toBe("http://10.0.0.5:80/");
  });

  it("keeps an explicit path and its query", () => {
    expect(
      resolveWebEndpointUrl({
        hostAddress: "10.0.0.5",
        endpoint: endpoint({
          scheme: "http",
          port: 9000,
          path: "/admin?tab=1",
        }),
      }),
    ).toBe("http://10.0.0.5:9000/admin?tab=1");
  });

  it("throws when tunnel access has no local port", () => {
    expect(() =>
      resolveWebEndpointUrl({
        hostAddress: "10.0.0.5",
        endpoint: endpoint({ access: "tunnel" }),
      }),
    ).toThrow(/local port/i);
  });

  it("brackets a bare IPv6 host address", () => {
    expect(
      resolveWebEndpointUrl({
        hostAddress: "fd00::1",
        endpoint: endpoint({ scheme: "http", port: 8080 }),
      }),
    ).toBe("http://[fd00::1]:8080/");
  });

  it("brackets a bare IPv6 tunnel host", () => {
    expect(
      resolveWebEndpointUrl({
        hostAddress: "10.0.0.5",
        endpoint: endpoint({ access: "tunnel", scheme: "http" }),
        localPort: 41234,
        tunnelHost: "fd00::1",
      }),
    ).toBe("http://[fd00::1]:41234/");
  });

  it("uses an explicit tunnel host when given", () => {
    expect(
      resolveWebEndpointUrl({
        hostAddress: "10.0.0.5",
        endpoint: endpoint({ access: "tunnel", scheme: "http" }),
        localPort: 41234,
        tunnelHost: "termix.lan",
      }),
    ).toBe("http://termix.lan:41234/");
  });
});

/**
 * Cookies are keyed by host and IGNORE the port, and SameSite computes "site"
 * as scheme + registrable domain -- also ignoring the port. So a forward
 * reached at the very host string serving Termix is same-site with Termix:
 * the browser attaches the jwt cookie to every request the framed
 * third-party server receives, and a Set-Cookie from that server lands in the
 * jar Termix's own API calls read from (both auth middlewares prefer the
 * cookie over the Authorization header).
 *
 * Both directions were reproduced against a real SSH forward. separatedTunnelHost
 * is the whole mitigation: a host string that reaches the same machine but is
 * a DIFFERENT cookie-jar key.
 */
describe("separatedTunnelHost", () => {
  it("maps each loopback spelling to a different one", () => {
    expect(separatedTunnelHost("localhost")).toBe("127.0.0.1");
    expect(separatedTunnelHost("127.0.0.1")).toBe("localhost");
    expect(separatedTunnelHost("::1")).toBe("127.0.0.1");
    expect(separatedTunnelHost("[::1]")).toBe("127.0.0.1");
  });

  it("never returns the host it was given, which would be no separation", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "[::1]"]) {
      expect(separatedTunnelHost(host)).not.toBe(host);
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(separatedTunnelHost("  LOCALHOST ")).toBe("127.0.0.1");
  });

  it("returns null for a host with no alias, rather than guessing", () => {
    // A same-registrable-domain alias would NOT be safe: the target could
    // answer Set-Cookie with Domain=example.com and reach Termix anyway.
    // Only loopback literals qualify -- they cannot carry a Domain.
    expect(separatedTunnelHost("termix.example.com")).toBeNull();
    expect(separatedTunnelHost("192.168.1.50")).toBeNull();
    expect(separatedTunnelHost("")).toBeNull();
  });
});

describe("currentTunnelHost", () => {
  it("is loopback on the desktop, whose API base is localhost", () => {
    // Two different cookie-jar keys. Do not "simplify" either to match.
    expect(currentTunnelHost(true)).toBe("127.0.0.1");
  });

  it("swaps to the other loopback spelling when Termix is served at localhost", () => {
    expect(currentTunnelHost(false, "localhost")).toBe("127.0.0.1");
  });

  it("swaps the other way when Termix is served at 127.0.0.1", () => {
    expect(currentTunnelHost(false, "127.0.0.1")).toBe("localhost");
  });

  it("has no answer for a page host with no loopback alias", () => {
    expect(currentTunnelHost(false, "termix.example.com")).toBeNull();
    expect(currentTunnelHost(false, "192.168.1.50")).toBeNull();
  });
});

describe("unreachableTunnelReason", () => {
  const tunnel = (bindHost?: string) =>
    endpoint({ access: "tunnel", bindHost }) as Pick<
      WebEndpoint,
      "access" | "bindHost"
    >;

  it("passes a direct endpoint, which binds nothing and is cross-host anyway", () => {
    expect(
      unreachableTunnelReason(endpoint(), false, "termix.example.com"),
    ).toBeNull();
  });

  it("passes anything on the desktop", () => {
    expect(unreachableTunnelReason(tunnel(), true, "localhost")).toBeNull();
    expect(
      unreachableTunnelReason(tunnel("0.0.0.0"), true, "localhost"),
    ).toBeNull();
  });

  it("refuses a loopback bind a remote backend would strand", () => {
    expect(unreachableTunnelReason(tunnel(), false, "localhost")).toBe(
      "loopback-bind-on-remote-backend",
    );
    expect(
      unreachableTunnelReason(tunnel("127.0.0.1"), false, "localhost"),
    ).toBe("loopback-bind-on-remote-backend");
  });

  it("allows an exposed bind when the page host has a loopback alias", () => {
    expect(
      unreachableTunnelReason(tunnel("0.0.0.0"), false, "localhost"),
    ).toBeNull();
    expect(
      unreachableTunnelReason(tunnel("0.0.0.0"), false, "127.0.0.1"),
    ).toBeNull();
  });

  it("refuses when the tunnel URL would share Termix's cookie jar", () => {
    expect(
      unreachableTunnelReason(tunnel("0.0.0.0"), false, "termix.example.com"),
    ).toBe("shares-session-cookie-with-termix");
    expect(
      unreachableTunnelReason(tunnel("0.0.0.0"), false, "192.168.1.50"),
    ).toBe("shares-session-cookie-with-termix");
  });

  it("reports the reachability problem first when both apply", () => {
    // The bind address is what the user has to change either way, and it is
    // the more specific instruction.
    expect(unreachableTunnelReason(tunnel(), false, "termix.example.com")).toBe(
      "loopback-bind-on-remote-backend",
    );
  });
});
