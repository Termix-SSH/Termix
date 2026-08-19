import { describe, it, expect, vi, beforeEach } from "vitest";

const execCommand = vi.fn();
vi.mock("../../../../hosts/metrics/widgets/common-utils.js", () => ({
  execCommand: (...args: unknown[]) => execCommand(...args),
}));

import { collectProxmoxNodeNetwork } from "../../../../hosts/metrics/proxmox/node-network-collector.js";
import type { Client } from "ssh2";

const fakeClient = {} as Client;

function result(stdout: string, code: number | null = 0) {
  return { stdout, stderr: "", code };
}

beforeEach(() => {
  execCommand.mockReset();
});

describe("collectProxmoxNodeNetwork", () => {
  it("rejects an unsafe node name before running any command", async () => {
    const res = await collectProxmoxNodeNetwork(fakeClient, "bad;name");
    expect(res.interfaces).toEqual([]);
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("falls back to /proc/net/dev when pvesh netstat fails", async () => {
    // First call: pvesh netstat -> failure.
    execCommand.mockResolvedValueOnce(result("", 1));
    // Fallback calls: ip addr, ip link, /proc/net/dev.
    execCommand.mockResolvedValueOnce(result("eth0 10.0.0.5/24\n"));
    execCommand.mockResolvedValueOnce(result("eth0 UP\n"));
    execCommand.mockResolvedValueOnce(
      result(
        "Inter-|   Receive\n" +
          " face |bytes    packets\n" +
          "eth0: 123456    10    0    0    0     0          0         0   654321   20    0    0    0     0       0          0\n",
      ),
    );

    const res = await collectProxmoxNodeNetwork(fakeClient, "pve1");
    expect(res.interfaces).toHaveLength(1);
    expect(res.interfaces[0]).toMatchObject({
      name: "eth0",
      ip: "10.0.0.5",
      state: "UP",
      rxBytes: "123456",
      txBytes: "654321",
    });
  });

  it("falls back to /proc/net/dev when pvesh returns unparseable data", async () => {
    execCommand.mockResolvedValueOnce(result("not json", 0));
    execCommand.mockResolvedValueOnce(result(""));
    execCommand.mockResolvedValueOnce(result(""));
    execCommand.mockResolvedValueOnce(result("Inter-|   Receive\n face |\n"));

    const res = await collectProxmoxNodeNetwork(fakeClient, "pve1");
    expect(res.interfaces).toEqual([]);
  });
});
