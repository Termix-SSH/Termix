import { beforeEach, describe, expect, it, vi } from "vitest";

const isElectron = vi.hoisted(() => vi.fn());

vi.mock("@/lib/electron", () => ({ isElectron }));

import { requestRemoteSync } from "@/lib/remote-sync-trigger";

describe("requestRemoteSync", () => {
  const invoke = vi.fn();

  beforeEach(() => {
    isElectron.mockReset();
    invoke.mockReset();
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: { invoke },
    });
  });

  it("starts a sync when the desktop is connected to a server", async () => {
    isElectron.mockReturnValue(true);
    invoke.mockResolvedValueOnce({ serverUrl: "https://termix.example" });

    await requestRemoteSync();

    expect(invoke).toHaveBeenNthCalledWith(1, "get-remote-sync-config");
    expect(invoke).toHaveBeenNthCalledWith(2, "remote-sync-now");
  });

  it("does nothing outside Electron or without a configured server", async () => {
    isElectron.mockReturnValue(false);
    await requestRemoteSync();
    expect(invoke).not.toHaveBeenCalled();

    isElectron.mockReturnValue(true);
    invoke.mockResolvedValueOnce(null);
    await requestRemoteSync();
    expect(invoke).toHaveBeenCalledOnce();
  });
});
