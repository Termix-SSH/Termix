/**
 * The 2.8 RDP, VNC and Telnet logins move out of the ssh_data columns into
 * host_protocol_auth. Every shape a 2.8 install could hold must come across
 * (encrypted under the column's name, the blob 2.8 copied from `password`,
 * plaintext, credential mode, the pre-protocol-columns hosts), a second run
 * must change nothing, and a login the user removed afterwards must not come
 * back. Runs on SQLite, or on TEST_DIALECT's server.
 */

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestSqliteDatabase } from "../database/repositories/test-support.js";

const state = vi.hoisted(() => ({
  db: null as null | { drizzle: unknown },
  keys: new Map<string, Buffer>(),
}));

vi.mock("../../database/db/index.js", () => ({
  getDb: () => state.db!.drizzle,
  getSqlite: () => null,
}));
vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    triggerSave: vi.fn(),
    forceSave: vi.fn(async () => {}),
  },
}));
vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: {
    getUserDataKey: (userId: string) => state.keys.get(userId) ?? null,
  },
}));

import {
  copiedMarker,
  legacyLogin,
  runProtocolAuthMigration,
} from "../../upgrade/protocol-auth-migration.js";
import { createCurrentHostProtocolAuthRepository } from "../../database/repositories/factory.js";
import { FieldCrypto } from "../../utils/field-crypto.js";

const ownerKey = crypto.randomBytes(32);

let database: TestSqliteDatabase | null = null;

