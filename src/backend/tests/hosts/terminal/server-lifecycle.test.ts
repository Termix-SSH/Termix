/**
 * The terminal WS server's start/stop lifecycle, which the ssh-terminal plugin
 * drives. The point of this test is the observable consequence of disabling
 * the plugin: the port actually stops listening.
 *
 * The terminal module is heavy (it pulls in the whole SSH stack), so this
 * exercises only the lifecycle functions, on a non-default port.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import net from "node:net";

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({}),
  createCurrentCollabRoomRepository: () => ({}),
  createCurrentSessionShareRepository: () => ({}),
  createCurrentSettingsRepository: () => ({}),
  createCurrentSessionRecordingRepository: () => ({}),
}));

const TEST_PORT = 39002;

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

describe("terminal server lifecycle", () => {
  afterEach(async () => {
    const { stopTerminalServer } =
      await import("../../../hosts/terminal/index.js");
    await stopTerminalServer();
  });

  it("does not listen until it is started", async () => {
    await import("../../../hosts/terminal/index.js");
    // Importing the module must not bind the port: the plugin decides that.
    expect(await isListening(TEST_PORT)).toBe(false);
  });

  it("listens after start and frees the port after stop", async () => {
    const { startTerminalServer, stopTerminalServer } =
      await import("../../../hosts/terminal/index.js");

    await startTerminalServer(TEST_PORT);
    expect(await isListening(TEST_PORT)).toBe(true);

    await stopTerminalServer();
    // This is what "disabling the plugin" has to mean for a transport owner.
    expect(await isListening(TEST_PORT)).toBe(false);
  });

  it("is idempotent on both ends", async () => {
    const { startTerminalServer, stopTerminalServer } =
      await import("../../../hosts/terminal/index.js");

    await startTerminalServer(TEST_PORT);
    await startTerminalServer(TEST_PORT);
    expect(await isListening(TEST_PORT)).toBe(true);

    await stopTerminalServer();
    await stopTerminalServer();
    expect(await isListening(TEST_PORT)).toBe(false);
  });

  it("can be restarted, so re-enabling the plugin works", async () => {
    const { startTerminalServer, stopTerminalServer } =
      await import("../../../hosts/terminal/index.js");

    await startTerminalServer(TEST_PORT);
    await stopTerminalServer();
    await startTerminalServer(TEST_PORT);

    expect(await isListening(TEST_PORT)).toBe(true);
  });
});
