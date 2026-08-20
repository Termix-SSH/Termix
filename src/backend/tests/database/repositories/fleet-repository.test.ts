import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { FleetRepository } from "../../../database/repositories/fleet-repository.js";

describe("FleetRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<{ repository: FleetRepository }> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type, tags)
      VALUES
        (1, 'user-1', 'web-1', '10.0.0.1', 22, 'root', 'password', 'prod-web,edge'),
        (2, 'user-1', 'web-2', '10.0.0.2', 22, 'root', 'password', 'prod-web'),
        (3, 'user-1', 'db-1', '10.0.0.3', 22, 'root', 'password', 'prod-db'),
        (4, 'user-1', 'static-only', '10.0.0.4', 22, 'root', 'password', NULL),
        (5, 'user-2', 'other-user-host', '10.0.0.5', 22, 'root', 'password', 'prod-web');
    `);

    return { repository: new FleetRepository(context, onWrite) };
  }

  it("unions static membership and tag-matched hosts, deduplicated by id", async () => {
    let writes = 0;
    const { repository } = await createRepository(() => {
      writes += 1;
    });

    const fleet = await repository.create("user-1", {
      name: "web fleet",
      tagRules: ["prod-web"],
    });
    // host 1 matches by tag AND is added statically - must appear once.
    await repository.addMember(fleet.id, 1);
    // host 4 has no tags - only reachable via static membership.
    await repository.addMember(fleet.id, 4);

    const members = await repository.listEffectiveMembers("user-1", fleet.id);
    const ids = members.map((m) => m.id).sort((a, b) => a - b);

    expect(ids).toEqual([1, 2, 4]);
    expect(writes).toBeGreaterThan(0);
  });

  it("never returns another user's hosts even if tags match", async () => {
    const { repository } = await createRepository();

    const fleet = await repository.create("user-1", {
      name: "web fleet",
      tagRules: ["prod-web"],
    });

    const members = await repository.listEffectiveMembers("user-1", fleet.id);
    expect(members.map((m) => m.id)).not.toContain(5);
  });

  it("returns only static members when a fleet has no tag rules", async () => {
    const { repository } = await createRepository();

    const fleet = await repository.create("user-1", { name: "static fleet" });
    await repository.addMember(fleet.id, 3);

    const members = await repository.listEffectiveMembers("user-1", fleet.id);
    expect(members.map((m) => m.id)).toEqual([3]);
  });

  it("removeMember only drops the static row, not tag-based membership", async () => {
    const { repository } = await createRepository();

    const fleet = await repository.create("user-1", {
      name: "web fleet",
      tagRules: ["prod-web"],
    });
    await repository.addMember(fleet.id, 1);

    await expect(repository.removeMember(fleet.id, 1)).resolves.toBe(true);

    // host 1 still matches the tag rule, so it remains an effective member.
    const members = await repository.listEffectiveMembers("user-1", fleet.id);
    expect(members.map((m) => m.id)).toContain(1);
  });

  it("returns an empty list for a fleet the caller does not own", async () => {
    const { repository } = await createRepository();
    const fleet = await repository.create("user-1", { name: "private" });

    await expect(
      repository.listEffectiveMembers("user-2", fleet.id),
    ).resolves.toEqual([]);
  });
});