function sealed(value: string, hostId: number, field: string): string {
  return FieldCrypto.encryptField(value, ownerKey, String(hostId), field);
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

beforeEach(async () => {
  database = new TestSqliteDatabase();
  state.db = await database.connect();
  state.keys = new Map([["owner", ownerKey]]);
  await database.exec(`
    INSERT INTO users (id, username, password_hash) VALUES
      ('owner', 'owner', 'x'), ('locked', 'locked', 'x');
    INSERT INTO ssh_credentials (id, user_id, name, username, auth_type) VALUES
      (5, 'owner', 'vnc-cred', 'viewer', 'password');
    INSERT INTO ssh_data (id, user_id, connection_type, name, ip, port, username, auth_type,
      rdp_user, rdp_password, rdp_domain, rdp_auth_type)
      VALUES (1, 'owner', 'ssh', 'win', '10.0.0.1', 22, 'root', 'password',
      'admin', ${quote(sealed("rdp-pass", 1, "rdpPassword"))}, 'CORP', 'direct');
    INSERT INTO ssh_data (id, user_id, connection_type, name, ip, port, username, auth_type,
      vnc_auth_type, vnc_credential_id)
      VALUES (2, 'owner', 'ssh', 'vnc', '10.0.0.2', 22, 'root', 'password', 'credential', 5);
    INSERT INTO ssh_data (id, user_id, connection_type, name, ip, port, username, auth_type,
      telnet_user, telnet_password)
      VALUES (3, 'owner', 'ssh', 'switch', '10.0.0.3', 22, 'root', 'password', 'tu', 'tel-plain');
    INSERT INTO ssh_data (id, user_id, connection_type, name, ip, port, username, password,
      domain, auth_type)
      VALUES (4, 'owner', 'rdp', 'old', '10.0.0.4', 3389, 'old-user',
      ${quote(sealed("old-pass", 4, "password"))}, 'OLDDOM', 'password');
    INSERT INTO ssh_data (id, user_id, connection_type, name, ip, port, username, auth_type,
      rdp_user, rdp_password, rdp_auth_type)
      VALUES (5, 'owner', 'ssh', 'copied', '10.0.0.5', 22, 'root', 'password',
      'copied', ${quote(sealed("copied-pass", 5, "password"))}, 'none');
    INSERT INTO ssh_data (id, user_id, connection_type, name, ip, port, username, auth_type)
      VALUES (6, 'owner', 'ssh', 'plain-ssh', '10.0.0.6', 22, 'root', 'password');
    INSERT INTO ssh_data (id, user_id, connection_type, name, ip, port, username, auth_type,
      rdp_user)
      VALUES (7, 'locked', 'ssh', 'later', '10.0.0.7', 22, 'root', 'password', 'waits');
  `);
});

afterEach(async () => {
  await database?.close();
  database = null;
});

async function logins() {
  const repository = createCurrentHostProtocolAuthRepository();
  const out: Record<string, unknown> = {};
  for (const hostId of [1, 2, 3, 4, 5, 6]) {
    for (const login of await repository.listForHost(hostId, ownerKey)) {
      out[`${hostId}:${login.protocol}`] = login;
    }
  }
  return out;
}

const EXPECTED = {
  "1:rdp": {
    protocol: "rdp",
    authType: "direct",
    credentialId: null,
    username: "admin",
    password: "rdp-pass",
    fields: { domain: "CORP" },
    secretFields: {},
  },
  "2:vnc": {
    protocol: "vnc",
    authType: "credential",
    credentialId: 5,
    username: null,
    password: null,
    fields: {},
    secretFields: {},
  },
  "3:telnet": {
    protocol: "telnet",
    authType: "direct",
    credentialId: null,
    username: "tu",
    password: "tel-plain",
    fields: {},
    secretFields: {},
  },
  "4:rdp": {
    protocol: "rdp",
    authType: "direct",
    credentialId: null,
    username: "old-user",
    password: "old-pass",
    fields: { domain: "OLDDOM" },
    secretFields: {},
  },
  "5:rdp": {
    protocol: "rdp",
    authType: "none",
    credentialId: null,
    username: null,
    password: null,
    fields: {},
    secretFields: {},
  },
};

describe("runProtocolAuthMigration", () => {
  it("copies every 2.8 login shape, and a second run changes nothing", async () => {
    const first = await runProtocolAuthMigration();
    expect(first).toEqual({ copied: 5, pendingUsers: 1 });
    expect(await logins()).toEqual(EXPECTED);

    const second = await runProtocolAuthMigration();
    expect(second).toEqual({ copied: 0, pendingUsers: 1 });
    expect(await logins()).toEqual(EXPECTED);
  });

  it("leaves the legacy columns in place", async () => {
    await runProtocolAuthMigration();
    const [row] = await database!.query<{ rdp_user: string }>(
      sql`SELECT rdp_user FROM ssh_data WHERE id = 1`,
    );
    expect(row.rdp_user).toBe("admin");
  });

  it("does not bring back a login the user removed", async () => {
    await runProtocolAuthMigration();
    await createCurrentHostProtocolAuthRepository().delete(1, "rdp");

    await runProtocolAuthMigration();

    expect(await logins()).not.toHaveProperty("1:rdp");
  });

  it("waits for a locked data key, then copies at that user's login", async () => {
    await runProtocolAuthMigration();
    const repository = createCurrentHostProtocolAuthRepository();
    expect(await repository.listRowsForHost(7)).toEqual([]);

    const lockedKey = crypto.randomBytes(32);
    state.keys.set("locked", lockedKey);
    expect(await runProtocolAuthMigration("locked")).toEqual({
      copied: 1,
      pendingUsers: 0,
    });
    expect(await repository.find(7, "rdp", lockedKey)).toMatchObject({
      username: "waits",
    });
    const [marker] = await database!.query<{ value: string }>(
      sql`SELECT value FROM settings WHERE key = ${copiedMarker("locked")}`,
    );
    expect(marker.value).toBe("done");
  });

  it("skips a host that already has a login, as after a partial run", async () => {
    await createCurrentHostProtocolAuthRepository().upsert(
      "owner",
      1,
      {
        protocol: "rdp",
        authType: "direct",
        credentialId: null,
        username: "edited",
        password: null,
        fields: {},
        secretFields: {},
      },
      ownerKey,
    );

    await runProtocolAuthMigration();

    expect((await logins())["1:rdp"]).toMatchObject({ username: "edited" });
    expect(await logins()).toHaveProperty("3:telnet");
  });
});

describe("legacyLogin rdp domain", () => {
  const rdp = {
    id: "rdp",
    user: "rdp_user",
    password: "rdp_password",
    passwordField: "rdpPassword",
    credential: "rdp_credential_id",
    authType: "rdp_auth_type",
    domain: "rdp_domain",
  };

  it.each([
    { saved: "CORP", legacy: null, expected: { domain: "CORP" } },
    { saved: "CORP", legacy: "OLD", expected: { domain: "CORP" } },
    { saved: "", legacy: "OLD", expected: {} },
    { saved: null, legacy: "LEGACY", expected: { domain: "LEGACY" } },
  ])(
    "keeps saved domain $saved over legacy $legacy for a credential host",
    ({ saved, legacy, expected }) => {
      const login = legacyLogin(
        {
          id: 1,
          user_id: "owner",
          connection_type: "rdp",
          rdp_auth_type: "credential",
          rdp_credential_id: 5,
          rdp_user: null,
          rdp_password: null,
          rdp_domain: saved,
          domain: legacy,
        },
        rdp,
        ownerKey,
        () => true,
      );
      expect(login?.fields).toEqual(expected);
    },
  );
});
