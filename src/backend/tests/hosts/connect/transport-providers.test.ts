import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  performPortKnocking: vi.fn(),
  createJumpHostChain: vi.fn(),
  createSocks5Connection: vi.fn(),
}));

vi.mock("../../../utils/logger.js", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: log, sshLogger: log };
});
vi.mock("../../../hosts/terminal-auth-helpers.js", () => ({
  performPortKnocking: mocks.performPortKnocking,
}));
vi.mock("../../../hosts/jump-host-chain.js", () => ({
  createJumpHostChain: mocks.createJumpHostChain,
}));
vi.mock("../../../utils/socks5-helper.js", () => ({
  createSocks5Connection: mocks.createSocks5Connection,
}));
vi.mock("../../../hosts/ssh-dns.js", () => ({
  resolveSshConnectConfigHost: async (config: unknown) => config,
}));

const { clearSshTransports, openProvidedTransport, provideSshTransport } =
  await import("../../../hosts/connect/transport-providers.js");
const { openSshTransport } =
  await import("../../../hosts/connect/transport.js");

const host = { id: 7, ip: "10.0.0.7", port: 22, username: "root" };

afterEach(() => {
  clearSshTransports();
  vi.clearAllMocks();
});

describe("ssh transport providers", () => {
  it("opens nothing when no provider claims the host", async () => {
    provideSshTransport("a", { claims: () => false, open: vi.fn() });
    expect(await openProvidedTransport(host)).toBeNull();
  });

  it("hands back the claiming provider's stream", async () => {
    const stream = new PassThrough();
    const open = vi.fn(async () => stream);
    provideSshTransport("a", { claims: (id) => id === 7, open });
    expect(await openProvidedTransport(host)).toBe(stream);
    expect(open).toHaveBeenCalledWith(host);
    expect(await openProvidedTransport({ ...host, id: 8 })).toBeNull();
  });

  it("treats a provider that throws while claiming as not claiming", async () => {
    provideSshTransport("a", {
      claims: () => {
        throw new Error("boom");
      },
      open: vi.fn(),
    });
    expect(await openProvidedTransport(host)).toBeNull();
  });

  it("stops using a provider once it is removed", async () => {
    const remove = provideSshTransport("a", {
      claims: () => true,
      open: async () => new PassThrough(),
    });
    remove();
    expect(await openProvidedTransport(host)).toBeNull();
  });
});

describe("openSshTransport with a provider", () => {
  it("uses the provided stream and skips knocking, jump hosts and proxies", async () => {
    const stream = new PassThrough();
    provideSshTransport("a", { claims: () => true, open: async () => stream });
    const config: Record<string, unknown> = {};
    const result = await openSshTransport(
      {
        ...host,
        portKnockSequence: [{ port: 1 }],
        jumpHosts: [{ hostId: 1 }],
        useSocks5: true,
        socks5Host: "proxy",
        userId: "u1",
      } as never,
      config as never,
    );
    expect(result).toEqual({ jumpClient: null, via: "provided" });
    expect(config.sock).toBe(stream);
    expect(mocks.performPortKnocking).not.toHaveBeenCalled();
    expect(mocks.createJumpHostChain).not.toHaveBeenCalled();
    expect(mocks.createSocks5Connection).not.toHaveBeenCalled();
  });

  it("connects directly when nothing claims the host", async () => {
    const config: Record<string, unknown> = {};
    const result = await openSshTransport(host as never, config as never);
    expect(result.via).toBe("direct");
    expect(config.sock).toBeUndefined();
  });
});
