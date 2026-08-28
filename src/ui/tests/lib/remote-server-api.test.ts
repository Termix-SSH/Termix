import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SSHHost } from "@/types/index";

const isElectron = vi.hoisted(() => vi.fn());
const remoteApi = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/electron", () => ({ isElectron }));
vi.mock("@/main-axios", () => ({ getRemoteStatsApi: () => remoteApi }));

import {
  getConnectedRemoteApi,
  hydrateLocalSharedHostAuth,
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
      {
        id: 9,
        isShared: true,
        syncId: "shared-host",
        connectionOrigin: "local",
      },
    ] as SSHHost[]);

    expect(rows).toEqual([
      expect.objectContaining({
        id: -9,
        syncId: "shared-host",
        connectionOrigin: "local",
      }),
    ]);
  });

  it("hydrates a remote shared host for a local connection without persisting remote ids", async () => {
    isElectron.mockReturnValue(true);
    invoke.mockResolvedValue({ serverUrl: "https://termix.example" });
    remoteApi.get.mockResolvedValue({
      data: {
        username: "recipient",
        authType: "key",
        key: "PRIVATE KEY",
        keyPassword: "passphrase",
        keyType: "ed25519",
      },
    });

    const result = await hydrateLocalSharedHostAuth({
      id: -9,
      isShared: true,
      syncId: "shared-host",
      credentialId: 77,
      username: "owner",
      authType: "key",
    });

    expect(remoteApi.get).toHaveBeenCalledWith(
      "/host/db/host/9/local-connection-auth",
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: -9,
        syncId: null,
        credentialId: undefined,
        username: "recipient",
        key: "PRIVATE KEY",
        keyPassword: "passphrase",
      }),
    );
  });

  it("leaves local and owned hosts untouched", async () => {
    const host = { id: 9, isShared: false, username: "root" };
    await expect(hydrateLocalSharedHostAuth(host)).resolves.toBe(host);
    expect(remoteApi.get).not.toHaveBeenCalled();
  });
});
