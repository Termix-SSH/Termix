import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { Client } from "ssh2";
import {
  SSHConnectionPool,
  withConnection,
} from "../../hosts/ssh-connection-pool.js";

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
    const pool = new SSHConnectionPool();
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

  it("skips unhealthy idle connections in getConnection and reuses a later healthy one", async () => {
    const pool = new SSHConnectionPool();
    const first = deferredClient();
    const second = deferredClient();
    first.resolve(first.client);
    second.resolve(second.client);

    const c1 = await pool.getConnection("host", () => first.promise);
    const c2 = await pool.getConnection("host", () => second.promise);
    pool.releaseConnection("host", c1);
    pool.releaseConnection("host", c2);

    // Mark the first idle connection dead after release.
    (
      first.client as unknown as {
        _sock: { destroyed: boolean; writable: boolean };
      }
    )._sock.destroyed = true;

    const factory = vi.fn(() => deferredClient().promise);
    const reused = await pool.getConnection("host", factory);
    expect(reused).toBe(second.client);
    expect(first.client.end).toHaveBeenCalledOnce();
    expect(factory).not.toHaveBeenCalled();
    pool.destroy();
  });

  it("skips unhealthy idle connections in wakeWaiter and hands a later healthy one to the waiter", async () => {
    const pool = new SSHConnectionPool();
    const a = deferredClient();
    const b = deferredClient();
    const c = deferredClient();
    a.resolve(a.client);
    b.resolve(b.client);
    c.resolve(c.client);
    const gotA = await pool.getConnection("h", () => a.promise);
    const gotB = await pool.getConnection("h", () => b.promise);
    const gotC = await pool.getConnection("h", () => c.promise);

    // Enqueue a waiter while all 3 are in use.
    const waiterFactory = vi.fn(() => deferredClient().promise);
    const waiter = pool.getConnection("h", waiterFactory);

    // Simulate a becoming idle and dead before b is released (socket died without close event).
    const conns = (
      pool as unknown as {
        connections: Map<string, Array<{ client: Client; inUse: boolean }>>;
      }
    ).connections.get("h")!;
    conns[0].inUse = false;
    (
      gotA as unknown as { _sock: { destroyed: boolean; writable: boolean } }
    )._sock.destroyed = true;

    // Releasing b calls wakeWaiter("h"), which sees [deadIdle(a), healthyIdle(b), inUse(c)].
    pool.releaseConnection("h", gotB);
    await expect(waiter).resolves.toBe(gotB);
    expect(gotA.end).toHaveBeenCalledOnce();
    expect(waiterFactory).not.toHaveBeenCalled();

    pool.releaseConnection("h", gotC);
    pool.destroy();
  });

  it("withConnection discards connection on transport/timeout error or unhealthy socket, and reuses on normal error", async () => {
    const pool = new SSHConnectionPool();
    const c1 = deferredClient();
    const c2 = deferredClient();
    const c3 = deferredClient();
    c1.resolve(c1.client);
    c2.resolve(c2.client);
    c3.resolve(c3.client);

    // 1. Transport error (ECONNRESET) -> discarded, not reused.
    const resetErr = Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
    });
    await expect(
      withConnection(
        "h",
        () => c1.promise,
        async () => {
          throw resetErr;
        },
        pool,
      ),
    ).rejects.toThrow("read ECONNRESET");
    expect(c1.client.end).toHaveBeenCalledOnce();

    // 2. Normal application error on healthy connection -> kept and reused.
    let seenClient: Client | null = null;
    await expect(
      withConnection(
        "h",
        () => c2.promise,
        async (client) => {
          seenClient = client;
          throw new Error("permission denied");
        },
        pool,
      ),
    ).rejects.toThrow("permission denied");
    expect(seenClient).toBe(c2.client);
    expect(c2.client.end).not.toHaveBeenCalled();

    const reused = await withConnection(
      "h",
      () => c3.promise,
      async (client) => {
        // Mark socket unhealthy during execution -> should be discarded on exit.
        (
          client as unknown as {
            _sock: { destroyed: boolean; writable: boolean };
          }
        )._sock.writable = false;
        return client;
      },
      pool,
    );
    expect(reused).toBe(c2.client);
    expect(c2.client.end).toHaveBeenCalledOnce();

    // Next call gets c3 because c2 was discarded.
    const fresh = await withConnection(
      "h",
      () => c3.promise,
      async (client) => client,
      pool,
    );
    expect(fresh).toBe(c3.client);
    pool.destroy();
  });
});
