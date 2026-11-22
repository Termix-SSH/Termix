/**
 * The boot repair of hosts that store two SSH ports, through the repository
 * it reads and writes with. Runs on Postgres and MySQL in the dialects job.
 */

import { afterEach, describe, expect, it } from "vitest";
import { drizzle as mysqlDrizzle } from "drizzle-orm/mysql2";
import { TestSqliteDatabase } from "./test-support.js";
import {
  HostDefaultsRepository,
  type HostRow,
} from "../../../database/repositories/host-defaults-repository.js";
import { repairSshPorts } from "../../../upgrade/ssh-port-repair-migration.js";

const OLD = "2000-01-01T00:00:00.000Z";

/** id, port, ssh_port, connection_type, enable_ssh, default_overrides, shared_source */
const SHAPES: Array<
  [number, number, number | null, string, number, string | null, string | null]
> = [
  [1, 2222, 22, "ssh", 1, '{"core":[]}', null],
  [2, 2222, 22, "ssh", 1, null, null],
  [3, 2230, 22, "ssh", 1, '{"core":["sshPort"]}', null],
  [4, 2222, 2200, "ssh", 1, '{"core":["username"]}', null],
  [5, 22, 2200, "ssh", 1, '{"core":[]}', null],
  [6, 2222, 22, "ssh", 0, '{"core":[]}', null],
  [7, 70000, 22, "ssh", 1, null, null],
  [8, 2222, 22, "ssh", 1, "not json", null],
  [9, 2222, 22, "ssh", 1, '{"term":[]}', null],
  [10, 22, 22, "ssh", 1, '{"core":[]}', null],
  [11, 2222, null, "ssh", 1, '{"core":[]}', null],
  [12, 3389, 22, "rdp", 1, '{"core":[]}', null],
  [13, 2222, 22, "ssh", 1, '{"core":[]}', '{"ownerId":"user-2"}'],
  [14, 2222, 22, "SSH", 1, '{"core":[]}', null],
];

/** What each row holds after the repair: ssh_port, default_overrides, written. */
const EXPECTED: Record<number, [number | null, string | null, boolean]> = {
  1: [2222, '{"core":["sshPort"]}', true],
  2: [2222, null, true],
  3: [2230, '{"core":["sshPort"]}', true],
  4: [2200, '{"core":["sshPort","username"]}', true],
  5: [2200, '{"core":["sshPort"]}', true],
  6: [22, '{"core":["sshPort"]}', true],
  7: [22, null, false],
  8: [2222, "not json", true],
  9: [2222, '{"term":[]}', true],
  10: [22, '{"core":[]}', false],
  11: [null, '{"core":[]}', false],
  12: [22, '{"core":[]}', false],
  13: [22, '{"core":[]}', false],
  14: [22, '{"core":[]}', false],
};

function quote(value: string | number | null): string {
  if (value === null) return "NULL";
  return typeof value === "number" ? String(value) : `'${value}'`;
}

