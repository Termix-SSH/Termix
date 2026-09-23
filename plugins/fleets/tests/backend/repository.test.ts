import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import type {
  PluginHostSummary,
  PluginHosts,
} from "@termix/plugin-sdk/backend";
import { pluginDir } from "./helpers";
import {
  fleets,
  fleetMembers,
  fleetInventory,
} from "../../src/backend/tables.js";
import { createFleetRepository } from "../../src/backend/repository.js";

let db: TestDb | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

function fakeHosts(hosts: PluginHostSummary[]): PluginHosts {
  return {
    list: async () => hosts,
    get: async (hostId) => hosts.find((h) => h.id === hostId) ?? null,
    checkAccess: async (hostId) => {
      const found = hosts.find((h) => h.id === hostId);
      return found
        ? {
            hasAccess: true,
            isOwner: true,
            isShared: false,
            permissionLevel: "manage",
          }
        : { hasAccess: false, isOwner: false, isShared: false };
    },
    share: async (hostId) => ({ hostId, shared: true }),
    listUsers: async () => [],
    listRoles: async () => [],
  };
}

async function setup(hosts: PluginHostSummary[]) {
  db = await createTestDb(pluginDir, {
    before: (sqlite) => {
      sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
      sqlite.exec(
        `INSERT INTO ssh_data (id) VALUES ${hosts.map((h) => `(${h.id})`).join(", ")}`,
      );
    },
  });

  const fleetsTable = await db.database.define(fleets);
  const membersTable = await db.database.define(fleetMembers);
  const inventoryTable = await db.database.define(fleetInventory);
  const repo = createFleetRepository(
    db.database,
    fakeHosts(hosts),
    fleetsTable,
    membersTable,
    inventoryTable,
  );
  return repo;
}

function host(
  id: number,
  overrides: Partial<PluginHostSummary> = {},
): PluginHostSummary {
  return {
    id,
    userId: "user-1",
    name: `host-${id}`,
    ip: `10.0.0.${id}`,
    port: 22,
    username: "root",
    tags: null,
    folder: null,
    authType: "password",
    ...overrides,
  };
}

describe("FleetRepository.listEffectiveMembers", () => {
  it("unions static membership and tag-matched hosts, deduplicated by id", async () => {
    const repo = await setup([
      host(1, { tags: "prod-web,edge" }),
      host(2, { tags: "prod-web" }),
      host(3, { tags: "prod-db" }),
      host(4, { tags: null }),
      host(5, { userId: "user-2", tags: "prod-web" }),
    ]);

    const fleet = await repo.create("user-1", {
      name: "web fleet",
      tagRules: ["prod-web"],
    });
    // host 1 matches by tag AND is added statically - must appear once.
    await repo.addMember(fleet.id, 1);
    // host 4 has no tags - only reachable via static membership.
    await repo.addMember(fleet.id, 4);

    const members = await repo.listEffectiveMembers("user-1", fleet.id);
    const ids = members.map((m) => m.id).sort((a, b) => a - b);

    expect(ids).toEqual([1, 2, 4]);
  });

  it("never returns another user's hosts even if tags match", async () => {
    const repo = await setup([
      host(1, { tags: "prod-web" }),
      host(5, { userId: "user-2", tags: "prod-web" }),
    ]);

    const fleet = await repo.create("user-1", {
      name: "web fleet",
      tagRules: ["prod-web"],
    });

    const members = await repo.listEffectiveMembers("user-1", fleet.id);
    expect(members.map((m) => m.id)).not.toContain(5);
  });

  it("returns only static members when a fleet has no tag rules", async () => {
    const repo = await setup([host(3, { tags: "prod-db" })]);

    const fleet = await repo.create("user-1", { name: "static fleet" });
    await repo.addMember(fleet.id, 3);

    const members = await repo.listEffectiveMembers("user-1", fleet.id);
    expect(members.map((m) => m.id)).toEqual([3]);
  });

  it("removeMember only drops the static row, not tag-based membership", async () => {
    const repo = await setup([host(1, { tags: "prod-web" })]);

    const fleet = await repo.create("user-1", {
      name: "web fleet",
      tagRules: ["prod-web"],
    });
    await repo.addMember(fleet.id, 1);

    await expect(repo.removeMember(fleet.id, 1)).resolves.toBe(true);

    // host 1 still matches the tag rule, so it remains an effective member.
    const members = await repo.listEffectiveMembers("user-1", fleet.id);
    expect(members.map((m) => m.id)).toContain(1);
  });

  it("returns an empty list for a fleet the caller does not own", async () => {
    const repo = await setup([host(1)]);
    const fleet = await repo.create("user-1", { name: "private" });

    await expect(
      repo.listEffectiveMembers("user-2", fleet.id),
    ).resolves.toEqual([]);
  });
});

describe("FleetRepository CRUD", () => {
  it("creates, updates and deletes a fleet", async () => {
    const repo = await setup([host(1)]);
    const created = await repo.create("user-1", {
      name: "Fleet",
      tagRules: ["a"],
    });
    expect(created.name).toBe("Fleet");
    expect(created.tagRules).toBe('["a"]');

    const updated = await repo.update("user-1", created.id, {
      name: "Renamed",
    });
    expect(updated?.name).toBe("Renamed");

    await expect(repo.delete("user-1", created.id)).resolves.toBe(true);
    await expect(repo.findById("user-1", created.id)).resolves.toBeNull();
  });

  it("upserts and lists inventory per host", async () => {
    const repo = await setup([host(1)]);
    await repo.upsertInventory("user-1", 1, {
      osPrettyName: "Debian",
      kernel: "6.1.0",
      architecture: "x86_64",
      hostname: "web-1",
      uptimeSeconds: 100,
      ip: "10.0.0.1",
      packageManager: "apt",
    });

    const rows = await repo.listInventoryForHosts("user-1", [1]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ hostId: 1, osPrettyName: "Debian" });

    // Refreshing overwrites the latest-only snapshot rather than adding a row.
    await repo.upsertInventory("user-1", 1, {
      osPrettyName: "Ubuntu",
      kernel: "6.2.0",
      architecture: "x86_64",
      hostname: "web-1",
      uptimeSeconds: 200,
      ip: "10.0.0.1",
      packageManager: "apt",
    });
    const refreshed = await repo.listInventoryForHosts("user-1", [1]);
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0].osPrettyName).toBe("Ubuntu");
  });
});
