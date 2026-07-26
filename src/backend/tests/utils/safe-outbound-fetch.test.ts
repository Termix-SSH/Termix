import { describe, expect, it, vi } from "vitest";
import type { LookupAddress, LookupAllOptions } from "dns";
import {
  createDnsLookupHook,
  isBlockedAddress,
} from "../../utils/safe-outbound-fetch.js";

describe("isBlockedAddress", () => {
  it("allows public IPv4 addresses", () => {
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("104.21.52.150")).toBe(false);
  });

  it("blocks private/reserved IPv4 ranges", () => {
    expect(isBlockedAddress("10.0.0.1")).toBe(true);
    expect(isBlockedAddress("172.16.0.1")).toBe(true);
    expect(isBlockedAddress("192.168.1.1")).toBe(true);
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("169.254.1.1")).toBe(true);
    expect(isBlockedAddress("100.64.0.1")).toBe(true);
  });

  it("allows public IPv6 addresses", () => {
    expect(isBlockedAddress("2606:4700:3034::ac43:c88d")).toBe(false);
    expect(isBlockedAddress("2001:4860:4860::8888")).toBe(false);
  });

  it("blocks private/reserved IPv6 ranges", () => {
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("fc00::1")).toBe(true);
    expect(isBlockedAddress("fe80::1")).toBe(true);
  });

  it("blocks IPv4-mapped-IPv6 spoofing of private addresses", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:192.168.1.1")).toBe(true);
    expect(isBlockedAddress("::ffff:10.0.0.1")).toBe(true);
  });

  it("does not block IPv4-mapped-IPv6 form of public addresses", () => {
    expect(isBlockedAddress("::ffff:104.21.52.150")).toBe(false);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("blocks unparseable input", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
});

// These exercise createDnsLookupHook directly against a fake resolver,
// bypassing fetch()/undici entirely. That's the actual code path the
// original bug lived in — a public IPv4 address getting misclassified as
// private — and testing it through a real Agent/fetch call would only
// add flakiness (real TCP connects, undici's own quirks) without adding
// coverage of the logic that actually broke.
function runHook(
  addresses: LookupAddress[],
  error: NodeJS.ErrnoException | null = null,
) {
  const fakeLookup = (
    _host: string,
    _opts: LookupAllOptions,
    cb: (err: NodeJS.ErrnoException | null, addrs: LookupAddress[]) => void,
  ) => cb(error, addresses);

  const hook = createDnsLookupHook(fakeLookup);
  const callback = vi.fn();
  hook("example.invalid", { all: true }, callback);
  return callback;
}

describe("createDnsLookupHook", () => {
  it("allows a public IPv4 address through", () => {
    const callback = runHook([{ address: "104.21.52.150", family: 4 }]);
    expect(callback).toHaveBeenCalledWith(null, "104.21.52.150", 4);
  });

  it("rejects a private address with the private-destination error", () => {
    const callback = runHook([{ address: "192.168.1.1", family: 4 }]);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Private destinations are not allowed",
      }),
      "",
      0,
    );
  });

  it("rejects with a distinct error when DNS returns no addresses", () => {
    const callback = runHook([]);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "DNS resolution returned no addresses",
      }),
      "",
      0,
    );
  });

  it("propagates a real DNS lookup error untouched", () => {
    const dnsError = Object.assign(new Error("getaddrinfo ENOTFOUND"), {
      code: "ENOTFOUND",
    });
    const callback = runHook([], dnsError);
    expect(callback).toHaveBeenCalledWith(dnsError, "", 0);
  });
});