describe("repairSshPorts", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    await adapter?.close();
    adapter = null;
  });

  async function seed(
    shapes = SHAPES,
  ): Promise<{ repository: HostDefaultsRepository }> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    const values = shapes
      .map(
        ([id, port, sshPort, type, enableSsh, overrides, shared]) =>
          `(${id}, 'user-1', 'h${id}', '10.0.0.${id}', ${port}, ${quote(sshPort)}, 'root', 'password', ${quote(type)}, ${enableSsh === 1 ? "TRUE" : "FALSE"}, ${quote(overrides)}, ${quote(shared)}, '${OLD}')`,
      )
      .join(",\n");
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash) VALUES ('user-1', 'alice', 'hash');
      INSERT INTO ssh_data (id, user_id, name, ip, port, ssh_port, username, auth_type, connection_type, enable_ssh, default_overrides, shared_source, updated_at)
      VALUES ${values};
    `);
    return { repository: new HostDefaultsRepository(context) };
  }

  async function rows(
    repository: HostDefaultsRepository,
  ): Promise<Map<number, HostRow>> {
    const all = await repository.listHosts({ all: true });
    return new Map(all.map((row) => [row.id, row]));
  }

  it("repairs every row shape as the plan says, and only those it changes", async () => {
    const { repository } = await seed();
    const result = await repairSshPorts(repository);

    const after = await rows(repository);
    for (const [id, [sshPort, overrides, written]] of Object.entries(
      EXPECTED,
    )) {
      const row = after.get(Number(id))!;
      expect(
        [row.sshPort, row.defaultOverrides, row.updatedAt !== OLD],
        `row ${id}`,
      ).toEqual([sshPort, overrides, written]);
      // The port a host dials is never written.
      expect(row.port, `row ${id}`).toBe(
        SHAPES.find(([shapeId]) => shapeId === Number(id))![1],
      );
    }
    expect(result.repaired.sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 8, 9,
    ]);
    expect(result.ambiguous.sort((a, b) => a - b)).toEqual([4, 5, 6, 7]);

    // A second run has nothing left to write.
    const again = await repairSshPorts(repository);
    expect(again.repaired).toEqual([]);
    const unchanged = await rows(repository);
    for (const [id, row] of after) {
      expect(unchanged.get(id)!.updatedAt, `row ${id}`).toBe(row.updatedAt);
    }
  });

  it.each([
    ["port", "port = 2300"],
    ["ssh_port", "ssh_port = 2201"],
    ["default_overrides", `default_overrides = '{"core":["username"]}'`],
    ["connection_type", "connection_type = 'rdp'"],
    // Only in case, which MySQL's usual collation ignores.
    ["connection_type's case", "connection_type = 'SSH'"],
    ["default_overrides' case", `default_overrides = '{"CORE":[]}'`],
    ["enable_ssh", "enable_ssh = FALSE"],
    ["shared_source", `shared_source = '{"ownerId":"user-2"}'`],
  ])("leaves a row whose %s changed after it was read", async (_field, set) => {
    const { repository } = await seed([SHAPES[0]]);
    const racing = Object.create(repository) as HostDefaultsRepository;
    racing.listSshPortMismatches = async () => {
      const found = await repository.listSshPortMismatches();
      await adapter!.exec(`UPDATE ssh_data SET ${set} WHERE id = 1`);
      return found;
    };

    expect((await repairSshPorts(racing)).repaired).toEqual([]);
    const row = (await rows(repository)).get(1)!;
    expect(row.updatedAt).toBe(OLD);
    expect(row.sshPort).toBe(set.startsWith("ssh_port") ? 2201 : 22);
  });

  it("finishes on the next run after failing part way", async () => {
    const { repository } = await seed([SHAPES[0], SHAPES[1]]);
    const failing = Object.create(repository) as HostDefaultsRepository;
    let calls = 0;
    failing.updateSshPortRow = async (row, values) => {
      if (++calls === 2) throw new Error("connection lost");
      return repository.updateSshPortRow(row, values);
    };

    await expect(repairSshPorts(failing)).rejects.toThrow("connection lost");
    const partial = await rows(repository);
    expect([partial.get(1)!.sshPort, partial.get(2)!.sshPort]).toEqual([
      2222, 22,
    ]);

    expect((await repairSshPorts(repository)).repaired).toEqual([2]);
    const done = await rows(repository);
    expect([done.get(1)!.sshPort, done.get(2)!.sshPort]).toEqual([2222, 2222]);
  });
});

describe("updateSshPortRow on MySQL", () => {
  it("compares the text it decided on exactly, whatever the collation", async () => {
    const queries: string[] = [];
    const client = {
      query: async (query: { sql: string } | string) => {
        queries.push(typeof query === "string" ? query : query.sql);
        return [{ affectedRows: 1 }, []];
      },
    };
    const repository = new HostDefaultsRepository({
      dialect: "mysql",
      drizzle: mysqlDrizzle({ client: client as never }) as never,
    });
    await repository.updateSshPortRow(
      {
        id: 1,
        port: 2222,
        sshPort: 22,
        defaultOverrides: '{"core":[]}',
        connectionType: "ssh",
        enableSsh: true,
        sharedSource: null,
      },
      { sshPort: 2222 },
    );
    expect(queries).toHaveLength(1);
    for (const column of ["connection_type", "default_overrides"]) {
      expect(queries[0]).toMatch(
        new RegExp(
          `CAST\\(\\S*\\b${column}\\S* AS BINARY\\) = CAST\\(\\? AS BINARY\\)`,
        ),
      );
    }
  });
});
