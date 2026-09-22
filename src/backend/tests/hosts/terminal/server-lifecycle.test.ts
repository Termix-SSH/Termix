/**
 * The terminal WS server's lifecycle, which the ssh-terminal plugin drives.
 *
 * There is no terminal port any more: core serves the socket at
 * /plugin-ws/ssh-terminal/terminal and the plugin hands each upgrade to the
 * WebSocketServer this module owns. So the thing worth asserting changed with
 * it. It used to be "the port stops listening"; it is now "the module binds
 * nothing on import, and disabling the plugin closes the live sessions", which
 * is what disabling a transport owner has to mean when core owns the socket.
 *
 * The terminal module is heavy (it pulls in the whole SSH stack), so this
 * exercises only the lifecycle surface.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({}),
  createCurrentCollabRoomRepository: () => ({}),
  createCurrentSessionShareRepository: () => ({}),
  createCurrentSettingsRepository: () => ({}),
  createCurrentSessionRecordingRepository: () => ({}),
}));

describe("terminal server lifecycle", () => {
  it("binds no port of its own", async () => {
    const terminal = await import("../../../hosts/terminal/index.js");

    // The old module exported a port and a listen() call. Both are gone, and
    // their absence is the contract: a plugin that binds its own port is
    // exactly what A4 removed.
    expect("TERMINAL_WS_PORT" in terminal).toBe(false);
    expect("startTerminalServer" in terminal).toBe(false);
  });

  it("exposes an upgrade handler for core to route to", async () => {
    const { handleTerminalUpgrade } =
      await import("../../../hosts/terminal/index.js");

    expect(typeof handleTerminalUpgrade).toBe("function");
  });

  it("is idempotent on stop, so a double deactivate is safe", async () => {
    const { stopTerminalServer } =
      await import("../../../hosts/terminal/index.js");

    await expect(stopTerminalServer()).resolves.toBeUndefined();
    await expect(stopTerminalServer()).resolves.toBeUndefined();
  });
});
