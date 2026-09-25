import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTailscaleDevices,
  setTailscaleApi,
} from "../../src/frontend/tailscale-api";

const api = { get: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  setTailscaleApi(api as never);
});

describe("getTailscaleDevices", () => {
  it("reads the plugin's own devices route", async () => {
    api.get.mockResolvedValue({ data: { devices: [], hasApiKey: false } });

    await expect(getTailscaleDevices()).resolves.toEqual({
      devices: [],
      hasApiKey: false,
    });
    expect(api.get).toHaveBeenCalledWith("/devices");
  });

  it("preserves configured-key state when discovery fails", async () => {
    api.get.mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          devices: [],
          hasApiKey: true,
          error: "Failed to fetch Tailscale devices",
        },
      },
    });

    await expect(getTailscaleDevices()).resolves.toEqual({
      devices: [],
      hasApiKey: true,
      error: "Failed to fetch Tailscale devices",
    });
  });

  it("rethrows when no structured state is available", async () => {
    const error = { isAxiosError: true, response: { data: {} } };
    api.get.mockRejectedValue(error);

    await expect(getTailscaleDevices()).rejects.toBe(error);
  });

  it("refuses while the plugin is off", async () => {
    setTailscaleApi(null);
    await expect(getTailscaleDevices()).rejects.toThrow(/not active/);
  });
});
