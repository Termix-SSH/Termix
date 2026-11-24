import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { Client } from "ssh2";
import { SSHConnectionPool } from "../../hosts/ssh-connection-pool.js";

function deferredClient() {
  let resolve!: (client: Client) => void;
  const promise = new Promise<Client>((done) => {
    resolve = done;
  });
  const client = new EventEmitter() as EventEmitter & {
    end: ReturnType<typeof vi.fn>;
    _sock: { destroyed: boolean; writable: boolean };
  };
  client.end = vi.fn();
  client._sock = { destroyed: false, writable: true };
  return { client: client as unknown as Client, promise, resolve };
}

describe("SSHConnectionPool", () => {
  it("counts pending factories against the per-host connection limit", async () => {
    const pool = new SSHConnectionPool();
    const clients = Array.from({ length: 4 }, deferredClient);
    let factoryCalls = 0;
    const factory = vi.fn(() => clients[factoryCalls++].promise);

    const requests = Array.from({ length: 4 }, () =>
      pool.getConnection("same-host", factory),
    );
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(3));

    clients[0].resolve(clients[0].client);
    const first = await requests[0];
    pool.releaseConnection("same-host", first);

    await expect(requests[3]).resolves.toBe(first);
    expect(factory).toHaveBeenCalledTimes(3);

    clients[1].resolve(clients[1].client);
    clients[2].resolve(clients[2].client);
    await Promise.all([requests[1], requests[2]]);
    pool.destroy();
  });

  it("tracks every client from concurrent connects to a new host", async () => {
    const pool = new SSHConnectionPool();
    const clients = Array.from({ length: 3 }, deferredClient);
    let factoryCalls = 0;
    const factory = vi.fn(() => clients[factoryCalls++].promise);

    const requests = Array.from({ length: 3 }, () =>
      pool.getConnection("new-host", factory),
    );
    for (const pending of clients) pending.resolve(pending.client);
    const connected = await Promise.all(requests);

    for (const client of connected) pool.releaseConnection("new-host", client);
    const reused = await Promise.all(
      Array.from({ length: 3 }, () => pool.getConnection("new-host", factory)),
    );
    expect(new Set(reused)).toEqual(new Set(connected));
    expect(factory).toHaveBeenCalledTimes(3);

    pool.clearKeyConnections("new-host");
    for (const pending of clients) {
      expect(pending.client.end).toHaveBeenCalledOnce();
    }
    pool.destroy();
  });

  it("does not resurrect a connection removed while another connects", async () => {
    const pool = new SSHConnectionPool({ maxChannelsPerConnection: 1 });
    const first = deferredClient();
    const second = deferredClient();
    first.resolve(first.client);
    await pool.getConnection("host", () => first.promise);

    const request = pool.getConnection("host", () => second.promise);
    first.client.emit("close");
    second.resolve(second.client);
    await expect(request).resolves.toBe(second.client);

    pool.releaseConnection("host", first.client);
    pool.releaseConnection("host", second.client);
    await expect(
      pool.getConnection("host", () => deferredClient().promise),
    ).resolves.toBe(second.client);
    pool.destroy();
  });

  it("discards a pending connection when its host pool is cleared", async () => {
    const pool = new SSHConnectionPool();
    const pending = deferredClient();
    const request = pool.getConnection("cleared-host", () => pending.promise);

    pool.clearKeyConnections("cleared-host");
    pending.resolve(pending.client);

    await expect(request).rejects.toThrow(
      "SSH connection pool cleared for cleared-host",
    );
    expect(pending.client.end).toHaveBeenCalledOnce();
    pool.destroy();
  });

  it("rejects new connections after the pool is destroyed", async () => {
    const pool = new SSHConnectionPool();
    pool.destroy();

    await expect(
      pool.getConnection("host", () => deferredClient().promise),
    ).rejects.toThrow("SSH connection pool destroyed");
  });

  it("multiplexes channels up to maxChannelsPerConnection before opening another connection", async () => {
    const pool = new SSHConnectionPool({
      maxConnectionsPerHost: 2,
      maxChannelsPerConnection: 3,
    });
    const clients = Array.from({ length: 2 }, deferredClient);
    let idx = 0;
    const factory = vi.fn(() => {
      const next = clients[idx++];
      next.resolve(next.client);
      return next.promise;
    });

    const first = await pool.getConnection("mux-host", factory);
    const second = await pool.getConnection("mux-host", factory);
    const third = await pool.getConnection("mux-host", factory);
    expect(first).toBe(clients[0].client);
    expect(second).toBe(clients[0].client);
    expect(third).toBe(clients[0].client);
    expect(factory).toHaveBeenCalledTimes(1);

    // 4th active channel exceeds maxChannelsPerConnection=3 -> opens 2nd connection
    const fourth = await pool.getConnection("mux-host", factory);
    expect(fourth).toBe(clients[1].client);
    expect(factory).toHaveBeenCalledTimes(2);

    // 5th prefers the least loaded healthy connection (clients[1]: 1 < clients[0]: 3)
    const fifth = await pool.getConnection("mux-host", factory);
    expect(fifth).toBe(clients[1].client);
    expect(factory).toHaveBeenCalledTimes(2);

    pool.destroy();
  });

  it("queues when all connections reach maxChannelsPerConnection and wakes waiters on release", async () => {
    const pool = new SSHConnectionPool({
      maxConnectionsPerHost: 1,
      maxChannelsPerConnection: 2,
    });
    const only = deferredClient();
    only.resolve(only.client);
    const factory = vi.fn(() => only.promise);

    const c1 = await pool.getConnection("full-host", factory);
    const c2 = await pool.getConnection("full-host", factory);
    expect(c1).toBe(only.client);
    expect(c2).toBe(only.client);

    // Full (1 connection * 2 channels) -> waiter queues
    let resolvedThird = false;
    const pendingThird = pool
      .getConnection("full-host", factory)
      .then((client) => {
        resolvedThird = true;
        return client;
      });
    await Promise.resolve();
    expect(resolvedThird).toBe(false);
    expect(factory).toHaveBeenCalledTimes(1);

    // Releasing one channel (2 -> 1) immediately wakes the queued waiter
    pool.releaseConnection("full-host", c1);
    await expect(pendingThird).resolves.toBe(only.client);
    expect(factory).toHaveBeenCalledTimes(1);

    pool.destroy();
  });

  it("evicts unhealthy connections and opens a fresh one instead of reusing them", async () => {
    const pool = new SSHConnectionPool({
      maxConnectionsPerHost: 2,
      maxChannelsPerConnection: 4,
    });
    const stale = deferredClient();
    const fresh = deferredClient();
    stale.resolve(stale.client);
    fresh.resolve(fresh.client);
    const factory = vi
      .fn()
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => fresh.promise);

    const c1 = await pool.getConnection("health-host", factory);
    expect(c1).toBe(stale.client);

    // Mark underlying socket unhealthy
    (
      stale.client as unknown as {
        _sock: { destroyed: boolean; writable: boolean };
      }
    )._sock.writable = false;

    const c2 = await pool.getConnection("health-host", factory);
    expect(c2).toBe(fresh.client);
    expect(stale.client.end).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledTimes(2);

    pool.destroy();
  });

  it("only expires idle connections once activeChannels reaches zero", async () => {
    vi.useFakeTimers();
    try {
      const pool = new SSHConnectionPool({
        maxConnectionsPerHost: 1,
        maxChannelsPerConnection: 4,
        idleMaxAgeMs: 1_000,
        cleanupIntervalMs: 500,
      });
      const first = deferredClient();
      first.resolve(first.client);
      const factory = vi.fn(() => first.promise);

      const a = await pool.getConnection("idle-host", factory);
      const b = await pool.getConnection("idle-host", factory);
      expect(a).toBe(b);

      // Release only one channel -> still active, must not be evicted
      pool.releaseConnection("idle-host", a);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(first.client.end).not.toHaveBeenCalled();

      // Release last channel -> starts idle age timer and gets evicted after TTL
      pool.releaseConnection("idle-host", b);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(first.client.end).toHaveBeenCalledOnce();

      pool.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
