/**
 * What a linked desktop keeps of a host's plugin settings for plugins that
 * aren't running on it.
 */

import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ drizzle: null as unknown }));

vi.mock("../../database/db/index.js", () => ({
  getDb: () => state.drizzle,
  getSqlite: () => null,
}));
vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { triggerSave: vi.fn() },
}));

const { TestSqliteDatabase } =
  await import("../database/repositories/test-support.js");
const {
  deletePendingHostSettings,
  getPendingHostSettings,
  listPendingHostSettings,
  setPendingHostSettings,
} = await import("../../sync/pending-host-settings.js");

let db: InstanceType<typeof TestSqliteDatabase>;

beforeEach(async () => {
  db = new TestSqliteDatabase("sqlite");
  state.drizzle = (await db.connect()).drizzle;
  await db.exec(`
    INSERT INTO users (id, username, password_hash) VALUES ('local', 'local', '');
    INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type) VALUES
      (7, 'local', 'seven', '10.0.0.7', 22, 'root', 'password'),
      (8, 'local', 'eight', '10.0.0.8', 22, 'root', 'password');
  `);
});

afterEach(async () => {
  await db.close();
});

describe("pending host plugin settings", () => {
  it("keeps a host's values by plugin, as they came", async () => {
    await setPendingHostSettings(7, {
      tunnels: { enableTunnel: true, tunnelConnections: [{ sourcePort: 22 }] },
      monitor: { interval: 5 },
    });

    expect(await getPendingHostSettings(7)).toEqual({
      tunnels: { enableTunnel: true, tunnelConnections: [{ sourcePort: 22 }] },
      monitor: { interval: 5 },
    });
    expect(await getPendingHostSettings(8)).toEqual({});
  });

  it("replaces what a host had with what came last", async () => {
    await setPendingHostSettings(7, {
      tunnels: { enableTunnel: true },
      monitor: { interval: 5 },
    });
    await setPendingHostSettings(7, { tunnels: { enableTunnel: false } });

    expect(await getPendingHostSettings(7)).toEqual({
      tunnels: { enableTunnel: false },
    });

    await setPendingHostSettings(7, {});
    expect(await getPendingHostSettings(7)).toEqual({});
  });

  it("lists what is pending for the given plugins and forgets one", async () => {
    await setPendingHostSettings(7, {
      tunnels: { enableTunnel: true },
      monitor: { interval: 5 },
    });
    await setPendingHostSettings(8, { tunnels: { enableTunnel: false } });

    expect(
      (await listPendingHostSettings(["tunnels"])).sort(
        (a, b) => a.hostId - b.hostId,
      ),
    ).toEqual([
      { hostId: 7, pluginId: "tunnels", settings: { enableTunnel: true } },
      { hostId: 8, pluginId: "tunnels", settings: { enableTunnel: false } },
    ]);
    expect(await listPendingHostSettings([])).toEqual([]);

    await deletePendingHostSettings(7, "tunnels");
    expect(await getPendingHostSettings(7)).toEqual({
      monitor: { interval: 5 },
    });
  });

  it("goes with its host", async () => {
    await setPendingHostSettings(7, { tunnels: { enableTunnel: true } });
    await db.run(sql`DELETE FROM ssh_data WHERE id = 7`);

    expect(await listPendingHostSettings(["tunnels"])).toEqual([]);
  });
});
