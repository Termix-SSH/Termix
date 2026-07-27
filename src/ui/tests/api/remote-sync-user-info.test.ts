import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const isElectronMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/electron", () => ({ isElectron: isElectronMock }));
vi.mock("@/lib/base-path", () => ({ getBasePath: () => "" }));
vi.mock("@/shell/TabContext", () => ({ clearTermixSessionStorage: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { getRemoteSyncUserInfo } = await import("../../main-axios");

const invoke = vi.fn();

beforeEach(() => {
  isElectronMock.mockReturnValue(true);
  invoke.mockReset();
  (window as unknown as { electronAPI?: unknown }).electronAPI = { invoke };
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("getRemoteSyncUserInfo", () => {
  it("returns the identity reported by the main process", async () => {
    const identity = {
      userId: "u-1",
      username: "alice",
      is_admin: true,
      is_oidc: false,
      totp_enabled: false,
      roles: [{ roleId: 1, roleDisplayName: "Admin" }],
    };
    invoke.mockResolvedValueOnce(identity);

    await expect(getRemoteSyncUserInfo()).resolves.toEqual(identity);
    expect(invoke).toHaveBeenCalledWith("get-remote-sync-user-info");
  });

  it("returns null in the browser without calling the bridge", async () => {
    isElectronMock.mockReturnValue(false);

    await expect(getRemoteSyncUserInfo()).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns null when no remote sync identity is available", async () => {
    // The main process answers null when the server is unconfigured, the JWT is
    // missing, or it has expired.
    invoke.mockResolvedValueOnce(null);

    await expect(getRemoteSyncUserInfo()).resolves.toBeNull();
  });

  it("returns null instead of propagating a bridge failure", async () => {
    invoke.mockRejectedValueOnce(new Error("IPC channel closed"));

    await expect(getRemoteSyncUserInfo()).resolves.toBeNull();
  });

  it("returns null when the preload bridge is absent", async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;

    await expect(getRemoteSyncUserInfo()).resolves.toBeNull();
  });
});
