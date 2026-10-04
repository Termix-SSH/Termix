import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JumpProbePool } from "../../../hosts/status/jump-probe-pool.js";

function fakeClient(reachable = true) {
  const client = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    forwardOut: vi.fn(
      (
        _srcIp: string,
        _srcPort: number,
        _host: string,
        _port: number,
        callback: (error: Error | null, stream?: { destroy(): void }) => void,
      ) => {
        callback(
          reachable ? null : new Error("refused"),
          reachable ? { destroy: () => {} } : undefined,
        );
      },
    ),
  });
  return client;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("JumpProbePool", () => {
  it("shares one chain across hosts behind the same hops", async () => {
    const client = fakeClient();
    const open = vi.fn(async () => client as never);
    const pool = new JumpProbePool(open);
    const hops = [{ hostId: 1 }, { hostId: 2 }];

    const results = await Promise.all([
      pool.ping(hops, "u1", "10.0.0.3", 22),
      pool.ping(hops, "u1", "10.0.0.4", 22),
      pool.ping(hops, "u1", "10.0.0.5", 22),
    ]);

    expect(results).toEqual([true, true, true]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(client.forwardOut).toHaveBeenCalledTimes(3);
    expect(client.end).not.toHaveBeenCalled();
    pool.closeAll();
  });

  it("keeps chains apart per user and hop list", async () => {
    const open = vi.fn(async () => fakeClient() as never);
    const pool = new JumpProbePool(open);
    await pool.ping([{ hostId: 1 }], "u1", "a", 22);
    await pool.ping([{ hostId: 1 }], "u2", "a", 22);
    await pool.ping([{ hostId: 2 }], "u1", "a", 22);
    expect(open).toHaveBeenCalledTimes(3);
    pool.closeAll();
  });

  it("reports an unreachable target without dropping the chain", async () => {
    const client = fakeClient(false);
    const open = vi.fn(async () => client as never);
    const pool = new JumpProbePool(open);
    expect(await pool.ping([{ hostId: 1 }], "u1", "a", 22)).toBe(false);
    expect(await pool.ping([{ hostId: 1 }], "u1", "b", 22)).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    pool.closeAll();
  });

  it("drops a chain whose hop stops answering", async () => {
    vi.useFakeTimers();
    const stale = Object.assign(new EventEmitter(), {
      end: vi.fn(),
      forwardOut: vi.fn(),
    });
    const fresh = fakeClient();
    const open = vi
      .fn()
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(fresh);
    const pool = new JumpProbePool(open);

    const first = pool.ping([{ hostId: 1 }], "u1", "a", 22, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toBe(false);
    expect(stale.end).toHaveBeenCalled();

    expect(await pool.ping([{ hostId: 1 }], "u1", "a", 22)).toBe(true);
    expect(open).toHaveBeenCalledTimes(2);
    pool.closeAll();
  });

  it("retries a chain that failed to open", async () => {
    const open = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fakeClient());
    const pool = new JumpProbePool(open);
    expect(await pool.ping([{ hostId: 1 }], "u1", "a", 22)).toBe(false);
    expect(await pool.ping([{ hostId: 1 }], "u1", "a", 22)).toBe(true);
    pool.closeAll();
  });

  it("opens a new chain after the old one closed or sat idle", async () => {
    vi.useFakeTimers();
    const first = fakeClient();
    const second = fakeClient();
    const third = fakeClient();
    const open = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(third);
    const pool = new JumpProbePool(open, 1000);

    await pool.ping([{ hostId: 1 }], "u1", "a", 22);
    first.emit("close");
    await pool.ping([{ hostId: 1 }], "u1", "a", 22);
    expect(open).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1500);
    expect(second.end).toHaveBeenCalled();
    await pool.ping([{ hostId: 1 }], "u1", "a", 22);
    expect(open).toHaveBeenCalledTimes(3);
    pool.closeAll();
  });
});
