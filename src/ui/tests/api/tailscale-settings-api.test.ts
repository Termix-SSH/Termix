import { beforeEach, describe, expect, it, vi } from "vitest";

const authApiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
const handleApiErrorMock = vi.hoisted(() => vi.fn());

vi.mock("@/main-axios", () => ({
  authApi: authApiMock,
  statsApi: { get: vi.fn(), patch: vi.fn() },
  handleApiError: handleApiErrorMock,
}));

import { getTailscaleDevices } from "../../api/settings-api";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTailscaleDevices", () => {
  it("preserves configured-key state when discovery fails", async () => {
    authApiMock.get.mockRejectedValue({
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
    expect(handleApiErrorMock).not.toHaveBeenCalled();
  });

  it("uses normal API error handling when no structured state is available", async () => {
    const error = { isAxiosError: true, response: { data: {} } };
    authApiMock.get.mockRejectedValue(error);

    await expect(getTailscaleDevices()).rejects.toBe(error);
    expect(handleApiErrorMock).toHaveBeenCalledWith(
      error,
      "fetch Tailscale devices",
    );
  });
});
