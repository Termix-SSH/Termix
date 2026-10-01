import { describe, expect, it, vi } from "vitest";
import { createHostMetricsApi } from "../../src/frontend/host-metrics-api";

function client() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
}

const notFound = () =>
  Object.assign(new Error("Not found"), { response: { status: 404 } });

describe("host metrics api", () => {
  it("answers null while a host has no sample", async () => {
    const api = client();
    api.get.mockRejectedValue(notFound());
    await expect(createHostMetricsApi(api).getMetrics(7)).resolves.toBeNull();
    expect(api.get).toHaveBeenCalledWith("/metrics/7");
  });

  it("reports a swept viewer instead of throwing", async () => {
    const api = client();
    api.post.mockRejectedValueOnce(notFound());
    await expect(
      createHostMetricsApi(api).heartbeat("expired-viewer"),
    ).resolves.toBe(false);
    expect(api.post).toHaveBeenCalledWith("/metrics/heartbeat", {
      viewerSessionId: "expired-viewer",
    });

    api.post.mockResolvedValueOnce({ data: { success: true } });
    await expect(createHostMetricsApi(api).heartbeat("live")).resolves.toBe(
      true,
    );
  });

  it("carries the server's connection logs on a failed start", async () => {
    const api = client();
    api.post.mockRejectedValue(
      Object.assign(new Error("boom"), {
        response: {
          status: 500,
          data: { error: "No route", connectionLogs: [{ message: "x" }] },
        },
      }),
    );
    await expect(
      createHostMetricsApi(api).startMetrics(7),
    ).rejects.toMatchObject({
      message: "No route",
      connectionLogs: [{ message: "x" }],
    });
  });

  it("puts the host id between a manager and its action", async () => {
    const api = client();
    api.post.mockResolvedValue({ data: { success: true } });
    await createHostMetricsApi(api).managerPost(
      7,
      "services",
      { a: 1 },
      "action",
    );
    expect(api.post).toHaveBeenCalledWith(
      "/host-metrics/managers/services/7/action",
      { a: 1 },
    );
  });
});
