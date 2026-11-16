import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { asc, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import {
  hostProtocolAuth,
  hosts,
  sharedCredentialSecrets,
  sharedHostSecrets,
  sshCredentials,
} from "../../../database/db/schema.js";
import { FieldResealRepository } from "../../../database/repositories/field-reseal-repository.js";
import { protocolAuthRecordId } from "../../../database/repositories/host-protocol-auth-repository.js";
import { FieldCrypto } from "../../../utils/field-crypto.js";
import { resealFields } from "../../../upgrade/field-reseal-migration.js";
import {
  sharedCredentialSecretRecordId,
  sharedHostSecretRecordId,
} from "../../../utils/sealed-record-ids.js";

// Large enough to cross many batches; FIELD_RESEAL_ROWS raises it locally.
const ROWS = Number(process.env.FIELD_RESEAL_ROWS || 1200);

describe("FieldResealRepository with the reseal migration", () => {
  let adapter: TestSqliteDatabase | null = null;
  let backupDir: string | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
    if (backupDir) fs.rmSync(backupDir, { recursive: true, force: true });
    backupDir = null;
  });

  const keys: Record<string, Buffer> = {
    "user-1": crypto.randomBytes(32),
    "user-2": crypto.randomBytes(32),
    // Not the key user-3's value was sealed with.
    "user-3": crypto.randomBytes(32),
  };
  const seal = (user: string, value: string, id: string, field: string) =>
    FieldCrypto.encryptField(value, keys[user], id, field);

  async function seed() {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash) VALUES
        ('user-1', 'one', 'hash'),
        ('user-2', 'two', 'hash'),
        ('user-3', 'three', 'hash');
    `);
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "reseal-"));
    return context;
  }

  it("moves old temporary ids to real ids on a large database, losslessly", async () => {
    const context = await seed();
    const db = context.drizzle;

    // Every host and credential sealed under a temporary id, as 26.11.1 did.
    for (let start = 0; start < ROWS; start += 200) {
      const count = Math.min(200, ROWS - start);
      const batch = Array.from({ length: count }, (_, i) => {
        const n = start + i;
        const temp = `temp-${1700000000000 + n}`;
        return {
          userId: n % 2 ? "user-2" : "user-1",
          name: `host-${n}`,
          ip: "10.0.0.1",
          port: 22,
          username: "root",
          authType: "password",
          syncId: `sync-host-${n}`,
          password: seal(
            n % 2 ? "user-2" : "user-1",
            `pw-${n}`,
            temp,
            "password",
          ),
          sudoPassword:
            n % 3 === 0
              ? seal(
                  n % 2 ? "user-2" : "user-1",
                  `sudo-${n}`,
                  temp,
                  "sudoPassword",
                )
              : null,
        };
      });
      await db.insert(hosts).values(batch);
      await db.insert(sshCredentials).values(
        batch.map((host, i) => ({
          userId: host.userId,
          name: `cred-${start + i}`,
          username: "root",
          authType: "key",
          syncId: `sync-cred-${start + i}`,
          privateKey: seal(
            host.userId,
            `key-${start + i}`,
            String(Date.now() + i),
            "privateKey",
          ),
        })),
      );
    }

    const hostRows = await db
      .select({ id: hosts.id })
      .from(hosts)
      .orderBy(asc(hosts.id));
    const firstHost = hostRows[0].id;

    // One row already right, and one whose owner key never opens.
    await db
      .update(hosts)
      .set({
        password: seal("user-1", "pw-0", String(firstHost), "password"),
      })
      .where(sql`id = ${firstHost}`);
    await db.insert(hosts).values({
      userId: "user-3",
      name: "locked",
      ip: "10.0.0.2",
      port: 22,
      username: "root",
      authType: "password",
      syncId: "sync-locked",
      password: FieldCrypto.encryptField(
        "pw-locked",
        crypto.randomBytes(32),
        "temp-1",
        "password",
      ),
    });

    // Shared and protocol rows sealed under a stale id too.
    await adapter!.run(
      sql`INSERT INTO host_access (id, host_id, user_id, granted_by) VALUES (7, ${firstHost}, ${"user-2"}, ${"user-1"})`,
    );
    await db.insert(hostProtocolAuth).values({
      hostId: firstHost,
      userId: "user-1",
      protocol: "rdp",
      authType: "direct",
      password: seal("user-1", "rdp-pw", String(firstHost), "password"),
    });
    await db.insert(sharedHostSecrets).values({
      hostAccessId: 7,
      targetUserId: "user-2",
      protocol: "ssh",
      sourceType: "host",
      encryptedPassword: seal("user-2", "shared-pw", "temp-9", "password"),
    });
    const [firstCred] = await db
      .select({ id: sshCredentials.id })
      .from(sshCredentials)
      .orderBy(asc(sshCredentials.id))
      .limit(1);
    await adapter!.run(
      sql`INSERT INTO credential_access (id, credential_id, user_id, granted_by) VALUES (3, ${firstCred.id}, ${"user-2"}, ${"user-1"})`,
    );
    await db.insert(sharedCredentialSecrets).values({
      credentialAccessId: 3,
      targetUserId: "user-2",
      credentialId: firstCred.id,
      authType: "password",
      encryptedPassword: seal("user-2", "cred-pw", "temp-3", "password"),
    });

    const tables = new FieldResealRepository(context).tables();
    const dataKey = (userId: string) => keys[userId] ?? null;
    const started = Date.now();
    const first = await resealFields({
      tables,
      dataKey,
      backupDir: backupDir!,
    });
    const took = Date.now() - started;

    // Host passwords but the first, sudo passwords, keys, protocol, two shared.
    const expected = ROWS - 1 + Math.ceil(ROWS / 3) + ROWS + 3;
    expect(first.resealed).toBe(expected);
    expect(first.pending).toBe(0);
    expect(first.unreadable).toBe(1);
    expect(first.backupFile).toBeTruthy();
    expect(took).toBeLessThan(ROWS * 50);

    // Every value now opens strictly with its real id and keeps its plaintext.
    const allHosts = await db.select().from(hosts).orderBy(asc(hosts.id));
    allHosts
      .filter((row) => row.userId !== "user-3")
      .forEach((row, n) => {
        expect(
          FieldCrypto.decryptField(
            row.password!,
            keys[row.userId],
            String(row.id),
            "password",
          ),
        ).toBe(`pw-${n}`);
        if (n % 3 === 0) {
          expect(
            FieldCrypto.decryptField(
              row.sudoPassword!,
              keys[row.userId],
              String(row.id),
              "sudoPassword",
            ),
          ).toBe(`sudo-${n}`);
        }
      });
    const allCreds = await db
      .select()
      .from(sshCredentials)
      .orderBy(asc(sshCredentials.id));
    allCreds.forEach((row, n) => {
      expect(
        FieldCrypto.decryptField(
          row.privateKey!,
          keys[row.userId],
          String(row.id),
          "privateKey",
        ),
      ).toBe(`key-${n}`);
    });
    const [protocol] = await db.select().from(hostProtocolAuth);
    expect(
      FieldCrypto.decryptField(
        protocol.password!,
        keys["user-1"],
        protocolAuthRecordId(firstHost, "rdp"),
        "password",
      ),
    ).toBe("rdp-pw");
    const [sharedHost] = await db.select().from(sharedHostSecrets);
    expect(
      FieldCrypto.decryptField(
        sharedHost.encryptedPassword!,
        keys["user-2"],
        sharedHostSecretRecordId(7, "user-2", "ssh"),
        "password",
      ),
    ).toBe("shared-pw");
    const [sharedCred] = await db.select().from(sharedCredentialSecrets);
    expect(
      FieldCrypto.decryptField(
        sharedCred.encryptedPassword!,
        keys["user-2"],
        sharedCredentialSecretRecordId(3, "user-2"),
        "password",
      ),
    ).toBe("cred-pw");

    // The value that did not open is left exactly as it was.
    const locked = allHosts.find((row) => row.userId === "user-3")!;
    expect(FieldCrypto.sealedRecordId(locked.password!)).toBe("temp-1");

    // The backup holds every old value, one line per changed row.
    const lines = fs
      .readFileSync(first.backupFile!, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines.length).toBe(ROWS + ROWS + 3);
    // The first host's password was already right, only its sudo moved.
    expect(lines[0].table).toBe("ssh_data");
    expect(lines[0].values.password).toBeUndefined();
    expect(FieldCrypto.sealedRecordId(lines[0].values.sudoPassword)).toMatch(
      /^temp-/,
    );

    // A second run finds nothing left to move.
    const second = await resealFields({
      tables,
      dataKey,
      backupDir: backupDir!,
    });
    expect(second).toMatchObject({ resealed: 0, pending: 0, backupFile: null });
  }, 600_000);

  it("counts rows whose owner key is not open yet as pending", async () => {
    const context = await seed();
    await context.drizzle.insert(hosts).values({
      userId: "user-1",
      name: "h",
      ip: "10.0.0.1",
      port: 22,
      username: "root",
      authType: "password",
      syncId: "s1",
      password: seal("user-1", "pw", "temp-5", "password"),
    });
    const tables = new FieldResealRepository(context).tables();

    const locked = await resealFields({
      tables,
      dataKey: () => null,
      backupDir: backupDir!,
    });
    expect(locked).toMatchObject({ resealed: 0, pending: 1 });

    const opened = await resealFields({
      tables,
      dataKey: (userId) => keys[userId] ?? null,
      backupDir: backupDir!,
    });
    expect(opened).toMatchObject({ resealed: 1, pending: 0 });
  });

  it("picks up where a run that stopped part way left off", async () => {
    const context = await seed();
    for (let n = 0; n < 3; n++) {
      await context.drizzle.insert(hosts).values({
        userId: "user-1",
        name: `h${n}`,
        ip: "10.0.0.1",
        port: 22,
        username: "root",
        authType: "password",
        syncId: `s${n}`,
        password: seal("user-1", `pw${n}`, `temp-${n}`, "password"),
      });
    }
    const tables = new FieldResealRepository(context).tables();
    const failing = tables.map((table) => ({ ...table }));
    let writes = 0;
    failing[0].update = async (id, values) => {
      if (++writes === 2) throw new Error("power cut");
      await tables[0].update(id, values);
    };
    const dataKey = (userId: string) => keys[userId] ?? null;

    await expect(
      resealFields({ tables: failing, dataKey, backupDir: backupDir! }),
    ).rejects.toThrow("power cut");
    const rest = await resealFields({ tables, dataKey, backupDir: backupDir! });
    expect(rest.resealed).toBe(2);

    const rows = await context.drizzle
      .select()
      .from(hosts)
      .orderBy(asc(hosts.id));
    rows.forEach((row, n) => {
      expect(
        FieldCrypto.decryptField(
          row.password!,
          keys["user-1"],
          String(row.id),
          "password",
        ),
      ).toBe(`pw${n}`);
    });
  });
});
