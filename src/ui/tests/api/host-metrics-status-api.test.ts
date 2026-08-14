import { beforeEach, describe, expect, it, vi } from "vitest";

const statsApiMock = vi.hoisted(() => ({ get: vi.fn() }));
const remoteStatsApiMock = vi.hoisted(() => ({ get: vi.fn() }));
const sshHostApiMock = vi.hoisted(() => ({ get: vi.fn() }));
const resolveConnectionOriginMock = vi.hoisted(() => vi.fn());

vi.mock("@/main-axios", () => ({
  statsApi: statsApiMock,
  sshHostApi: sshHostApiMock,
  getRemoteStatsApi: () => remoteStatsApiMock,
  isElectron: () => true,
  handleApiError: vi.fn(),
}));

vi.mock("@/lib/hosts-request-cache", () => ({
  getCachedServerStatuses: (loader: () => Promise<unknown>) => loader(),
}));

vi.mock("@/lib/connection-origin", () => ({
  resolveConnectionOrigin: resolveConnectionOriginMock,
}));

import {
  getAllServerStatuses,
  getServerMetricsById,
} from "../../api/host-metrics-status-api";

beforeEach(() => {
  vi.clearAllMocks();
  window.electronAPI = {
    invoke: vi.fn(async (channel: string) =>
      channel === "get-remote-sync-config"
        ? { serverUrl: "https://termix.example.test" }
        : null,
    ),
  } as unknown as NonNullable<typeof window.electronAPI>;
  statsApiMock.get.mockResolvedValue({ data: { 1: { status: "online" } } });
  remoteStatsApiMock.get.mockResolvedValue({
    data: { 2: { status: "reachable" } },
  });
});

describe("status check origin routing", () => {
  it("only asks the embedded backend to poll local-origin hosts", async () => {
    sshHostApiMock.get.mockResolvedValue({
      data: [
        { id: 1, connectionOrigin: "local" },
        { id: 2, connectionOrigin: "remote" },
      ],
    });
    resolveConnectionOriginMock.mockImplementation(async (host) =>
      host.connectionOrigin === "local" ? "local" : "remote",
    );

    await expect(getAllServerStatuses()).resolves.toEqual({
      1: { status: "online" },
      2: { status: "reachable" },
    });

    expect(statsApiMock.get).toHaveBeenCalledWith("/status", {
      timeout: 2000,
      params: { hostIds: "1" },
      __silentRetry: true,
    });
  });

  it("sends an empty allowlist when every host uses the remote server", async () => {
    sshHostApiMock.get.mockResolvedValue({
      data: [{ id: 2, connectionOrigin: "remote" }],
    });
    resolveConnectionOriginMock.mockResolvedValue("remote");

    await getAllServerStatuses();

    expect(statsApiMock.get).toHaveBeenCalledWith("/status", {
      timeout: 2000,
      params: { hostIds: "" },
      __silentRetry: true,
    });
  });
});

describe("metrics request coalescing", () => {
  it("shares simultaneous reads for the same host", async () => {
    statsApiMock.get.mockResolvedValueOnce({
      status: 200,
      data: { cpu: { percent: 12 } },
    });

    const [first, second] = await Promise.all([
      getServerMetricsById(991),
      getServerMetricsById(991),
    ]);

    expect(first).toEqual({ cpu: { percent: 12 } });
    expect(second).toBe(first);
    expect(statsApiMock.get).toHaveBeenCalledOnce();
  });
});
