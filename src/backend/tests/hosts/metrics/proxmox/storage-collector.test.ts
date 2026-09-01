import { describe, it, expect, vi, beforeEach } from "vitest";

const execCommand = vi.fn();
vi.mock("../../../../hosts/metrics/widgets/common-utils.js", () => ({
  execCommand: (...args: unknown[]) => execCommand(...args),
  toFixedNum: (n: number | null | undefined, digits = 2) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    return Number(n.toFixed(digits));
  },
}));

import { collectProxmoxStorage } from "../../../../hosts/metrics/proxmox/storage-collector.js";
import type { Client } from "ssh2";

const fakeClient = {} as Client;

function result(stdout: string, code: number | null = 0) {
  return { stdout, stderr: "", code };
}

beforeEach(() => {
  execCommand.mockReset();
});

describe("collectProxmoxStorage", () => {
  it("parses storage pools with usage percentages", async () => {
    execCommand.mockResolvedValueOnce(
      result(
        JSON.stringify([
          {
            storage: "local",
            type: "dir",
            active: 1,
            enabled: 1,
            used: 20 * 1024 ** 3,
            total: 100 * 1024 ** 3,
            avail: 80 * 1024 ** 3,
          },
          {
            storage: "local-zfs",
            type: "zfspool",
            active: 0,
            enabled: 1,
            used: 0,
            total: 0,
            avail: 0,
          },
        ]),
      ),
    );

    const res = await collectProxmoxStorage(fakeClient, "pve1");
    expect(res.pools).toHaveLength(2);
    expect(res.pools[0].name).toBe("local");
    expect(res.pools[0].active).toBe(true);
    expect(res.pools[0].percent).toBe(20);
    expect(res.pools[1].active).toBe(false);
    expect(res.pools[1].percent).toBeNull();
  });

  it("returns an empty pool list when pvesh fails", async () => {
    execCommand.mockResolvedValueOnce(result("", 1));
    const res = await collectProxmoxStorage(fakeClient, "pve1");
    expect(res.pools).toEqual([]);
  });

  it("returns an empty pool list on malformed JSON", async () => {
    execCommand.mockResolvedValueOnce(result("nope", 0));
    const res = await collectProxmoxStorage(fakeClient, "pve1");
    expect(res.pools).toEqual([]);
  });

  it("rejects an unsafe node name before running any command", async () => {
    const res = await collectProxmoxStorage(fakeClient, "$(whoami)");
    expect(res.pools).toEqual([]);
    expect(execCommand).not.toHaveBeenCalled();
  });
});
