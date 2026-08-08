import { describe, expect, it, vi } from "vitest";
import type { LookupAddress, LookupOptions } from "dns";
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
//
// `lookupOptions.all` controls the *caller's* expected callback shape
// (single address vs. full array) — this is the flag Node's happy-eyeballs
// autoSelectFamily sets to `true`. It's independent of the internal call to
// the underlying resolver, which the hook always forces to `all: true` so it
// has every candidate address available to run the blocklist check against.
function runHook(
  addresses: LookupAddress[] | string | undefined,
  error: NodeJS.ErrnoException | null = null,
  all = true,
) {
  const fakeLookup = (
    _host: string,
    _opts: LookupOptions,
    cb: (
      err: NodeJS.ErrnoException | null,
      addrs: LookupAddress[] | string | undefined,
      family?: number,
    ) => void,
  ) => {
    if (all) {
      cb(error, addresses as LookupAddress[]);
    } else {
      cb(
        error,
        addresses as string | undefined,
        typeof addresses === "object" ? undefined : 4,
      );
    }
  };

  const hook = createDnsLookupHook(fakeLookup);
  const callback = vi.fn();
  hook("example.invalid", { all }, callback);
  return callback;
}

// The three lookupOptions shapes a real caller can pass, and the tail args
// (everything after the leading null/error arg) the hook must answer with
// for each — [] for the array form Node's autoSelectFamily expects, ["", 0]
// for the legacy single-address form. Reused as plain data across the
// it.each tables below, matching the flat tuple style used elsewhere in
// this test suite (see termix-id-keys.test.ts, oidc-desktop-callback.test.ts)
// rather than nesting a parameterized describe block.
const lookupOptionsCases: Array<[string, LookupOptions, unknown[]]> = [
  ["all:true (Node's autoSelectFamily/happy-eyeballs)", { all: true }, [[]]],
  ["all:false (legacy)", { all: false } as LookupOptions, ["", 0]],
  ["all omitted (legacy)", {} as LookupOptions, ["", 0]],
];

// Fixed answer used by the success table below — kept separate from
// lookupOptionsCases because the expected tail args here are the resolved
// address(es) themselves, not a fixed "", 0 vs [] shape.
const publicAddresses = [
  { address: "104.21.52.150", family: 4 },
  { address: "2606:4700:3034::ac43:c88d", family: 6 },
];
const successCases: Array<[string, LookupOptions, unknown[]]> = [
  [
    "all:true (Node's autoSelectFamily/happy-eyeballs)",
    { all: true },
    [publicAddresses],
  ],
  [
    "all:false (legacy)",
    { all: false } as LookupOptions,
    [publicAddresses[0].address, publicAddresses[0].family],
  ],
  [
    "all omitted (legacy)",
    {} as LookupOptions,
    [publicAddresses[0].address, publicAddresses[0].family],
  ],
];

describe("createDnsLookupHook", () => {
  it("allows a public IPv4 address through", () => {
    const callback = runHook([{ address: "104.21.52.150", family: 4 }]);
    expect(callback).toHaveBeenCalledWith(
      null,
      [{ address: "104.21.52.150", family: 4 }],
      0,
    );
  });

  it.each(lookupOptionsCases)(
    "rejects if any address is private, including an IPv4-mapped IPv6 spoof not in first position (%s)",
    (_label, lookupOptions, tailArgs) => {
      const { callback } = runHook(
        [
          { address: "104.21.52.150", family: 4 },
          { address: "::ffff:192.168.1.1", family: 6 },
          { address: "2606:4700:3034::ac43:c88d", family: 6 },
        ],
        null,
        lookupOptions,
      );
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Private destinations are not allowed",
        }),
        ...tailArgs,
      );
    },
  );

  it("returns a single lookup result when all is false", () => {
    const callback = runHook("104.21.52.150", null, false);
    expect(callback).toHaveBeenCalledWith(null, "104.21.52.150", 4);
  });

  it("rejects invalid single lookup results with a DNS lookup error", () => {
    const callback = runHook(undefined, null, false);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "DNS lookup returned invalid address",
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

  it("always asks the underlying resolver for all:true regardless of the caller's option", () => {
    const { fakeLookup } = runHook(
      [{ address: "104.21.52.150", family: 4 }],
      null,
      { all: false },
    );
    expect(fakeLookup).toHaveBeenCalledWith(
      "example.invalid",
      expect.objectContaining({ all: true, verbatim: true }),
      expect.any(Function),
    );
  });
});
