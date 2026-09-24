import { beforeEach, describe, expect, it, vi } from "vitest";

const remoteCoreApiMock = vi.hoisted(() => ({ get: vi.fn() }));
const sshHostApiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));
const resolveConnectionOriginMock = vi.hoisted(() => vi.fn());

vi.mock("@/main-axios", () => ({
  sshHostApi: sshHostApiMock,
  getRemoteCoreApi: () => remoteCoreApiMock,
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
  refreshServerPolling,
  updateStatusCheckSettings,
} from "@/api/host-status-api";

/** The host list for "/db/host", core's statuses for "/status". */
function hostsAndStatuses(hosts: unknown[]) {
  sshHostApiMock.get.mockImplementation(async (path: string) =>
    path === "/status"
      ? { data: { 1: { status: "online" } } }
      : { data: hosts },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.electronAPI = {
    invoke: vi.fn(async (channel: string) =>
      channel === "get-remote-sync-config"
        ? { serverUrl: "https://termix.example.test" }
        : null,
    ),
  } as unknown as NonNullable<typeof window.electronAPI>;
  remoteCoreApiMock.get.mockResolvedValue({
    data: { 2: { status: "reachable" } },
  });
});

describe("status check origin routing", () => {
  it("only asks the embedded backend to poll local-origin hosts", async () => {
    hostsAndStatuses([
      { id: 1, connectionOrigin: "local" },
      { id: 2, connectionOrigin: "remote" },
    ]);
    resolveConnectionOriginMock.mockImplementation(async (host) =>
      host.connectionOrigin === "local" ? "local" : "remote",
    );

    await expect(getAllServerStatuses()).resolves.toEqual({
      1: { status: "online" },
      2: { status: "reachable" },
    });

    expect(sshHostApiMock.get).toHaveBeenCalledWith("/status", {
      timeout: 2000,
      params: { hostIds: "1" },
      __silentRetry: true,
    });
    expect(remoteCoreApiMock.get).toHaveBeenCalledWith(
      "/host/status",
      expect.objectContaining({ __silentRetry: true }),
    );
  });

  it("sends an empty allowlist when every host uses the remote server", async () => {
    hostsAndStatuses([{ id: 2, connectionOrigin: "remote" }]);
    resolveConnectionOriginMock.mockResolvedValue("remote");

    await getAllServerStatuses();

    expect(sshHostApiMock.get).toHaveBeenCalledWith("/status", {
      timeout: 2000,
      params: { hostIds: "" },
      __silentRetry: true,
    });
  });
});

describe("status check routes", () => {
  it("restarts checks through core", async () => {
    sshHostApiMock.post.mockResolvedValue({ data: {} });
    await refreshServerPolling();
    expect(sshHostApiMock.post).toHaveBeenCalledWith("/status/refresh");
  });

  it("saves the default interval", async () => {
    sshHostApiMock.put.mockResolvedValue({ data: {} });
    await updateStatusCheckSettings({ statusCheckInterval: 45 });
    expect(sshHostApiMock.put).toHaveBeenCalledWith("/status/settings", {
      statusCheckInterval: 45,
    });
  });
});
