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

function runHook(
  addresses: LookupAddress[] | string | undefined,
  error: NodeJS.ErrnoException | null = null,
  lookupOptions: LookupOptions = { all: true },
) {
  const fakeLookup = vi.fn(
    (
      _host: string,
      _opts: LookupOptions,
      cb: (
        err: NodeJS.ErrnoException | null,
        addrs: LookupAddress[] | string | undefined,
        family?: number,
      ) => void,
    ) => {
      cb(
        error,
        addresses,
        typeof addresses === "string" ? 4 : undefined,
      );
    },
  );

  const hook = createDnsLookupHook(fakeLookup);
  const callback = vi.fn();

  hook("example.invalid", lookupOptions, callback);

  return { callback, fakeLookup };
};

const lookupOptionsCases: Array<[string, LookupOptions, unknown[]]> = [
  [
    "all:true",
    { all: true },
    ["", 0],
  ],
  [
    "all:false",
    { all: false },
    ["", 0],
  ],
  [
    "all omitted",
    {},
    ["", 0],
  ],
];

const publicAddresses: LookupAddress[] = [
  {
    address: "104.21.52.150",
    family: 4,
  },
  {
    address: "2606:4700:3034::ac43:c88d",
    family: 6,
  },
];

describe("createDnsLookupHook", () => {
  it("allows a public IPv4 address through", () => {
    const { callback } = runHook([
      {
        address: "104.21.52.150",
        family: 4,
      },
    ]);

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
          {
            address: "104.21.52.150",
            family: 4,
          },
          {
            address: "::ffff:192.168.1.1",
            family: 6,
          },
          {
            address: "2606:4700:3034::ac43:c88d",
            family: 6,
          },
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
    const { callback } = runHook(
      "104.21.52.150",
      null,
      { all: false },
    );

    expect(callback).toHaveBeenCalledWith(
      null,
      "104.21.52.150",
      4,
    );
  });

  it("returns a single lookup result when all is omitted", () => {
    const { callback } = runHook(
      "104.21.52.150",
      null,
      {},
    );

    expect(callback).toHaveBeenCalledWith(
      null,
      "104.21.52.150",
      4,
    );
  });

  it("returns all lookup results when all is true", () => {
    const { callback } = runHook(
      publicAddresses,
      null,
      { all: true },
    );

    expect(callback).toHaveBeenCalledWith(
      null,
      publicAddresses,
      0,
    );
  });

  it("rejects invalid single lookup results with a DNS lookup error", () => {
    const { callback } = runHook(
      undefined,
      null,
      { all: false },
    );

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "DNS lookup returned invalid address",
      }),
      "",
      0,
    );
  });

  it("rejects with a distinct error when DNS returns no addresses", () => {
    const { callback } = runHook([]);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "DNS resolution returned no addresses",
      }),
      "",
      0,
    );
  });

  it("propagates a real DNS lookup error untouched", () => {
    const dnsError = Object.assign(
      new Error("getaddrinfo ENOTFOUND"),
      { code: "ENOTFOUND" },
    );

    const { callback } = runHook([], dnsError);

    expect(callback).toHaveBeenCalledWith(
      dnsError,
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

    console.log(fakeLookup.mock.calls);

    expect(fakeLookup).toHaveBeenCalledWith(
      "example.invalid",
      expect.objectContaining({
        all: true,
        verbatim: true,
      }),
      expect.any(Function),
    );
  });
});
