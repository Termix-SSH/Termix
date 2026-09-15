import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const GuacdClient = require("../node_modules/guacamole-lite/lib/GuacdClient.js");
const GuacamoleLite = require("../node_modules/guacamole-lite/lib/Server.js");

type PatchedGuacdClient = {
  connectionSettings: Record<string, unknown>;
  nextArgumentStreamIndex: number;
  sendInstruction: ReturnType<typeof vi.fn>;
  sendHandshakeReply: (serverHandshake: string[]) => void;
  sendRequiredArguments: (params: string[]) => void;
};

function createPatchedClient(
  connectionSettings: Record<string, unknown>,
): PatchedGuacdClient {
  return Object.assign(Object.create(GuacdClient.prototype), {
    connectionSettings,
    logger: { log: vi.fn() },
    nextArgumentStreamIndex: 0,
    sendInstruction: vi.fn(),
  });
}

describe("patch-guacamole-lite", () => {
  it("rejects a malformed token without starting or retaining a connection", async () => {
    const server = Object.assign(Object.create(GuacamoleLite.prototype), {
      connectionsCount: 0,
      clientOptions: {
        crypt: {
          cypher: "AES-256-CBC",
          key: Buffer.alloc(32, 7),
        },
        log: {
          level: 0,
          stdLog: vi.fn(),
          errorLog: vi.fn(),
        },
      },
      callbacks: {
        processConnectionSettings: vi.fn(),
      },
      extractGuacdOptions: vi.fn(async () => ({
        guacdOptions: { host: "127.0.0.1", port: 4822 },
        connectionInfo: null,
        isJoin: false,
        targetSessionId: null,
      })),
      activeConnections: new Map(),
      emit: vi.fn(),
    });
    const webSocket = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    };

    await server.newConnection(webSocket, {
      url: "/guacamole/websocket/?token=not-an-encrypted-token",
    });

    expect(webSocket.close).toHaveBeenCalledOnce();
    expect(server.activeConnections.size).toBe(0);
    expect(server.emit).not.toHaveBeenCalledWith("open", expect.anything());
  });

  it("handles guacd dynamic argument requests", () => {
    const guacdClientPath = path.join(
      process.cwd(),
      "node_modules",
      "guacamole-lite",
      "lib",
      "GuacdClient.js",
    );

    const content = fs.readFileSync(guacdClientPath, "utf8");

    expect(content).toContain("sendRequiredArguments(params)");
    expect(content).toContain("opcode === 'required' || opcode === 'require'");
    expect(content).toContain("this.sendInstruction(['argv'");
    expect(content).toContain("this.sendInstruction(['blob'");
    expect(content).toContain("this.sendInstruction(['end'");
  });

  it("keeps required-argument support when guacd offers a future 1.x protocol", () => {
    const client = createPatchedClient({
      hostname: "192.0.2.10",
      port: 5900,
      password: "secret",
      width: 1280,
      height: 720,
      dpi: 96,
    });

    client.sendHandshakeReply(["VERSION_1_6_0", "hostname", "port"]);

    expect(client.sendInstruction).toHaveBeenCalledWith(["timezone"]);
    expect(client.sendInstruction).toHaveBeenCalledWith([
      "name",
      "guacamole-lite",
    ]);
    expect(client.sendInstruction).toHaveBeenCalledWith([
      "connect",
      "VERSION_1_5_0",
      "192.0.2.10",
      5900,
    ]);
  });

  it("sends name instruction for VERSION_1_1_0 to fix guacd 1.6.0 VNC drops", () => {
    const client = createPatchedClient({
      hostname: "192.0.2.10",
      port: 5900,
      password: "secret",
      width: 1280,
      height: 720,
      dpi: 96,
    });

    client.sendHandshakeReply(["VERSION_1_1_0", "hostname", "port"]);

    expect(client.sendInstruction).toHaveBeenCalledWith(["timezone"]);
    expect(client.sendInstruction).toHaveBeenCalledWith([
      "name",
      "guacamole-lite",
    ]);
    expect(client.sendInstruction).toHaveBeenCalledWith([
      "connect",
      "VERSION_1_1_0",
      "192.0.2.10",
      5900,
    ]);
  });

  it("answers required credentials through argument value streams", () => {
    const client = createPatchedClient({
      username: "",
      password: "secret",
    });

    client.sendRequiredArguments(["username", "password"]);

    expect(
      client.sendInstruction.mock.calls.map(([instruction]) => instruction),
    ).toEqual([
      ["argv", 0, "text/plain", "username"],
      ["blob", 0, ""],
      ["end", 0],
      ["argv", 1, "text/plain", "password"],
      ["blob", 1, Buffer.from("secret", "utf8").toString("base64")],
      ["end", 1],
    ]);
  });
});
