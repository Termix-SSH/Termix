import { beforeEach, describe, expect, it, vi } from "vitest";

const isElectron = vi.hoisted(() => vi.fn(() => true));
const get = vi.hoisted(() => vi.fn());

vi.mock("@/lib/electron", () => ({ isElectron }));
vi.mock("@/main-axios", () => ({ authApi: { get } }));

const { getLinkedSession, notifySyncChanged } =
  await import("@/lib/linked-server");

beforeEach(() => {
  notifySyncChanged();
  get.mockReset();
  isElectron.mockReturnValue(true);
});

describe("linked session", () => {
  it("reads the session from the embedded backend and caches it", async () => {
    get.mockResolvedValue({
      data: { serverUrl: "https://termix.example/", token: "t" },
    });
    await expect(getLinkedSession()).resolves.toEqual({
      serverUrl: "https://termix.example",
      token: "t",
    });
    await getLinkedSession();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/sync/link/session");
  });

  it("reads it again after a sync change", async () => {
    get.mockResolvedValue({ data: { serverUrl: null, token: null } });
    await expect(getLinkedSession()).resolves.toBeNull();
    notifySyncChanged();
    get.mockResolvedValue({ data: { serverUrl: "https://x", token: "t" } });
    await expect(getLinkedSession()).resolves.toEqual({
      serverUrl: "https://x",
      token: "t",
    });
  });

  it("is null on the web and when the backend cannot answer", async () => {
    isElectron.mockReturnValue(false);
    await expect(getLinkedSession()).resolves.toBeNull();
    expect(get).not.toHaveBeenCalled();

    isElectron.mockReturnValue(true);
    get.mockRejectedValue(new Error("down"));
    await expect(getLinkedSession()).resolves.toBeNull();
  });
});
