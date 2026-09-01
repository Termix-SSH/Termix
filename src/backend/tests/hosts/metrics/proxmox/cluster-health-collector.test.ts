import { describe, it, expect, vi, beforeEach } from "vitest";

const execCommand = vi.fn();
vi.mock("../../../../hosts/metrics/widgets/common-utils.js", () => ({
  execCommand: (...args: unknown[]) => execCommand(...args),
}));

import { collectProxmoxClusterHealth } from "../../../../hosts/metrics/proxmox/cluster-health-collector.js";
import type { Client } from "ssh2";

const fakeClient = {} as Client;

function result(stdout: string, code: number | null = 0) {
  return { stdout, stderr: "", code };
}

beforeEach(() => {
  execCommand.mockReset();
});

describe("collectProxmoxClusterHealth", () => {
  it("reports clustered:false for a standalone node (no cluster entry)", async () => {
    execCommand.mockResolvedValueOnce(result(JSON.stringify([]), 0));
    const res = await collectProxmoxClusterHealth(fakeClient);
    expect(res).toEqual({ clustered: false });
  });

  it("parses a clustered response with quorum and node entries", async () => {
    execCommand.mockResolvedValueOnce(
      result(
        JSON.stringify([
          { type: "cluster", name: "prod-cluster", quorate: 1, nodes: 3 },
          { type: "node", name: "pve1", online: 1, local: 1, ip: "10.0.0.1" },
          { type: "node", name: "pve2", online: 0, local: 0, ip: "10.0.0.2" },
        ]),
      ),
    );

    const res = await collectProxmoxClusterHealth(fakeClient);
    expect(res.clustered).toBe(true);
    if (res.clustered) {
      expect(res.quorate).toBe(true);
      expect(res.clusterName).toBe("prod-cluster");
      expect(res.nodes).toHaveLength(2);
      expect(res.nodes[0]).toEqual({
        name: "pve1",
        online: true,
        local: true,
        ip: "10.0.0.1",
      });
      expect(res.nodes[1].online).toBe(false);
    }
  });

  it("returns clustered:false when pvesh fails", async () => {
    execCommand.mockResolvedValueOnce(result("", 1));
    const res = await collectProxmoxClusterHealth(fakeClient);
    expect(res).toEqual({ clustered: false });
  });

  it("returns clustered:false on malformed JSON", async () => {
    execCommand.mockResolvedValueOnce(result("not json", 0));
    const res = await collectProxmoxClusterHealth(fakeClient);
    expect(res).toEqual({ clustered: false });
  });
});
