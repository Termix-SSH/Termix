import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import {
  createMockCtx,
  createTestDb,
  type TestDb,
} from "@termix/plugin-sdk/testing";
import { PluginCapabilityError } from "@termix/plugin-sdk/backend";
import { activate } from "../../src/backend/index.js";
import { hostImportNormalizer } from "../../src/backend/host-import.js";
import type {
  LiveSessionsV1,
  TerminalHistoryV1,
} from "../../src/backend/services.js";
import { manifest, pluginDir, startServer, type TestServer } from "./helpers";

let db: TestDb | null = null;
let server: TestServer | null = null;

afterEach(async () => {
  db?.close();
  db = null;
  await server?.close();
  server = null;
});

describe("ssh-terminal activate", () => {
  it("serves the terminal socket", async () => {
    server = await startServer();
    expect(server.mock.wsRoutes).toMatchObject([
      { path: "/terminal", raw: false },
    ]);
  });

  it("provides sessions.live as ssh and terminal.history", async () => {
    server = await startServer();
    const live = server.mock.services.get(
      "sessions.live#ssh",
    ) as LiveSessionsV1;
    expect(live.getSession("missing")).toBeNull();
    expect(live.listForUser("user-1")).toEqual([]);
    expect(live.write("missing", "ls\r")).toBe(false);
    expect(live.idleTimeoutMinutes()).toBe(30);

    await server.request("POST", "/command-history", {
      body: { hostId: 1, command: "df -h" },
    });
    const history = server.mock.services.get(
      "terminal.history",
    ) as TerminalHistoryV1;
    const listed = await server.mock.ctx.asUser("user-1", () =>
      history.list(1, 10),
    );
    expect(listed.map((entry) => entry.command)).toEqual(["df -h"]);
  });

  it("keeps a plugin caller to its own actor's sessions", async () => {
    server = await startServer();
    const live = server.mock.services.get(
      "sessions.live#ssh",
    ) as LiveSessionsV1;
    const other = await server.mock.ctx.asUser("user-2", async () =>
      live.listForUser("user-1"),
    );
    expect(other).toEqual([]);
  });

  it("uses the admin session timeout for detached sessions", async () => {
    server = await startServer({ settings: { sessionTimeoutMinutes: 90 } });
    const live = server.mock.services.get(
      "sessions.live#ssh",
    ) as LiveSessionsV1;
    expect(live.idleTimeoutMinutes()).toBe(90);
  });

  it("offers a host import normalizer", async () => {
    server = await startServer();
    expect(
      server.mock.ctx.registry.consume("ssh-terminal.hostImportNormalizer"),
    ).toBe(hostImportNormalizer);
  });

  it.each(["db:own", "network:serve"])(
    "fails closed without %s",
    async (capability) => {
      db = await createTestDb(pluginDir);
      const mock = createMockCtx({
        pluginId: manifest.id,
        manifest,
        capabilities: manifest.capabilities.filter((c) => c !== capability),
        db: db.database,
        router: () => express.Router(),
      });
      await expect(activate(mock.ctx)).rejects.toBeInstanceOf(
        PluginCapabilityError,
      );
      for (const dispose of [...mock.disposals].reverse()) await dispose();
    },
  );
});

describe("host import", () => {
  it("carries the terminal switches of an imported host", () => {
    expect(hostImportNormalizer({ name: "web" })).toBeNull();
    expect(
      hostImportNormalizer({
        enableTerminal: false,
        enableCommandHistory: true,
      }),
    ).toEqual({ enableTerminal: false, enableCommandHistory: true });
  });
});
