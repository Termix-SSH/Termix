import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "ssh2";

const execElevated = vi.fn();
vi.mock("../../../hosts/metrics/managers/exec-elevated.js", () => ({
  execElevated: (...args: unknown[]) => execElevated(...args),
}));

import { execPveshCommand } from "../../../database/routes/proxmox.js";

const client = {} as Client;

describe("Proxmox discovery sudo execution", () => {
  beforeEach(() => {
    execElevated.mockReset();
  });

  it("forces pvesh through the stored sudo credentials", async () => {
    execElevated.mockResolvedValue({
      stdout: '[{"type":"qemu"}]',
      stderr: "",
      code: 0,
      usedSudo: true,
    });

    await expect(
      execPveshCommand(client, "pvesh get /cluster/resources", "secret", 12000),
    ).resolves.toBe('[{"type":"qemu"}]');
    expect(execElevated).toHaveBeenCalledWith(
      client,
      "pvesh get /cluster/resources",
      "secret",
      { forceSudo: true, timeoutMs: 12000 },
    );
  });

  it("surfaces a failed elevated pvesh command", async () => {
    execElevated.mockResolvedValue({
      stdout: "",
      stderr: "pvesh failed",
      code: 255,
      usedSudo: true,
    });

    await expect(
      execPveshCommand(client, "pvesh get /cluster/resources", "secret"),
    ).rejects.toThrow("pvesh failed");
  });
});
