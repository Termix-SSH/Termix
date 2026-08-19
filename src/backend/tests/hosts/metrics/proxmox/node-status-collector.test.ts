import { describe, it, expect, vi, beforeEach } from "vitest";

const execCommand = vi.fn();
vi.mock("../../../../hosts/metrics/widgets/common-utils.js", () => ({
  execCommand: (...args: unknown[]) => execCommand(...args),
  toFixedNum: (n: number | null | undefined, digits = 2) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    return Number(n.toFixed(digits));
  },
}));

import { collectProxmoxNodeStatus } from "../../../../hosts/metrics/proxmox/node-status-collector.js";
import type { Client } from "ssh2";

const fakeClient = {} as Client;

function result(stdout: string, code: number | null = 0) {
  return { stdout, stderr: "", code };
}

beforeEach(() => {
  execCommand.mockReset();
});

describe("collectProxmoxNodeStatus", () => {
  it("parses a healthy pvesh /nodes/{node}/status response", async () => {
    execCommand.mockResolvedValueOnce(
      result(
        JSON.stringify({
          cpu: 0.15,
          cpuinfo: { cores: 8 },
          loadavg: ["0.5", "0.6", "0.7"],
          memory: { used: 4 * 1024 ** 3, total: 16 * 1024 ** 3 },
          rootfs: { used: 20 * 1024 ** 3, total: 100 * 1024 ** 3 },
          uptime: 90061,
          hostname: "pve1",
          kversion: "Linux 6.8.0",
          pveversion: "pve-manager/8.2.0",
        }),
      ),
    );

    const res = await collectProxmoxNodeStatus(fakeClient, "pve1");

    expect(res.cpu.percent).toBe(15);
    expect(res.cpu.cores).toBe(8);
    expect(res.cpu.load).toEqual([0.5, 0.6, 0.7]);
    expect(res.memory.percent).toBe(25);
    expect(res.memory.usedGiB).toBeCloseTo(4, 1);
    expect(res.memory.totalGiB).toBeCloseTo(16, 1);
    expect(res.disk.percent).toBe(20);
    expect(res.uptime.seconds).toBe(90061);
    expect(res.uptime.formatted).toBe("1d 1h 1m");
    expect(res.system.hostname).toBe("pve1");
    expect(res.system.kernel).toBe("Linux 6.8.0");
    expect(res.system.pveVersion).toBe("pve-manager/8.2.0");
  });

  it("returns a fully null-filled shape when pvesh exits non-zero", async () => {
    execCommand.mockResolvedValueOnce(result("", 1));
    const res = await collectProxmoxNodeStatus(fakeClient, "pve1");
    expect(res.cpu.percent).toBeNull();
    expect(res.memory.percent).toBeNull();
    expect(res.disk.percent).toBeNull();
    expect(res.uptime.seconds).toBeNull();
    expect(res.system.hostname).toBeNull();
  });

  it("returns null-filled shape on malformed JSON", async () => {
    execCommand.mockResolvedValueOnce(result("not json", 0));
    const res = await collectProxmoxNodeStatus(fakeClient, "pve1");
    expect(res.cpu.percent).toBeNull();
  });

  it("rejects an unsafe node name before running any command", async () => {
    const res = await collectProxmoxNodeStatus(fakeClient, "pve1; rm -rf /");
    expect(res.cpu.percent).toBeNull();
    expect(execCommand).not.toHaveBeenCalled();
  });
});
