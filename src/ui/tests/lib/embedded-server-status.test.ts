import { afterEach, describe, expect, it, vi } from "vitest";
import { getEmbeddedServerFailure } from "@/lib/embedded-server-status";

function setElectronAPI(api: unknown) {
  (window as unknown as { electronAPI?: unknown }).electronAPI = api;
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("getEmbeddedServerFailure", () => {
  it("returns null outside Electron, where there is no embedded backend", async () => {
    await expect(getEmbeddedServerFailure()).resolves.toBeNull();
  });

  it("returns null while the backend is merely still booting", async () => {
    setElectronAPI({
      isElectron: true,
      getEmbeddedServerStatus: vi
        .fn()
        .mockResolvedValue({ running: false, failure: null }),
    });
    await expect(getEmbeddedServerFailure()).resolves.toBeNull();
  });

  it("surfaces a port conflict with the port that was taken", async () => {
    setElectronAPI({
      isElectron: true,
      getEmbeddedServerStatus: vi.fn().mockResolvedValue({
        running: false,
        failure: { reason: "port-in-use", port: 30001 },
      }),
    });
    await expect(getEmbeddedServerFailure()).resolves.toEqual({
      reason: "port-in-use",
      port: 30001,
    });
  });

  it("surfaces a generic crash", async () => {
    setElectronAPI({
      isElectron: true,
      getEmbeddedServerStatus: vi.fn().mockResolvedValue({
        running: false,
        failure: { reason: "crashed", port: null },
      }),
    });
    await expect(getEmbeddedServerFailure()).resolves.toEqual({
      reason: "crashed",
      port: null,
    });
  });

  it("returns null when an older desktop build does not expose the status channel", async () => {
    setElectronAPI({ isElectron: true });
    await expect(getEmbeddedServerFailure()).resolves.toBeNull();
  });

  it("returns null rather than throwing when the IPC call itself fails", async () => {
    setElectronAPI({
      isElectron: true,
      getEmbeddedServerStatus: vi.fn().mockRejectedValue(new Error("no ipc")),
    });
    await expect(getEmbeddedServerFailure()).resolves.toBeNull();
  });

  it("ignores a failure payload with an unrecognized reason", async () => {
    setElectronAPI({
      isElectron: true,
      getEmbeddedServerStatus: vi.fn().mockResolvedValue({
        running: false,
        failure: { reason: "something-new", port: 30001 },
      }),
    });
    await expect(getEmbeddedServerFailure()).resolves.toEqual({
      reason: "crashed",
      port: null,
    });
  });
});
