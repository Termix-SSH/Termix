import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getLink = vi.hoisted(() => vi.fn());
vi.mock("../../sync/client/link-store.js", () => ({ getLink }));

const { shownIdentity } = await import("../../sync/shown-identity.js");

const local = { id: "u1", username: "server-ab12", isAdmin: true };

beforeEach(() => {
  process.env.ELECTRON_EMBEDDED = "true";
  getLink.mockReset();
});

afterEach(() => {
  delete process.env.ELECTRON_EMBEDDED;
});

describe("who the app shows", () => {
  it("shows the local user when nothing is linked", async () => {
    getLink.mockResolvedValue(null);
    expect(await shownIdentity(local)).toMatchObject({
      username: "server-ab12",
      isAdmin: true,
      linked: null,
    });
  });

  it("shows the account on the server once linked, with its own admin flag", async () => {
    getLink.mockResolvedValue({
      serverUrl: "https://home.example",
      serverName: "Home",
      remoteUsername: "luke",
      account: { username: "luke", isAdmin: false },
      status: "idle",
    });
    expect(await shownIdentity(local)).toMatchObject({
      username: "luke",
      isAdmin: false,
    });
    expect(getLink).toHaveBeenCalledWith("u1");
  });

  it("shows the sign in name until the account has synced", async () => {
    getLink.mockResolvedValue({
      serverUrl: "https://home.example",
      remoteUsername: "luke",
      account: null,
      status: "syncing",
    });
    expect((await shownIdentity(local)).username).toBe("luke");
  });

  it("is the local user on a server", async () => {
    delete process.env.ELECTRON_EMBEDDED;
    expect((await shownIdentity(local)).username).toBe("server-ab12");
    expect(getLink).not.toHaveBeenCalled();
  });
});
