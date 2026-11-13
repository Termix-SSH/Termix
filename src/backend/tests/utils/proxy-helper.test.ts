import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import net from "net";
import type { AddressInfo } from "net";

const socks = vi.hoisted(() => ({
  single: [] as Array<Record<string, unknown>>,
  chains: [] as Array<Record<string, unknown>>,
}));

vi.mock("socks", async () => {
  const { Socket } = await import("net");
  return {
    SocksClient: {
      createConnection: async (options: Record<string, unknown>) => {
        socks.single.push(options);
        const proxy = options.proxy as { type: unknown };
        if (proxy.type !== 4 && proxy.type !== 5) {
          throw new Error("Invalid SOCKS proxy details were provided.");
        }
        return { socket: new Socket() };
      },
      createConnectionChain: async (options: Record<string, unknown>) => {
        socks.chains.push(options);
        for (const proxy of options.proxies as Array<{ type: unknown }>) {
          if (proxy.type !== 4 && proxy.type !== 5) {
            throw new Error("Invalid SOCKS proxy details were provided.");
          }
        }
        return { socket: new Socket() };
      },
    },
  };
});

const { createSocks5Connection, testProxyConnectivity } =
  await import("../../utils/proxy-helper.js");

// A tiny HTTP CONNECT proxy that answers with the status it is told to.
let connectServer: net.Server;
let connectPort = 0;
const seen: string[] = [];
const reply = { status: "200 Connection established" };

beforeAll(async () => {
  connectServer = net.createServer((socket) => {
    socket.once("data", (chunk) => {
      seen.push(chunk.toString());
      socket.write(`HTTP/1.1 ${reply.status}\r\n\r\n`);
    });
  });
  await new Promise<void>((r) => connectServer.listen(0, "127.0.0.1", r));
  connectPort = (connectServer.address() as AddressInfo).port;
});
afterAll(() => new Promise((r) => connectServer.close(r)));
beforeEach(() => {
  socks.single.length = 0;
  socks.chains.length = 0;
  seen.length = 0;
  reply.status = "200 Connection established";
});

describe("proxy chains from the host editor", () => {
  it("turns socks4 and socks5 into the numbers the socks client takes", async () => {
    const socket = await createSocks5Connection("10.0.0.5", 22, {
      useSocks5: true,
      socks5ProxyChain: [
        { host: "p1", port: 1080, type: "socks5" },
        { host: "p2", port: 1081, type: "socks4" },
        { host: "p3", port: 1082, type: 5 },
      ],
    });
    expect(socket).toBeInstanceOf(net.Socket);
    expect(
      (socks.chains[0].proxies as Array<{ type: number }>).map((p) => p.type),
    ).toEqual([5, 4, 5]);
  });

  it("goes hop by hop when a chain has an HTTP proxy", async () => {
    const socket = await createSocks5Connection("10.0.0.5", 22, {
      useSocks5: true,
      socks5ProxyChain: [
        {
          host: "127.0.0.1",
          port: connectPort,
          type: "http",
          username: "u",
          password: "p",
        },
        { host: "next", port: 1080, type: "socks5" },
      ],
    });
    expect(socket).toBeInstanceOf(net.Socket);
    expect(seen[0]).toContain("CONNECT next:1080 HTTP/1.1");
    expect(seen[0]).toContain(
      `Proxy-Authorization: Basic ${Buffer.from("u:p").toString("base64")}`,
    );
    expect((socks.single[0].proxy as { type: number }).type).toBe(5);
    socket?.destroy();
  });

  it("refuses an HTTP proxy that says no", async () => {
    reply.status = "407 Proxy Authentication Required";
    await expect(
      createSocks5Connection("10.0.0.5", 22, {
        useSocks5: true,
        socks5ProxyChain: [
          { host: "127.0.0.1", port: connectPort, type: "http" },
        ],
      }),
    ).rejects.toThrow("returned 407");
  });

  it("brackets IPv6 targets in CONNECT", async () => {
    const socket = await createSocks5Connection("2001:db8::1", 22, {
      useSocks5: true,
      socks5ProxyChain: [
        { host: "127.0.0.1", port: connectPort, type: "http" },
      ],
    });
    expect(seen[0]).toContain("CONNECT [2001:db8::1]:22 HTTP/1.1");
    socket?.destroy();
  });
});

describe("single proxy", () => {
  it("uses the socks host and port", async () => {
    await createSocks5Connection("h", 22, {
      useSocks5: true,
      socks5Host: "proxy",
      socks5Username: "a",
      socks5Password: "b",
    });
    expect(socks.single[0].proxy).toMatchObject({
      host: "proxy",
      port: 1080,
      type: 5,
      userId: "a",
    });
  });

  it("does nothing when the proxy is off or empty", async () => {
    expect(await createSocks5Connection("h", 22, {})).toBeNull();
    expect(
      await createSocks5Connection("h", 22, { useSocks5: true }),
    ).toBeNull();
  });
});

describe("testProxyConnectivity", () => {
  it("refuses private targets and private proxies", async () => {
    await expect(
      testProxyConnectivity({
        singleProxy: { host: "8.8.8.8", port: 1080 },
        testTarget: { host: "127.0.0.1", port: 22 },
      }),
    ).rejects.toThrow("not allowed");
    await expect(
      testProxyConnectivity({
        singleProxy: { host: "10.0.0.1", port: 1080 },
        testTarget: { host: "8.8.8.8", port: 443 },
      }),
    ).rejects.toThrow("not allowed");
    await expect(
      testProxyConnectivity({
        proxyChain: [{ host: "192.168.1.1", port: 1080, type: "socks5" }],
        testTarget: { host: "8.8.8.8", port: 443 },
      }),
    ).rejects.toThrow("not allowed");
  });

  it("measures a working proxy and needs one to be given", async () => {
    const result = await testProxyConnectivity({
      singleProxy: { host: "8.8.8.8", port: 1080, type: "socks5" as never },
      testTarget: { host: "1.1.1.1", port: 443 },
    });
    expect(result.success).toBe(true);
    expect((socks.single[0].proxy as { type: number }).type).toBe(5);
    await expect(
      testProxyConnectivity({ testTarget: { host: "1.1.1.1", port: 443 } }),
    ).rejects.toThrow("No proxy configuration provided");
  });
});
