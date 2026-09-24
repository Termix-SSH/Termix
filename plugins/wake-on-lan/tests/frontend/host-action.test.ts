import { describe, it, expect, vi, afterEach } from "vitest";
import { toast } from "sonner";
import type { PluginApiClient } from "@termix/plugin-sdk/frontend";
import { hasMacAddress, wakeHost } from "../../src/frontend/host-action.js";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  vi.clearAllMocks();
});

function stubApi(overrides: Partial<PluginApiClient> = {}): PluginApiClient {
  return {
    get: vi.fn(async () => ({ data: {} })),
    post: vi.fn(async () => ({ data: {} })),
    put: vi.fn(async () => ({ data: {} })),
    patch: vi.fn(async () => ({ data: {} })),
    delete: vi.fn(async () => ({ data: {} })),
    ...overrides,
  } as PluginApiClient;
}

const t = (key: string) => key;

describe("hasMacAddress", () => {
  it("is true when the host's wake-on-lan settings carry a MAC address", () => {
    expect(
      hasMacAddress({
        pluginSettings: { "wake-on-lan": { macAddress: "aa:bb:cc:dd:ee:ff" } },
      }),
    ).toBe(true);
  });

  it("is false with no plugin settings", () => {
    expect(hasMacAddress({})).toBe(false);
  });

  it("is false with an empty MAC address", () => {
    expect(
      hasMacAddress({ pluginSettings: { "wake-on-lan": { macAddress: "" } } }),
    ).toBe(false);
  });
});

describe("wakeHost", () => {
  it("posts to the host's wake route and toasts success", async () => {
    const api = stubApi();
    wakeHost(api, t, "1");
    await vi.waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/host/1/wake"),
    );
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("toasts the server's error message on failure", async () => {
    const api = stubApi({
      post: vi
        .fn()
        .mockRejectedValue({ response: { data: { error: "no mac" } } }),
    });
    wakeHost(api, t, "1");
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("no mac"));
  });

  it("falls back to a generic message with no server error", async () => {
    const api = stubApi({ post: vi.fn().mockRejectedValue(new Error("x")) });
    wakeHost(api, t, "1");
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("hostAction.failed"),
    );
  });
});
