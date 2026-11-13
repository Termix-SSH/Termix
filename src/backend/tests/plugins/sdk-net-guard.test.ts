import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { LookupAddress } from "dns";
import {
  isPrivateAddress,
  PRIVATE_IPV4_RANGES,
  pinnedLookup,
  resolveTarget,
  TargetRefusedError,
} from "../../../../packages/plugin-sdk/src/net-guard.js";
import { isBlockedAddress } from "../../utils/safe-outbound-fetch.js";

function fakeLookup(answers: Record<string, string[][]>) {
  const calls: string[] = [];
  const lookup = ((
    host: string,
    _options: unknown,
    callback: (e: Error | null, a: LookupAddress[]) => void,
  ) => {
    calls.push(host);
    const queue = answers[host];
    if (!queue) return callback(new Error("ENOTFOUND"), []);
    const list = queue.length > 1 ? queue.shift()! : queue[0];
    callback(
      null,
      list.map((address) => ({
        address,
        family: address.includes(":") ? 6 : 4,
      })),
    );
  }) as never;
  return { lookup, calls };
}

const SAMPLES = [
  "127.0.0.1",
  "10.1.2.3",
  "172.20.0.1",
  "192.168.1.1",
  "100.100.1.1",
  "169.254.169.254",
  "0.0.0.0",
  "224.0.0.1",
  "::1",
  "::",
  "fd00::1",
  "fe80::1",
  "::ffff:127.0.0.1",
  "::ffff:10.0.0.1",
  "8.8.8.8",
  "93.184.216.34",
  "2606:4700::1111",
  "not-an-ip",
];

describe("plugin SDK net-guard", () => {
  it("matches core's outbound blocklist", () => {
    for (const address of SAMPLES) {
      expect(isPrivateAddress(address), address).toBe(
        isBlockedAddress(address),
      );
    }
  });

  it("refuses private literals unless allowed", async () => {
    await expect(resolveTarget("127.0.0.1")).rejects.toBeInstanceOf(
      TargetRefusedError,
    );
    await expect(resolveTarget("[::ffff:127.0.0.1]")).rejects.toBeInstanceOf(
      TargetRefusedError,
    );
    await expect(
      resolveTarget("10.0.0.5", { allowPrivateHosts: ["10.0.0.5"] }),
    ).resolves.toEqual({ address: "10.0.0.5", family: 4 });
  });

  it("refuses a name when any answer is private", async () => {
    const { lookup } = fakeLookup({
      "mixed.test": [["93.184.216.34", "127.0.0.1"]],
    });
    await expect(resolveTarget("mixed.test", { lookup })).rejects.toThrow(
      "Private destinations are not allowed",
    );
  });

  it("returns the checked address so a second lookup can't move it", async () => {
    const { lookup, calls } = fakeLookup({
      "rebind.test": [["203.0.113.10"], ["127.0.0.1"]],
    });
    const target = await resolveTarget("rebind.test", { lookup });
    expect(target).toEqual({ address: "203.0.113.10", family: 4 });
    expect(calls).toEqual(["rebind.test"]);
  });

  it("only allows the exact listed host", async () => {
    const { lookup } = fakeLookup({
      "nas.lan": [["192.168.1.20"]],
      "other.lan": [["192.168.1.21"]],
    });
    const options = { lookup, allowPrivateHosts: ["NAS.lan"] };
    await expect(resolveTarget("nas.lan", options)).resolves.toEqual({
      address: "192.168.1.20",
      family: 4,
    });
    await expect(resolveTarget("other.lan", options)).rejects.toBeInstanceOf(
      TargetRefusedError,
    );
  });

  it("pinnedLookup refuses private answers and keeps the all shape", async () => {
    const { lookup } = fakeLookup({
      "bad.test": [["10.0.0.1"]],
      "good.test": [["198.51.100.7"]],
    });
    const hook = pinnedLookup({ lookup });
    const run = (host: string, all: boolean) =>
      new Promise<{ error: Error | null; address: unknown }>((resolve) =>
        hook(host, { all }, (error, address) => resolve({ error, address })),
      );
    expect((await run("bad.test", false)).error).toBeInstanceOf(
      TargetRefusedError,
    );
    expect((await run("good.test", false)).address).toBe("198.51.100.7");
    expect((await run("good.test", true)).address).toEqual([
      { address: "198.51.100.7", family: 4 },
    ]);
  });
});

function v4(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

function v4ToNumber(address: string): number {
  return address.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);
}

function hexMapped(n: number): string {
  const hi = (n >>> 16).toString(16);
  const lo = (n & 0xffff).toString(16);
  return `::ffff:${hi}:${lo}`;
}

describe("plugin SDK net-guard properties", () => {
  const anyV4 = fc.integer({ min: 0, max: 0xffffffff });
  const anyV6 = fc.ipV6();

  it("agrees with core on any address", () => {
    fc.assert(
      fc.property(fc.oneof(anyV4.map(v4), anyV6, fc.string()), (address) => {
        expect(isPrivateAddress(address)).toBe(isBlockedAddress(address));
      }),
      { numRuns: 3000 },
    );
  });

  it("blocks every address in a private range, in every spelling", () => {
    const inRange = fc
      .constantFrom(...PRIVATE_IPV4_RANGES)
      .chain(([network, prefix]) => {
        const base = v4ToNumber(network);
        const size = 2 ** (32 - prefix);
        return fc.integer({ min: 0, max: size - 1 }).map((i) => base + i);
      });
    fc.assert(
      fc.property(inRange, (n) => {
        expect(isPrivateAddress(v4(n))).toBe(true);
        expect(isPrivateAddress(`::ffff:${v4(n)}`)).toBe(true);
        expect(isPrivateAddress(hexMapped(n))).toBe(true);
        expect(isPrivateAddress(`[::ffff:${v4(n)}]`)).toBe(true);
      }),
      { numRuns: 3000 },
    );
  });

  it("gives the same answer for an IPv4 address and its mapped form", () => {
    fc.assert(
      fc.property(anyV4, (n) => {
        expect(isPrivateAddress(hexMapped(n))).toBe(isPrivateAddress(v4(n)));
      }),
      { numRuns: 3000 },
    );
  });
});
