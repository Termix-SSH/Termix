import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;
let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "session-recording-routes-"),
  );
});

afterEach(async () => {
  await server?.close();
  server = null;
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("session recording routes", () => {
  it("401s without an authenticated actor", async () => {
    server = await startServer();
    const res = await server.request("GET", "/", { user: "" });
    expect(res.status).toBe(401);
  });

  it("lists only the caller's own recordings", async () => {
    server = await startServer();

    const table = await server.mock.ctx.db.client<{
      insert: (t: unknown) => {
        values: (v: unknown) => Promise<unknown>;
      };
    }>();
    void table;

    // Seed through the repository the way activate() wired it: easiest is a
    // direct HTTP round trip isn't available for writes (only ssh-terminal
    // and remote-desktop write through the service), so seed the table
    // directly.
    server.db.sqlite
      .prepare(
        `INSERT INTO p_session_recording_session_recordings
         (host_id, user_id, recording_path, protocol, format, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        7,
        "user-1",
        "/tmp/a.cast",
        "ssh",
        "asciicast",
        new Date().toISOString(),
      );
    server.db.sqlite
      .prepare(
        `INSERT INTO p_session_recording_session_recordings
         (host_id, user_id, recording_path, protocol, format, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        7,
        "user-2",
        "/tmp/b.cast",
        "ssh",
        "asciicast",
        new Date().toISOString(),
      );

    const res = await server.request("GET", "/", { user: "user-1" });
    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(1);
    expect(res.body.logs[0].userId).toBe("user-1");
  });

  it("404s getting another user's recording", async () => {
    server = await startServer();
    server.db.sqlite
      .prepare(
        `INSERT INTO p_session_recording_session_recordings
         (host_id, user_id, recording_path, protocol, format, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        7,
        "user-2",
        "/tmp/b.cast",
        "ssh",
        "asciicast",
        new Date().toISOString(),
      );

    const res = await server.request("GET", "/1", { user: "user-1" });
    expect(res.status).toBe(404);
  });

  it("serves file content within the plugin's data directory", async () => {
    server = await startServer();
    const filePath = path.join(dataDir, "session_logs", "user-1", "a.cast");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '{"version":2}\n[0,"o","hi"]\n');

    server.db.sqlite
      .prepare(
        `INSERT INTO p_session_recording_session_recordings
         (host_id, user_id, recording_path, protocol, format, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(7, "user-1", filePath, "ssh", "asciicast", new Date().toISOString());

    // Point ctx.files.dataDir() at the temp dir for this request.
    (
      server.mock.ctx as unknown as {
        files: { dataDir: () => Promise<string> };
      }
    ).files = { dataDir: async () => dataDir };

    const res = await server.requestBinary("GET", "/1/content", {
      user: "user-1",
    });
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("asciicast");
  });

  it("refuses a path outside the plugin's data directory", async () => {
    server = await startServer();
    server.db.sqlite
      .prepare(
        `INSERT INTO p_session_recording_session_recordings
         (host_id, user_id, recording_path, protocol, format, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        7,
        "user-1",
        "/etc/passwd",
        "ssh",
        "asciicast",
        new Date().toISOString(),
      );

    (
      server.mock.ctx as unknown as {
        files: { dataDir: () => Promise<string> };
      }
    ).files = { dataDir: async () => dataDir };

    const res = await server.requestBinary("GET", "/1/content", {
      user: "user-1",
    });
    expect(res.status).toBe(403);
  });

  it("deletes only the caller's own recording", async () => {
    server = await startServer();
    server.db.sqlite
      .prepare(
        `INSERT INTO p_session_recording_session_recordings
         (host_id, user_id, recording_path, protocol, format, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        7,
        "user-1",
        "/tmp/a.cast",
        "ssh",
        "asciicast",
        new Date().toISOString(),
      );

    const denied = await server.request("DELETE", "/1", { user: "user-2" });
    expect(denied.status).toBe(404);

    const ok = await server.request("DELETE", "/1", { user: "user-1" });
    expect(ok.status).toBe(200);
  });
});
