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
  it("always resolves rdp/vnc/telnet to remote, even with a local override", async () => {
    win.IS_ELECTRON = true;
    for (const connectionType of ["rdp", "vnc", "telnet"]) {
      await expect(
        resolveConnectionOrigin({ connectionType, connectionOrigin: "local" }),
      ).resolves.toBe("remote");
    }
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
    const url = await buildOriginWsUrl({
      origin: "local",
      localPort: 30009,
      localPath: "/docker/console/",
      remotePath: "/docker/console/",
    });

    expect(url).toBe("ws://127.0.0.1:30009/docker/console/?token=local-jwt");
  });

  it("omits it only when a caller asks", async () => {
    const url = await buildOriginWsUrl({
      origin: "local",
      localPort: 30009,
      localPath: "/docker/console/",
      remotePath: "/docker/console/",
      includeLocalJwt: false,
    });

    expect(url).toBe("ws://127.0.0.1:30009/docker/console/");
  });

  it("leaves the URL alone when there is no token stored", async () => {
    delete store.jwt;

    const url = await buildOriginWsUrl({
      origin: "local",
      localPort: 30002,
      localPath: "",
      remotePath: "/ssh/websocket/",
    });

    expect(url).toBe("ws://127.0.0.1:30002");
  });
});
