import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
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
  it("resolves rdp/vnc/telnet to remote when the host has no override", async () => {
    win.IS_ELECTRON = true;
    win.electronAPI = {
      invoke: async (channel: string) =>
        channel === "get-desktop-settings"
          ? { defaultConnectionOrigin: "local" }
          : null,
    };
    for (const connectionType of ["rdp", "vnc", "telnet"]) {
      await expect(
        resolveConnectionOrigin({ connectionType, connectionOrigin: null }),
      ).resolves.toBe("remote");
    }
  });

  it("honors an explicit local override for rdp/vnc/telnet", async () => {
    win.IS_ELECTRON = true;
    for (const connectionType of ["rdp", "vnc", "telnet"]) {
      await expect(
        resolveConnectionOrigin({ connectionType, connectionOrigin: "local" }),
      ).resolves.toBe("local");
    }
  });

  it("honors an explicit remote override for rdp/vnc/telnet", async () => {
    win.IS_ELECTRON = true;
    for (const connectionType of ["rdp", "vnc", "telnet"]) {
      await expect(
        resolveConnectionOrigin({ connectionType, connectionOrigin: "remote" }),
      ).resolves.toBe("remote");
    }
  });

  it("resolves rdp to local outside Electron, where there is only one backend", async () => {
    await expect(
      resolveConnectionOrigin({
        connectionType: "rdp",
        connectionOrigin: null,
      }),
    ).resolves.toBe("local");
  });

  it("always resolves serial to local, even with a remote override", async () => {
    win.IS_ELECTRON = true;
    await expect(
      resolveConnectionOrigin({
        connectionType: "serial",
        connectionOrigin: "remote",
      }),
    ).resolves.toBe("local");
  });

  it("resolves to local outside Electron regardless of connectionType", async () => {
    await expect(
      resolveConnectionOrigin({
        connectionType: "ssh",
        connectionOrigin: "remote",
      }),
    ).resolves.toBe("local");
  });

  it("honors a host-level override for ssh in Electron", async () => {
    win.IS_ELECTRON = true;
    await expect(
      resolveConnectionOrigin({
        connectionType: "ssh",
        connectionOrigin: "remote",
      }),
    ).resolves.toBe("remote");
    await expect(
      resolveConnectionOrigin({
        connectionType: "ssh",
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
        connectionType: "ssh",
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
        connectionType: "ssh",
        connectionOrigin: null,
      }),
    ).resolves.toBe("local");
  });
});

/**
 * The embedded backend authenticates a local WebSocket from `?token=`, because
 * the browser WebSocket API cannot set an Authorization header. Electron's main
 * process does inject a JWT cookie, but only on an exact origin match, and the
 * remembered cookie belongs to the API origin (`localhost:30001`) — so nothing
 * is attached to a `127.0.0.1:30009` connection.
 *
 * The Docker console opted out of the query token and had no other credential
 * left, so its handshake was closed with 1008 while logs and stats kept working.
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
      localPort: 30009,
      localPath: "/docker/console/",
      remotePath: "/docker/console/",
    });

    expect(target).toEqual({
      url: "ws://127.0.0.1:30009/docker/console/",
      protocols: ["termix.jwt.local-jwt"],
    });
  });

  it("omits it only when a caller asks", async () => {
    const target = await buildOriginWsUrl({
      origin: "local",
      localPort: 30009,
      localPath: "/docker/console/",
      remotePath: "/docker/console/",
      includeJwt: false,
    });

    expect(target).toEqual({
      url: "ws://127.0.0.1:30009/docker/console/",
      protocols: [],
    });
  });

  it("does not duplicate the Guacamole token on remote connections", async () => {
    win.electronAPI = {
      invoke: async (channel: string) => {
        if (channel === "get-remote-sync-config") {
          return { serverUrl: "https://termix.example" };
        }
        if (channel === "get-remote-sync-jwt") return "remote-jwt";
        return null;
      },
    };

    const target = await buildOriginWsUrl({
      origin: "remote",
      localPort: 30008,
      localPath: "/guacamole/websocket/",
      remotePath: "/guacamole/websocket/",
      includeJwt: false,
    });

    expect(target).toEqual({
      url: "wss://termix.example/guacamole/websocket/",
      protocols: [],
    });
  });

  it("leaves the URL alone when there is no token stored", async () => {
    delete store.jwt;

    const target = await buildOriginWsUrl({
      origin: "local",
      localPort: 30002,
      localPath: "",
      remotePath: "/ssh/websocket/",
    });

    expect(target).toEqual({
      url: "ws://127.0.0.1:30002",
      protocols: [],
    });
  });
});
