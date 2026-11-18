import { beforeEach, describe, expect, it, vi } from "vitest";

const answers = new Map<string, string[][]>();
const lookups: string[] = [];

function nextAnswer(host: string): string[] {
  const queue = answers.get(host);
  if (!queue || queue.length === 0) return ["93.184.216.34"];
  return queue.length > 1 ? queue.shift()! : queue[0];
}

vi.mock("dns/promises", () => {
  const lookup = vi.fn(async (host: string, options?: { all?: boolean }) => {
    lookups.push(host);
    const list = nextAnswer(host).map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
    return options?.all ? list : list[0];
  });
  return { default: { lookup }, lookup };
});

const socksCalls: Array<Record<string, unknown>> = [];
vi.mock("socks", () => ({
  SocksClient: {
    createConnection: vi.fn(async (options: Record<string, unknown>) => {
      socksCalls.push(options);
      return { socket: { destroy: vi.fn() } };
    }),
    createConnectionChain: vi.fn(async (options: Record<string, unknown>) => {
      socksCalls.push(options);
      return { socket: { destroy: vi.fn() } };
    }),
  },
}));

vi.mock("../../utils/logger.js", () => ({
  sshLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const { testProxyConnectivity } = await import("../../utils/proxy-helper.js");

beforeEach(() => {
  answers.clear();
  lookups.length = 0;
  socksCalls.length = 0;
});

describe("GHSA-64cc-43f9-c2v3 proxy test DNS rebinding", () => {
  it("connects to the address it checked, not a second lookup", async () => {
    answers.set("rebind.test", [["203.0.113.10"], ["127.0.0.1"]]);
    answers.set("target.test", [["198.51.100.7"], ["10.0.0.1"]]);

    await testProxyConnectivity({
      singleProxy: { host: "rebind.test", port: 1080, type: 5 },
      testTarget: { host: "target.test", port: 22 },
    });

    expect(socksCalls).toHaveLength(1);
    const call = socksCalls[0] as {
      proxy: { host: string };
      destination: { host: string };
    };
    expect(call.proxy.host).toBe("203.0.113.10");
    expect(call.destination.host).toBe("198.51.100.7");
  });

  it("refuses a name with any private answer", async () => {
    answers.set("mixed.test", [["203.0.113.10", "127.0.0.1"]]);
    await expect(
      testProxyConnectivity({
        singleProxy: { host: "mixed.test", port: 1080, type: 5 },
        testTarget: { host: "203.0.113.20", port: 22 },
      }),
    ).rejects.toThrow(/not allowed/);
    expect(socksCalls).toHaveLength(0);
  });

  it("pins every hop of a chain", async () => {
    answers.set("one.test", [["203.0.113.1"], ["127.0.0.1"]]);
    answers.set("two.test", [["203.0.113.2"], ["127.0.0.1"]]);

    await testProxyConnectivity({
      proxyChain: [
        { host: "one.test", port: 1080, type: 5 },
        { host: "two.test", port: 1080, type: 5 },
      ] as never,
      testTarget: { host: "203.0.113.30", port: 22 },
    });

    const call = socksCalls[0] as { proxies: Array<{ host: string }> };
    expect(call.proxies.map((p) => p.host)).toEqual([
      "203.0.113.1",
      "203.0.113.2",
    ]);
  });

  it("refuses an IPv4 mapped loopback literal", async () => {
    await expect(
      testProxyConnectivity({
        singleProxy: { host: "::ffff:127.0.0.1", port: 1080, type: 5 },
        testTarget: { host: "203.0.113.20", port: 22 },
      }),
    ).rejects.toThrow(/not allowed/);
  });
});

describe("GHSA-64cc-43f9-c2v3 outbound fetch lookup hook", () => {
  it("hands the socket the one address it checked", async () => {
    const { createDnsLookupHook } =
      await import("../../utils/safe-outbound-fetch.js");
    let calls = 0;
    const fake = (
      _host: string,
      _options: unknown,
      cb: (e: null, a: Array<{ address: string; family: number }>) => void,
    ) => {
      calls += 1;
      cb(null, [
        { address: calls === 1 ? "203.0.113.10" : "127.0.0.1", family: 4 },
      ]);
    };
    const hook = createDnsLookupHook(fake as never);
    const result = await new Promise<unknown>((resolve, reject) =>
      hook("rebind.test", {}, (error, address) =>
        error ? reject(error) : resolve(address),
      ),
    );
    expect(result).toBe("203.0.113.10");
    expect(calls).toBe(1);
  });
});
