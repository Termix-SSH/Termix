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
});
