import { beforeEach, describe, expect, it, vi } from "vitest";

const getLinkedSession = vi.hoisted(() => vi.fn());
const remoteApi = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/linked-server", () => ({ getLinkedSession }));
vi.mock("@/main-axios", () => ({ getRemoteCoreApi: () => remoteApi }));

import {
  getConnectedRemoteApi,
  hydrateLocalSharedHostAuth,
  resolveRemoteHostId,
} from "@/lib/remote-server-api";

const LINKED = { serverUrl: "https://termix.example", token: "t" };

describe("remote server API", () => {
  beforeEach(() => {
    getLinkedSession.mockReset();
    remoteApi.get.mockReset();
  });

  it("is available only while this desktop is linked", async () => {
    getLinkedSession.mockResolvedValueOnce(null);
    await expect(getConnectedRemoteApi()).resolves.toBeNull();

    getLinkedSession.mockResolvedValueOnce(LINKED);
    await expect(getConnectedRemoteApi()).resolves.toBe(remoteApi);
  });

  it("asks the linked server for its id of a host by sync id", async () => {
    getLinkedSession.mockResolvedValue(LINKED);
    remoteApi.get.mockResolvedValueOnce({ data: { id: 41, name: "web" } });

    await expect(resolveRemoteHostId("host a")).resolves.toBe(41);
    expect(remoteApi.get).toHaveBeenCalledWith("/sync/v2/hosts/host%20a");
  });

  it("answers null for an unknown host, no sync id, or no link", async () => {
    getLinkedSession.mockResolvedValue(LINKED);
    remoteApi.get.mockRejectedValueOnce(new Error("404"));
    await expect(resolveRemoteHostId("missing")).resolves.toBeNull();
    await expect(resolveRemoteHostId(null)).resolves.toBeNull();

    getLinkedSession.mockResolvedValue(null);
    await expect(resolveRemoteHostId("host-a")).resolves.toBeNull();
  });

  it("leaves hosts as they are, since shared copies carry their own auth", async () => {
    const host = { id: 9, isShared: true, username: "root" };
    await expect(hydrateLocalSharedHostAuth(host)).resolves.toBe(host);
    expect(remoteApi.get).not.toHaveBeenCalled();
  });
});
