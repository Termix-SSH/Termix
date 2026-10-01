import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

const getLinkedSession = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@/lib/linked-server", () => ({ getLinkedSession }));
import {
  buildOriginWsUrl,
  resolveConnectionOrigin,
} from "../../lib/connection-origin.js";

const win = window as unknown as Record<string, unknown>;

afterEach(() => {
  delete win.IS_ELECTRON;
  delete win.electronAPI;
});

describe("resolveConnectionOrigin", () => {
  // Support#1240: these can now originate from the desktop, but only when a
  // host opts in. Left on Default they stay remote, so an upgrade never moves
  // an existing host onto a local guacd the user has not set up.
  it("resolves to remote with defaultRemote when the host has no override", async () => {
    win.IS_ELECTRON = true;
    win.electronAPI = {
      invoke: async (channel: string) =>
        channel === "get-desktop-settings"
          ? { defaultConnectionOrigin: "local" }
          : null,
    };
    await expect(
      resolveConnectionOrigin(
        { connectionOrigin: null },
        { defaultRemote: true },
      ),
    ).resolves.toBe("remote");
  });

  it("honors an explicit override over defaultRemote", async () => {
    win.IS_ELECTRON = true;
    await expect(
      resolveConnectionOrigin(
        { connectionOrigin: "local" },
        { defaultRemote: true },
      ),
    ).resolves.toBe("local");
    await expect(
      resolveConnectionOrigin(
        { connectionOrigin: "remote" },
        { defaultRemote: true },
      ),
    ).resolves.toBe("remote");
  });

  it("resolves to local outside Electron even with defaultRemote", async () => {
    await expect(
      resolveConnectionOrigin(
        { connectionOrigin: null },
        { defaultRemote: true },
      ),
    ).resolves.toBe("local");
  });

  it("resolves to local outside Electron regardless of the host override", async () => {
    await expect(
      resolveConnectionOrigin({
        connectionOrigin: "remote",
      }),
    ).resolves.toBe("local");
  });

  it("honors a host-level override for ssh in Electron", async () => {
    win.IS_ELECTRON = true;
    await expect(
      resolveConnectionOrigin({
        connectionOrigin: "remote",
      }),
    ).resolves.toBe("remote");
    await expect(
      resolveConnectionOrigin({
        connectionOrigin: "local",
      }),
    ).resolves.toBe("local");
  });

  it("falls back to the desktop-wide default when no host override is set", async () => {
    win.IS_ELECTRON = true;
    win.electronAPI = {
      invoke: async (channel: string) => {
        if (channel === "get-desktop-settings") {
          return { defaultConnectionOrigin: "remote" };
        }
        return null;
      },
    };
    await expect(
      resolveConnectionOrigin({
        connectionOrigin: null,
      }),
    ).resolves.toBe("remote");
  });

  it("defaults to local when the desktop settings lookup fails", async () => {
    win.IS_ELECTRON = true;
    win.electronAPI = {
      invoke: async () => {
        throw new Error("ipc failed");
      },
    };
    await expect(
      resolveConnectionOrigin({
        connectionOrigin: null,
      }),
    ).resolves.toBe("local");
  });
});

/**
 * The embedded backend authenticates a local WebSocket from its subprotocol,
 * because the browser WebSocket API cannot set an Authorization header.
 * Electron's main process does inject a JWT cookie, but only on an exact
 * origin match, so a socket has to carry the credential itself.
 *
 * This caught a real bug: the Docker console opted out of the token and had no
 * other credential left, so its handshake was closed with 1008 while logs and
 * stats kept working. The fixtures below use the plugin socket routes these
 * channels actually use now; every plugin shares the backend port.
 */
describe("buildOriginWsUrl", () => {
  const store: Record<string, string> = {};

  beforeEach(() => {
    store.jwt = "local-jwt";
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries the local JWT by default", async () => {
    // Every interactive channel on the embedded backend relies on this.
    const target = await buildOriginWsUrl({
      origin: "local",
      localPort: 30001,
      localPath: "/plugin-ws/docker/console",
      remotePath: "/plugin-ws/docker/console",
    });

    expect(target).toEqual({
      url: "ws://127.0.0.1:30001/plugin-ws/docker/console",
      protocols: ["termix.jwt.local-jwt"],
    });
  });

  it("omits it only when a caller asks", async () => {
    const target = await buildOriginWsUrl({
      origin: "local",
      localPort: 30001,
      localPath: "/plugin-ws/docker/console",
      remotePath: "/plugin-ws/docker/console",
      includeJwt: false,
    });

    expect(target).toEqual({
      url: "ws://127.0.0.1:30001/plugin-ws/docker/console",
      protocols: [],
    });
  });

  it("does not duplicate the Guacamole token on remote connections", async () => {
    getLinkedSession.mockResolvedValueOnce({
      serverUrl: "https://termix.example",
      token: "remote-jwt",
    } as never);

    const target = await buildOriginWsUrl({
      origin: "remote",
      localPort: 30001,
      localPath: "/plugin-ws/remote-desktop/display",
      remotePath: "/plugin-ws/remote-desktop/display",
      includeJwt: false,
    });

    expect(target).toEqual({
      url: "wss://termix.example/plugin-ws/remote-desktop/display",
      protocols: [],
    });
  });

  it("leaves the URL alone when there is no token stored", async () => {
    delete store.jwt;

    const target = await buildOriginWsUrl({
      origin: "local",
      localPort: 30001,
      localPath: "/plugin-ws/ssh-terminal/terminal",
      remotePath: "/plugin-ws/ssh-terminal/terminal",
    });

    expect(target).toEqual({
      url: "ws://127.0.0.1:30001/plugin-ws/ssh-terminal/terminal",
      protocols: [],
    });
  });
});
