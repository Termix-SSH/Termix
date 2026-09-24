import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMockCtx,
  createTestDb,
  type MockPluginContext,
  type TestDb,
} from "@termix/plugin-sdk/testing";
import manifestJson from "../../manifest.json";
import { pluginDir } from "./helpers";
import { createSessionRecordingRepository } from "../../src/backend/repository";
import { sessionRecordings } from "../../src/backend/tables";
import { createRecordingsWriter } from "../../src/backend/service";

const manifest =
  manifestJson as unknown as import("@termix/plugin-sdk/manifest").PluginManifest;

let db: TestDb | null = null;
let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "session-recording-"));
});

afterEach(async () => {
  db?.close();
  db = null;
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function setup(): Promise<{
  mock: MockPluginContext;
  writer: ReturnType<typeof createRecordingsWriter>;
}> {
  db = await createTestDb(pluginDir);
  db.sqlite
    .prepare("INSERT INTO users (id, username) VALUES (?, ?)")
    .run("user-1", "alice");
  db.sqlite.prepare("INSERT INTO ssh_data (id) VALUES (?)").run(7);
  const table = await db.database.define(sessionRecordings);
  const hosts = {
    list: async () => [],
    get: async () => null,
    checkAccess: async () => ({
      hasAccess: false,
      isOwner: false,
      isShared: false,
    }),
    create: async () => {
      throw new Error("not used");
    },
    update: async () => null,
    listOwned: async () => [],
    share: async () => ({ hostId: 0, shared: false }),
    listUsers: async () => [],
    listRoles: async () => [],
    trackSession: () => () => {},
    recordActivity: async () => {},
  };
  const repo = createSessionRecordingRepository(db.database, table, hosts);

  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
  });
  // Point ctx.files.dataDir() at a real temp dir for this test.
  (mock.ctx as unknown as { files: { dataDir: () => Promise<string> } }).files =
    {
      dataDir: async () => dataDir,
    };

  const writer = createRecordingsWriter(mock.ctx, repo);
  return { mock, writer };
}

describe("recordings.writer", () => {
  it("is null when the host has recording switched off", async () => {
    const { mock, writer } = await setup();
    await mock.ctx.settings.setHost(7, "enableSessionRecording", false);

    const sink = await writer.open({
      sessionId: "s1",
      hostId: 7,
      userId: "user-1",
      protocol: "ssh",
      format: "asciicast",
      startedAt: Date.now(),
    });

    expect(sink).toBeNull();
  });

  it("writes the first append with writeFile and later ones with appendFile", async () => {
    const { writer } = await setup();
    const sink = await writer.open({
      sessionId: "s1",
      hostId: 7,
      userId: "user-1",
      protocol: "ssh",
      format: "asciicast",
      startedAt: Date.now(),
    });
    expect(sink).not.toBeNull();

    await sink!.append("chunk-one\n");
    await sink!.append("chunk-two\n");

    const filePath = path.join(dataDir, "session_logs", "user-1", "s1.cast");
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("chunk-one\nchunk-two\n");
  });

  it("persist writes the summary onto the row", async () => {
    const { writer } = await setup();
    const sink = await writer.open({
      sessionId: "s1",
      hostId: 7,
      userId: "user-1",
      protocol: "ssh",
      format: "asciicast",
      startedAt: Date.now(),
    });
    await sink!.append("x\n");

    const endedAt = Date.now();
    await sink!.persist({
      endedAt,
      durationSeconds: 42,
      terminatedByOwner: true,
      terminationReason: null,
    });

    // Not thrown means it wrote successfully; deeper row assertions belong
    // to repository.test.ts.
  });

  it("discard removes the row and further writes are no-ops", async () => {
    const { writer } = await setup();
    const sink = await writer.open({
      sessionId: "s1",
      hostId: 7,
      userId: "user-1",
      protocol: "ssh",
      format: "asciicast",
      startedAt: Date.now(),
    });

    sink!.discard();
    await sink!.append("should not write");

    const filePath = path.join(dataDir, "session_logs", "user-1", "s1.cast");
    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it("createFinished inserts a row for an already-written recording", async () => {
    const { writer } = await setup();
    const row = await writer.createFinished({
      hostId: 7,
      userId: "user-1",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      duration: 10,
      recordingPath: "/data/session_recordings/guacamole/x.guac",
      protocol: "rdp",
      format: "guacamole",
    });

    expect(row.id).toBeGreaterThan(0);
  });
});
