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

vi.mock("@/main-axios", () => ({
  authApi: authApiMock,
  getRemoteGuacamoleApi: () => remoteApiMock,
  isElectron: isElectronMock,
  handleApiError: (error: unknown) => error,
}));

import {
  getGuacdStatus,
  getGuacamoleTokenFromHost,
} from "../../api/guacamole-api";

beforeEach(() => {
  authApiMock.get.mockClear();
  authApiMock.post.mockClear();
  remoteApiMock.get.mockClear();
  remoteApiMock.post.mockClear();
});

describe("guacamole API origin", () => {
  it("uses the shared instance in the browser", async () => {
    isElectronMock.mockReturnValue(false);

    await getGuacdStatus();
    await getGuacamoleTokenFromHost(9, "vnc");

    expect(authApiMock.get).toHaveBeenCalledWith("/guacamole/status");
    expect(authApiMock.post).toHaveBeenCalledOnce();
    expect(remoteApiMock.get).not.toHaveBeenCalled();
    expect(remoteApiMock.post).not.toHaveBeenCalled();
  });

  it("uses the connected remote server in the desktop app", async () => {
    isElectronMock.mockReturnValue(true);

    // The embedded backend has no guacd, so asking it reports "disconnected"
    // even when the connected server can serve the session.
    const status = await getGuacdStatus();
    const token = await getGuacamoleTokenFromHost(9, "vnc");

    expect(status.guacd.status).toBe("connected");
    expect(token.token).toBe("remote-token");
    expect(remoteApiMock.get).toHaveBeenCalledWith("/guacamole/status");
    expect(remoteApiMock.post).toHaveBeenCalledOnce();
    expect(authApiMock.get).not.toHaveBeenCalled();
    expect(authApiMock.post).not.toHaveBeenCalled();
  });

  it("sends the connect-host payload unchanged to the remote server", async () => {
    isElectronMock.mockReturnValue(true);

    await getGuacamoleTokenFromHost(9, "rdp", {
      username: "admin",
      password: "secret",
    });

    expect(remoteApiMock.post).toHaveBeenCalledWith(
      "/guacamole/connect-host/9",
      {
        protocol: "rdp",
        promptedUsername: "admin",
        promptedPassword: "secret",
      },
    );
  });
});
