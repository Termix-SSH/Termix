import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "ssh2";
import {
  buildJumpChainKey,
  JumpChainPool,
} from "../../hosts/jump-chain-pool.js";

function createFakeClient() {
  const client = new EventEmitter() as EventEmitter & {
    end: ReturnType<typeof vi.fn>;
    _sock: { destroyed: boolean; writable: boolean };
  };
  client.end = vi.fn();
  client._sock = { destroyed: false, writable: true };
  return client as unknown as Client & {
    end: ReturnType<typeof vi.fn>;
    _sock: { destroyed: boolean; writable: boolean };
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("JumpChainPool", () => {
  it("builds deterministic keys scoped by userId and ordered hop ids", () => {
    expect(buildJumpChainKey("u1", [{ hostId: 1 }, { hostId: 2 }])).toBe(
      "u1:1>2",
    );
    expect(buildJumpChainKey("u1", [{ hostId: 2 }, { hostId: 1 }])).toBe(
      "u1:2>1",
    );
    expect(buildJumpChainKey("u2", [{ hostId: 1 }, { hostId: 2 }])).toBe(
      "u2:1>2",
    );
  });

  it("deduplicates concurrent opens for the same user and hop chain (singleflight)", async () => {
    const deferred = createDeferred<Client | null>();
    const client = createFakeClient();
    const open = vi.fn(() => deferred.promise);
    const pool = new JumpChainPool(open);
    const hops = [{ hostId: 10 }, { hostId: 20 }];

    const p1 = pool.acquire(hops, "user-1");
    const p2 = pool.acquire(hops, "user-1");
    const p3 = pool.acquire(hops, "user-1");

    expect(open).toHaveBeenCalledTimes(1);
    expect(pool.getStats()).toEqual({ size: 0, inflight: 1, totalRefs: 0 });

    deferred.resolve(client);
    const [l1, l2, l3] = await Promise.all([p1, p2, p3]);

    expect(l1?.client).toBe(client);
    expect(l2?.client).toBe(client);
    expect(l3?.client).toBe(client);
    expect(pool.getStats()).toEqual({ size: 1, inflight: 0, totalRefs: 3 });

    // Releasing is idempotent
    l1?.release();
    l1?.release();
    expect(pool.getStats().totalRefs).toBe(2);

    l2?.release();
    l3?.release();
    expect(pool.getStats().totalRefs).toBe(0);
    pool.destroy();
  });

  it("isolates chains per userId and hop sequence", async () => {
    const open = vi.fn(async () => createFakeClient());
    const pool = new JumpChainPool(open);

    const a = await pool.acquire([{ hostId: 1 }], "u1");
    const b = await pool.acquire([{ hostId: 1 }], "u2");
    const c = await pool.acquire([{ hostId: 2 }], "u1");

    expect(open).toHaveBeenCalledTimes(3);
    expect(new Set([a?.client, b?.client, c?.client]).size).toBe(3);

    a?.release();
    b?.release();
    c?.release();
    pool.destroy();
  });

  it("keeps chain alive while referenced and evicts after idle TTL once refCount hits zero", async () => {
    vi.useFakeTimers();
    const first = createFakeClient();
    const second = createFakeClient();
    const open = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const pool = new JumpChainPool(open, { idleTtlMs: 1_000 });
    const hops = [{ hostId: 1 }];

    const l1 = await pool.acquire(hops, "u1");
    const l2 = await pool.acquire(hops, "u1");
    l1?.release();

    // Still referenced by l2 -> must NOT be evicted
    await vi.advanceTimersByTimeAsync(2_000);
    expect(first.end).not.toHaveBeenCalled();

    // Release last ref -> idle TTL starts
    l2?.release();
    await vi.advanceTimersByTimeAsync(500);
    expect(first.end).not.toHaveBeenCalled();

    // Re-acquiring before TTL cancels eviction
    const l3 = await pool.acquire(hops, "u1");
    expect(l3?.client).toBe(first);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(first.end).not.toHaveBeenCalled();

    // Release and let TTL expire
    l3?.release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(first.end).toHaveBeenCalledOnce();
    expect(pool.getStats().size).toBe(0);

    // Next acquire opens a fresh chain
    const l4 = await pool.acquire(hops, "u1");
    expect(l4?.client).toBe(second);
    expect(open).toHaveBeenCalledTimes(2);
    l4?.release();
    pool.destroy();
  });

  it("evicts immediately on lease.invalidate(), close/error events, or unhealthy socket", async () => {
    const c1 = createFakeClient();
    const c2 = createFakeClient();
    const c3 = createFakeClient();
    const c4 = createFakeClient();
    const open = vi
      .fn()
      .mockResolvedValueOnce(c1)
      .mockResolvedValueOnce(c2)
      .mockResolvedValueOnce(c3)
      .mockResolvedValueOnce(c4);
    const pool = new JumpChainPool(open);
    const hops = [{ hostId: 5 }];

    // 1. lease.invalidate()
    const l1 = await pool.acquire(hops, "u1");
    l1?.invalidate();
    expect(c1.end).toHaveBeenCalledOnce();
    expect(pool.getStats().size).toBe(0);

    // 2. close event
    const l2 = await pool.acquire(hops, "u1");
    expect(l2?.client).toBe(c2);
    c2.emit("close");
    expect(pool.getStats().size).toBe(0);

    // 3. unhealthy socket
    const l3 = await pool.acquire(hops, "u1");
    expect(l3?.client).toBe(c3);
    l3?.release();
    c3._sock.destroyed = true;

    const l4 = await pool.acquire(hops, "u1");
    expect(l4?.client).toBe(c4);
    expect(c3.end).toHaveBeenCalledOnce();
    l4?.release();
    pool.destroy();
  });

  it("discards an inflight open if invalidated before it resolves", async () => {
    const deferred = createDeferred<Client | null>();
    const stale = createFakeClient();
    const fresh = createFakeClient();
    const open = vi
      .fn()
      .mockImplementationOnce(() => deferred.promise)
      .mockResolvedValueOnce(fresh);
    const pool = new JumpChainPool(open);
    const hops = [{ hostId: 7 }];

    const pending = pool.acquire(hops, "u1");
    pool.invalidate(hops, "u1");

    // A new acquire can immediately start without waiting for the invalidated one
    const freshLease = await pool.acquire(hops, "u1");
    expect(freshLease?.client).toBe(fresh);

    // Old inflight resolves later -> must be closed and return null
    deferred.resolve(stale);
    await expect(pending).resolves.toBeNull();
    expect(stale.end).toHaveBeenCalledOnce();
    expect(pool.getStats().size).toBe(1);

    freshLease?.release();
    pool.destroy();
  });

  it("does not cache failed or null opens and allows retries", async () => {
    const good = createFakeClient();
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(good);
    const pool = new JumpChainPool(open);
    const hops = [{ hostId: 9 }];

    await expect(pool.acquire(hops, "u1")).rejects.toThrow("boom");
    await expect(pool.acquire(hops, "u1")).resolves.toBeNull();

    const lease = await pool.acquire(hops, "u1");
    expect(lease?.client).toBe(good);
    lease?.release();
    pool.destroy();
  });

  it("releases automatically in withJumpChain and rejects after destroy()", async () => {
    const client = createFakeClient();
    const pool = new JumpChainPool(async () => client);
    const hops = [{ hostId: 3 }];

    const result = await pool.withJumpChain(hops, "u1", async (lease) => {
      expect(lease.client).toBe(client);
      expect(pool.getStats().totalRefs).toBe(1);
      return "ok";
    });
    expect(result).toBe("ok");
    expect(pool.getStats().totalRefs).toBe(0);

    pool.destroy();
    expect(client.end).toHaveBeenCalledOnce();
    await expect(pool.acquire(hops, "u1")).rejects.toThrow(
      "JumpChainPool destroyed",
    );
  });
});
