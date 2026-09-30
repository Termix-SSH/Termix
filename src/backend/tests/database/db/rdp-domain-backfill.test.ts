import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("RDP domain across database boots", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-rdp-domain-"));
    vi.resetModules();
    vi.stubEnv("DATA_DIR", dataDir);
    vi.stubEnv("DB_FILE_ENCRYPTION", "false");
    vi.stubEnv("ALLOW_EMPTY_DATA_DIR", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it.each([
    { saved: "CORP", legacy: null, expected: "CORP" },
    { saved: "CORP", legacy: "OLD", expected: "CORP" },
    { saved: "", legacy: "OLD", expected: "" },
    { saved: null, legacy: "LEGACY", expected: null },
  ])("preserves $saved with legacy domain $legacy across boots", async ({
    saved,
    legacy,
    expected,
  }) => {
    const seed = new Database(":memory:");
    seed.exec(
      fs.readFileSync(
        new URL("../../fixtures/sqlite-2.8-schema.sql", import.meta.url),
        "utf8",
      ),
    );
    seed.exec(`
      INSERT INTO users (id, username, password_hash)
        VALUES ('owner', 'alice', 'hash');
    `);
    seed.prepare(`
      INSERT INTO ssh_data
        (id, user_id, ip, port, username, auth_type, connection_type,
         rdp_auth_type, rdp_user, rdp_password, rdp_domain, domain)
      VALUES (1, 'owner', '192.0.2.1', 3389, '', 'password', 'rdp',
              'credential', NULL, NULL, ?, ?)
    `).run(saved, legacy);
    fs.writeFileSync(path.join(dataDir, "db.sqlite"), seed.serialize());
    seed.close();

    for (let boot = 0; boot < 2; boot++) {
      vi.resetModules();
      const db = await import("../../../database/db/index.js");
      await db.initializeDatabase();
      expect(
        db.getSqlite()
          .prepare("SELECT rdp_domain FROM ssh_data WHERE id = 1")
          .pluck()
          .get(),
      ).toBe(expected);
      await db.saveMemoryDatabaseToFile();
    }
  });
});
