import { describe, expect, it, vi, beforeEach } from "vitest";

const authApiMock = vi.hoisted(() => ({
  get: vi.fn(async () => ({ data: { guacd: { status: "disconnected" } } })),
  post: vi.fn(async () => ({ data: { token: "local-token" } })),
}));
const remoteApiMock = vi.hoisted(() => ({
  get: vi.fn(async () => ({ data: { guacd: { status: "connected" } } })),
  post: vi.fn(async () => ({ data: { token: "remote-token" } })),
}));
const isElectronMock = vi.hoisted(() => vi.fn(() => false));
const resolveRemoteHostIdMock = vi.hoisted(() => vi.fn());

vi.mock("@termix/plugin-sdk/ui", () => ({
  isElectron: isElectronMock,
  resolveRemoteHostId: resolveRemoteHostIdMock,
}));

import {
  setRemoteDesktopApp,
  getGuacdStatus,
  getGuacamoleConnectionId,
  getGuacamoleTokenFromHost,
} from "../../src/frontend/guacamole-api";

// Mirrors app.apiFor: the remote server only for a remote origin in the
// desktop app, the ordinary client otherwise.
setRemoteDesktopApp({
  apiFor: (origin) =>
    (origin === "remote" && isElectronMock()
      ? remoteApiMock
      : authApiMock) as never,
});

beforeEach(() => {
  authApiMock.get.mockClear();
  authApiMock.post.mockClear();
  remoteApiMock.get.mockClear();
  remoteApiMock.post.mockClear();
  resolveRemoteHostIdMock.mockReset();
});

describe("guacamole API origin", () => {
  it("uses the shared instance in the browser", async () => {
    isElectronMock.mockReturnValue(false);

    await getGuacdStatus("remote");
    await getGuacamoleTokenFromHost(9, "remote", "vnc");

    expect(authApiMock.get).toHaveBeenCalledWith("/status");
    expect(authApiMock.post).toHaveBeenCalledOnce();
    expect(remoteApiMock.get).not.toHaveBeenCalled();
    expect(remoteApiMock.post).not.toHaveBeenCalled();
  });

  it("uses the connected remote server in the desktop app", async () => {
    isElectronMock.mockReturnValue(true);

    // The embedded backend has no guacd, so asking it reports "disconnected"
    // even when the connected server can serve the session.
    const status = await getGuacdStatus("remote");
    const token = await getGuacamoleTokenFromHost(9, "remote", "vnc");

    expect(status.guacd.status).toBe("connected");
    expect(token.token).toBe("remote-token");
    expect(remoteApiMock.get).toHaveBeenCalledWith("/status");
    expect(remoteApiMock.post).toHaveBeenCalledOnce();
    expect(authApiMock.get).not.toHaveBeenCalled();
    expect(authApiMock.post).not.toHaveBeenCalled();
  });

  it("sends the connect-host payload unchanged to the remote server", async () => {
    isElectronMock.mockReturnValue(true);
    resolveRemoteHostIdMock.mockResolvedValue(41);

    await getGuacamoleTokenFromHost(
      9,
      "remote",
      "rdp",
      {
        username: "admin",
        password: "secret",
        domain: "EXAMPLE",
      },
      "host-sync-id",
    );

    expect(remoteApiMock.post).toHaveBeenCalledWith("/connect-host/41", {
      protocol: "rdp",
      promptedUsername: "admin",
      promptedPassword: "secret",
      promptedDomain: "EXAMPLE",
    });
    expect(resolveRemoteHostIdMock).toHaveBeenCalledWith("host-sync-id");
  });

  it("sends an empty prompted domain for local RDP accounts", async () => {
    isElectronMock.mockReturnValue(false);

    await getGuacamoleTokenFromHost(9, "local", "rdp", {
      username: "local-admin",
      password: "secret",
      domain: "",
    });

    expect(authApiMock.post).toHaveBeenCalledWith("/connect-host/9", {
      protocol: "rdp",
      promptedUsername: "local-admin",
      promptedPassword: "secret",
      promptedDomain: "",
    });
  });

  // Support#1240: a host set to "This Device" is served by the embedded
  // backend, so its token has to come from there too -- and its id must not
  // be remapped onto a remote server that may not even be configured.
  it("asks the embedded backend when the host originates locally", async () => {
    isElectronMock.mockReturnValue(true);

    const token = await getGuacamoleTokenFromHost(9, "local", "rdp");

    expect(token.token).toBe("local-token");
    expect(authApiMock.post).toHaveBeenCalledWith("/connect-host/9", {
      protocol: "rdp",
    });
    expect(remoteApiMock.post).not.toHaveBeenCalled();
    expect(resolveRemoteHostIdMock).not.toHaveBeenCalled();
  });

  it("reports the embedded backend's own guacd for a local origin", async () => {
    isElectronMock.mockReturnValue(true);

    const status = await getGuacdStatus("local");

    expect(status.guacd.status).toBe("disconnected");
    expect(authApiMock.get).toHaveBeenCalledWith("/status");
    expect(remoteApiMock.get).not.toHaveBeenCalled();
  });

  it("uses the remote server for an explicitly remote origin", async () => {
    isElectronMock.mockReturnValue(true);

    await getGuacamoleTokenFromHost(9, "remote", "rdp");

    expect(remoteApiMock.post).toHaveBeenCalledOnce();
    expect(authApiMock.post).not.toHaveBeenCalled();
  });

  it("does not fall back to a colliding local id when sync resolution fails", async () => {
    isElectronMock.mockReturnValue(true);
    resolveRemoteHostIdMock.mockResolvedValue(null);

    await expect(
      getGuacamoleTokenFromHost(
        9,
        "remote",
        "rdp",
        undefined,
        "missing-sync-id",
      ),
    ).rejects.toThrow("The synced host does not exist on the remote server");
    expect(remoteApiMock.post).not.toHaveBeenCalled();
  });
});

it("looks up the session on the backend that issued its token", async () => {
  isElectronMock.mockReturnValue(true);
  const signal = new AbortController().signal;
  await getGuacamoleConnectionId("connect/id", "remote", signal);
  expect(remoteApiMock.get).toHaveBeenCalledWith("/connection/connect%2Fid", {
    signal,
  });
  expect(authApiMock.get).not.toHaveBeenCalled();
});
