import { describe, it, expect, vi, beforeEach } from "vitest";

const execCommand = vi.fn();
vi.mock("../../../../hosts/metrics/widgets/common-utils.js", () => ({
  execCommand: (...args: unknown[]) => execCommand(...args),
  toFixedNum: (n: number | null | undefined, digits = 2) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    return Number(n.toFixed(digits));
  },
}));

import { collectProxmoxGuestsSummary } from "../../../../hosts/metrics/proxmox/guests-collector.js";
import type { Client } from "ssh2";

const fakeClient = {} as Client;

function result(stdout: string, code: number | null = 0) {
  return { stdout, stderr: "", code };
}

beforeEach(() => {
  execCommand.mockReset();
});

describe("collectProxmoxGuestsSummary", () => {
  it("filters to the target node, excludes templates, and computes percentages", async () => {
    execCommand.mockResolvedValueOnce(
      result(
        JSON.stringify([
          {
            type: "qemu",
            node: "pve1",
            vmid: 100,
            name: "vm-a",
            status: "running",
            cpu: 0.25,
            mem: 2 * 1024 ** 3,
            maxmem: 4 * 1024 ** 3,
            disk: 10 * 1024 ** 3,
            maxdisk: 40 * 1024 ** 3,
            uptime: 3600,
          },
          {
            type: "lxc",
            node: "pve1",
            vmid: 101,
            name: "ct-b",
            status: "stopped",
            cpu: 0,
            mem: 0,
            maxmem: 512 * 1024 ** 2,
            disk: 0,
            maxdisk: 8 * 1024 ** 3,
            uptime: 0,
          },
          {
            // different node - excluded
            type: "qemu",
            node: "pve2",
            vmid: 200,
            name: "elsewhere",
            status: "running",
          },
          {
            // template - excluded
            type: "qemu",
            node: "pve1",
            vmid: 999,
            name: "template",
            status: "stopped",
            template: 1,
          },
          {
            // non-guest resource type - excluded
            type: "storage",
            node: "pve1",
          },
        ]),
      ),
    );

    const res = await collectProxmoxGuestsSummary(fakeClient, "pve1");

    expect(res.guests).toHaveLength(2);
    expect(res.counts).toEqual({ running: 1, stopped: 1, total: 2 });

    const vmA = res.guests.find((g) => g.vmid === 100)!;
    expect(vmA.cpuPercent).toBe(25);
    expect(vmA.memPercent).toBe(50);
    expect(vmA.diskPercent).toBe(25);
  });

  it("reports null disk fields (not a false 0%) when maxdisk is 0", async () => {
    execCommand.mockResolvedValueOnce(
      result(
        JSON.stringify([
          {
            type: "qemu",
            node: "pve1",
            vmid: 100,
            name: "vm-no-agent",
            status: "running",
            cpu: 0.1,
            mem: 1024,
            maxmem: 2048,
            disk: 0,
            maxdisk: 0,
            uptime: 10,
          },
        ]),
      ),
    );

    const res = await collectProxmoxGuestsSummary(fakeClient, "pve1");
    expect(res.guests[0].diskPercent).toBeNull();
    expect(res.guests[0].diskUsedGiB).toBeNull();
    expect(res.guests[0].diskTotalGiB).toBeNull();
  });

  it("returns an empty guest list when there are no matching resources", async () => {
    execCommand.mockResolvedValueOnce(result(JSON.stringify([]), 0));
    const res = await collectProxmoxGuestsSummary(fakeClient, "pve1");
    expect(res.guests).toEqual([]);
    expect(res.counts).toEqual({ running: 0, stopped: 0, total: 0 });
  });

  it("returns an empty result when pvesh is missing (non-zero exit)", async () => {
    execCommand.mockResolvedValueOnce(result("", 127));
    const res = await collectProxmoxGuestsSummary(fakeClient, "pve1");
    expect(res.guests).toEqual([]);
  });

  it("returns an empty result on malformed JSON", async () => {
    execCommand.mockResolvedValueOnce(result("{not json", 0));
    const res = await collectProxmoxGuestsSummary(fakeClient, "pve1");
    expect(res.guests).toEqual([]);
  });

  it("rejects an unsafe node name before running any command", async () => {
    const res = await collectProxmoxGuestsSummary(fakeClient, "../etc");
    expect(res.guests).toEqual([]);
    expect(execCommand).not.toHaveBeenCalled();
  });
});
