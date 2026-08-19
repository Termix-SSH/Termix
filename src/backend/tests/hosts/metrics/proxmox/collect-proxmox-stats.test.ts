import { describe, it, expect, vi, beforeEach } from "vitest";

const execCommand = vi.fn();
vi.mock("../../../../hosts/metrics/widgets/common-utils.js", () => ({
  execCommand: (...args: unknown[]) => execCommand(...args),
  toFixedNum: (n: number | null | undefined, digits = 2) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    return Number(n.toFixed(digits));
  },
}));

import { collectProxmoxStats } from "../../../../hosts/metrics/proxmox/collect-proxmox-stats.js";
import type { Client } from "ssh2";

const fakeClient = {} as Client;

function result(stdout: string, code: number | null = 0) {
  return { stdout, stderr: "", code };
}

beforeEach(() => {
  execCommand.mockReset();
});

describe("collectProxmoxStats", () => {
  it("throws a distinguishable error when pvesh is missing", async () => {
    execCommand.mockResolvedValueOnce(result("missing"));

    await expect(collectProxmoxStats(fakeClient, null)).rejects.toThrow(
      /pvesh not found/i,
    );
    // Only the pvesh-presence check should have run - no node resolution or
    // per-collector execs once that check fails.
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  it("auto-detects the node name via hostname when none is configured", async () => {
    execCommand.mockResolvedValueOnce(result("ok")); // pvesh check
    execCommand.mockResolvedValueOnce(result("pve-auto\n")); // hostname
    // Five collectors run concurrently after that; give each a benign failing
    // response so the aggregator still resolves with null-filled sub-shapes.
    execCommand.mockResolvedValue(result("", 1));

    const snapshot = await collectProxmoxStats(fakeClient, null);
    expect(snapshot.lastChecked).toBeTruthy();
    expect(snapshot.node).toBeDefined();
    expect(snapshot.guests).toBeDefined();
    expect(snapshot.storage).toBeDefined();
    expect(snapshot.cluster).toEqual({ clustered: false });
  });

  it("uses the configured node name when it is safe, skipping hostname detection", async () => {
    execCommand.mockResolvedValueOnce(result("ok")); // pvesh check
    execCommand.mockResolvedValue(result("", 1)); // all collector calls fail benignly

    await collectProxmoxStats(fakeClient, "my-node");

    // hostname auto-detection command should never have been issued.
    const calls = execCommand.mock.calls.map((c) => c[1] as string);
    expect(calls).not.toContain("hostname");
  });

  it("rejects an unsafe configured node name", async () => {
    execCommand.mockResolvedValueOnce(result("ok")); // pvesh check

    await expect(collectProxmoxStats(fakeClient, "bad;node")).rejects.toThrow(
      /valid Proxmox node name/i,
    );
  });
});
