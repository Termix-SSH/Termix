import { describe, expect, it } from "vitest";
import { getJumpHostSocks5Config } from "./jump-host-proxy.js";

describe("getJumpHostSocks5Config", () => {
  it("uses the first jump host proxy settings", () => {
    expect(
      getJumpHostSocks5Config({
        useSocks5: true,
        socks5Host: "proxy.internal",
        socks5Port: 1080,
        socks5Username: "user",
        socks5Password: "secret",
      }),
    ).toEqual({
      useSocks5: true,
      socks5Host: "proxy.internal",
      socks5Port: 1080,
      socks5Username: "user",
      socks5Password: "secret",
      socks5ProxyChain: [],
    });
  });

  it("does not use destination proxy settings for the first jump host", () => {
    expect(getJumpHostSocks5Config({ useSocks5: false })).toBeNull();
  });

  it("accepts a serialized proxy chain from the first jump host", () => {
    const chain = [
      {
        id: "proxy-1",
        name: "Proxy 1",
        host: "proxy.internal",
        port: 1080,
        type: "socks5" as const,
      },
    ];

    expect(
      getJumpHostSocks5Config({
        useSocks5: true,
        socks5ProxyChain: JSON.stringify(chain),
      }),
    ).toEqual({
      useSocks5: true,
      socks5Host: undefined,
      socks5Port: undefined,
      socks5Username: undefined,
      socks5Password: undefined,
      socks5ProxyChain: chain,
    });
  });
});
