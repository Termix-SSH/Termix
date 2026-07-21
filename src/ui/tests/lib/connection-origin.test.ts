import { describe, it, expect, afterEach } from "vitest";
import { resolveConnectionOrigin } from "../../lib/connection-origin.js";

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
