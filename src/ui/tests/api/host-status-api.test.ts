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

vi.mock("@/lib/linked-server", () => ({
  getLinkedSession: async () => ({
    serverUrl: "https://termix.example.test",
    token: "t",
  }),
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
  // The server keys statuses by sync id; its own ids mean nothing here.
  remoteCoreApiMock.get.mockResolvedValue({
    data: { "sync-2": { status: "reachable" }, "sync-9": { status: "x" } },
  });
});

describe("status check origin routing", () => {
  it("only asks the embedded backend to poll local-origin hosts", async () => {
    hostsAndStatuses([
      { id: 1, connectionOrigin: "local", syncId: "sync-1" },
      { id: 2, connectionOrigin: "remote", syncId: "sync-2" },
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
      "/sync/v2/host-status",
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
