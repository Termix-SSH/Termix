import { afterEach, describe, expect, it } from "vitest";
import {
  getTrustProxySetting,
  isTrustedProxy,
  resolveClientIp,
} from "../../utils/trusted-proxies.js";

const originalTrustedProxies = process.env.TRUSTED_PROXIES;

afterEach(() => {
  if (originalTrustedProxies === undefined) {
    delete process.env.TRUSTED_PROXIES;
  } else {
    process.env.TRUSTED_PROXIES = originalTrustedProxies;
  }
});

describe("getTrustProxySetting", () => {
  it("defaults to loopback, which is what the bundled nginx connects from", () => {
    delete process.env.TRUSTED_PROXIES;
    expect(getTrustProxySetting({})).toBe("loopback");
  });

  it("maps the opt-out and opt-in keywords to booleans", () => {
    expect(getTrustProxySetting({ TRUSTED_PROXIES: "true" })).toBe(true);
    expect(getTrustProxySetting({ TRUSTED_PROXIES: "ALL" })).toBe(true);
    expect(getTrustProxySetting({ TRUSTED_PROXIES: "false" })).toBe(false);
    expect(getTrustProxySetting({ TRUSTED_PROXIES: "none" })).toBe(false);
  });

  it("passes lists through verbatim so Express and the WS path agree", () => {
    expect(
      getTrustProxySetting({ TRUSTED_PROXIES: " loopback, 172.16.0.0/12 " }),
    ).toBe("loopback, 172.16.0.0/12");
  });
});

describe("isTrustedProxy", () => {
  it("resolves presets", () => {
    expect(isTrustedProxy("127.0.0.1", "loopback")).toBe(true);
    expect(isTrustedProxy("::1", "loopback")).toBe(true);
    expect(isTrustedProxy("10.1.2.3", "loopback")).toBe(false);
    expect(isTrustedProxy("10.1.2.3", "uniquelocal")).toBe(true);
  });

  it("matches IPv4-mapped IPv6 peers, which is how Node reports them", () => {
    expect(isTrustedProxy("::ffff:127.0.0.1", "loopback")).toBe(true);
  });

  it("resolves explicit addresses and CIDRs", () => {
    expect(isTrustedProxy("172.18.0.5", "172.16.0.0/12")).toBe(true);
    expect(isTrustedProxy("172.18.0.5", "172.18.0.6")).toBe(false);
    expect(isTrustedProxy("172.18.0.6", "172.18.0.6")).toBe(true);
  });

  it("honours the trust-everything and trust-nothing settings", () => {
    expect(isTrustedProxy("203.0.113.7", true)).toBe(true);
    expect(isTrustedProxy("127.0.0.1", false)).toBe(false);
  });

  it("ignores unparseable entries rather than trusting them", () => {
    expect(isTrustedProxy("127.0.0.1", "not-an-ip")).toBe(false);
    expect(isTrustedProxy("127.0.0.1", "127.0.0.1/999")).toBe(false);
    expect(isTrustedProxy(undefined, "loopback")).toBe(false);
  });
});

describe("resolveClientIp", () => {
  it("returns the peer untouched when the peer is not a trusted proxy", () => {
    expect(
      resolveClientIp("203.0.113.7", "10.0.0.1, 192.0.2.9", "loopback"),
    ).toBe("203.0.113.7");
  });

  it("takes the hop nginx appended, not the entry the client wrote", () => {
    // nginx appends the address it saw, so a client sending
    // "X-Forwarded-For: 1.2.3.4" ends up left of its own real address.
    expect(
      resolveClientIp("127.0.0.1", "1.2.3.4, 203.0.113.7", "loopback"),
    ).toBe("203.0.113.7");
  });

  it("walks through every hop the deployment declares trusted", () => {
    expect(
      resolveClientIp(
        "127.0.0.1",
        "203.0.113.7, 172.18.0.5, 172.18.0.9",
        "loopback,172.16.0.0/12",
      ),
    ).toBe("203.0.113.7");
  });

  it("falls back to the peer when every hop is a trusted proxy", () => {
    expect(resolveClientIp("127.0.0.1", "127.0.0.1", "loopback")).toBe(
      "127.0.0.1",
    );
  });

  it("normalizes IPv4-mapped peers and hops", () => {
    expect(
      resolveClientIp("::ffff:127.0.0.1", "::ffff:203.0.113.7", "loopback"),
    ).toBe("203.0.113.7");
  });

  it("reports unknown when there is no address information at all", () => {
    expect(resolveClientIp(undefined, undefined, "loopback")).toBe("unknown");
  });
});
