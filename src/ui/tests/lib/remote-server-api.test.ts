import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SSHHost } from "@/types/index";

const isElectron = vi.hoisted(() => vi.fn());
const remoteApi = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/electron", () => ({ isElectron }));
vi.mock("@/main-axios", () => ({ getRemoteStatsApi: () => remoteApi }));

import {
  getConnectedRemoteApi,
  markRemoteSharedHosts,
  resolveRemoteHostId,
} from "@/lib/remote-server-api";

describe("remote server API", () => {
  const invoke = vi.fn();

  beforeEach(() => {
    isElectron.mockReset();
    remoteApi.get.mockReset();
    invoke.mockReset();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { invoke },
    });
  });

  it("is available only for a configured Electron sync server", async () => {
    isElectron.mockReturnValue(false);
    await expect(getConnectedRemoteApi()).resolves.toBeNull();

    isElectron.mockReturnValue(true);
    invoke.mockResolvedValueOnce({ serverUrl: "https://termix.example" });
    await expect(getConnectedRemoteApi()).resolves.toBe(remoteApi);
  });

  it("maps a local host to the remote numeric id by syncId", async () => {
    isElectron.mockReturnValue(true);
    invoke.mockResolvedValue({ serverUrl: "https://termix.example" });
    remoteApi.get.mockResolvedValue({
      data: { rows: [{ id: 41, syncId: "host-a" }] },
    });

    await expect(resolveRemoteHostId("host-a")).resolves.toBe(41);
    await expect(resolveRemoteHostId("missing")).resolves.toBeNull();
    expect(remoteApi.get).toHaveBeenCalledWith("/sync/hosts");
  });

  it("keeps only shared remote hosts and gives them collision-free ids", () => {
    const rows = markRemoteSharedHosts([
      { id: 4, isShared: false },
      { id: 9, isShared: true, syncId: "shared-host" },
    ] as SSHHost[]);

    expect(rows).toEqual([
      expect.objectContaining({
        id: -9,
        syncId: "shared-host",
        connectionOrigin: "remote",
      }),
    ]);
  });
});
