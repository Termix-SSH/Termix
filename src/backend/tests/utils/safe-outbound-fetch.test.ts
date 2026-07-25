import { describe, expect, it } from "vitest";
import { isBlockedAddress } from "../../utils/safe-outbound-fetch.js";

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
