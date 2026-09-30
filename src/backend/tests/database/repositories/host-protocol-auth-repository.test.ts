import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import {
  HostProtocolAuthRepository,
  decryptProtocolLogin,
  protocolAuthRecordId,
  type HostProtocolLogin,
} from "../../../database/repositories/host-protocol-auth-repository.js";
import { FieldCrypto } from "../../../utils/field-crypto.js";

const ownerKey = crypto.randomBytes(32);
const otherKey = crypto.randomBytes(32);

function login(overrides: Partial<HostProtocolLogin> = {}): HostProtocolLogin {
  return {
    protocol: "spice",
    authType: "direct",
    credentialId: null,
    username: "viewer",
    password: "spice-pass",
    fields: { display: "2" },
    secretFields: { ticket: "t-secret" },
    ...overrides,
  };
}

describe("HostProtocolAuthRepository", () => {
  let adapter: TestSqliteDatabase | null = null;
  let writes = 0;

  afterEach(async () => {
    await adapter?.close();
    adapter = null;
  });

  async function createRepository(): Promise<HostProtocolAuthRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash) VALUES
        ('owner-1', 'owner-1', 'hash'),
        ('owner-2', 'owner-2', 'hash');
      INSERT INTO ssh_credentials (id, user_id, name, username, auth_type) VALUES
        (5, 'owner-1', 'cred-5', 'root', 'password');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type) VALUES
        (42, 'owner-1', 'prod', '10.0.0.42', 22, 'root', 'password'),
        (43, 'owner-1', 'stage', '10.0.0.43', 22, 'root', 'password'),
        (44, 'owner-2', 'other', '10.0.0.44', 22, 'root', 'password');
    `);
    writes = 0;
    return new HostProtocolAuthRepository(context, () => {
      writes++;
    });
  }

  it("round-trips a login with its secrets encrypted at rest", async () => {
    const repository = await createRepository();
    await repository.upsert("owner-1", 42, login(), ownerKey);

    const row = await repository.findRow(42, "spice");
    expect(row).toMatchObject({
      hostId: 42,
      userId: "owner-1",
      protocol: "spice",
      authType: "direct",
      username: "viewer",
      fields: JSON.stringify({ display: "2" }),
    });
    expect(FieldCrypto.isEncrypted(row!.password!)).toBe(true);
    expect(row!.password).not.toContain("spice-pass");
    expect(row!.secretFields).not.toContain("t-secret");
    expect(await repository.find(42, "spice", ownerKey)).toEqual(login());
    expect(writes).toBe(1);
  });

  it("updates in place, one row per host and protocol", async () => {
    const repository = await createRepository();
    await repository.upsert("owner-1", 42, login(), ownerKey);
    await repository.upsert(
      "owner-1",
      42,
      login({ username: "other", password: null, secretFields: {} }),
      ownerKey,
    );

    expect(await repository.listRowsForHost(42)).toHaveLength(1);
    expect(await repository.find(42, "spice", ownerKey)).toMatchObject({
      username: "other",
      password: null,
      secretFields: {},
    });
  });

  it("opens nothing with another user's key", async () => {
    const repository = await createRepository();
    await repository.upsert("owner-1", 42, login(), ownerKey);

    expect(await repository.find(42, "spice", otherKey)).toMatchObject({
      username: "viewer",
      password: null,
      secretFields: {},
    });
  });

  it("treats a tampered secret as missing", async () => {
    const repository = await createRepository();
    await repository.upsert("owner-1", 42, login(), ownerKey);
    const row = (await repository.findRow(42, "spice"))!;
    const envelope = JSON.parse(row.password!);
    envelope.data = envelope.data.replace(/^./, (c: string) =>
      c === "0" ? "1" : "0",
    );

    expect(
      decryptProtocolLogin(
        { ...row, password: JSON.stringify(envelope) },
        ownerKey,
      ).password,
    ).toBeNull();
  });

  it("binds each secret to its host and protocol", async () => {
    const repository = await createRepository();
    await repository.upsert("owner-1", 42, login(), ownerKey);
    const row = (await repository.findRow(42, "spice"))!;

    expect(JSON.parse(row.password!).recordId).toBe(
      protocolAuthRecordId(42, "spice"),
    );
    expect(() =>
      FieldCrypto.decryptField(row.password!, ownerKey, "", "secretFields"),
    ).toThrow();
  });

  it("finds the owner's hosts whose login uses a credential", async () => {
    const repository = await createRepository();
    await repository.upsert(
      "owner-1",
      42,
      login({ authType: "credential", credentialId: 5, password: null }),
      ownerKey,
    );
    await repository.upsert(
      "owner-1",
      43,
      login({ protocol: "x2go" }),
      ownerKey,
    );

    expect(await repository.listHostIdsForCredential("owner-1", 5)).toEqual([
      42,
    ]);
    expect(await repository.listHostIdsForCredential("owner-2", 5)).toEqual([]);
    expect(
      (await repository.listRowsForUser("owner-1"))
        .map((row) => row.hostId)
        .sort(),
    ).toEqual([42, 43]);
  });

  it("deletes one protocol's login", async () => {
    const repository = await createRepository();
    await repository.upsert("owner-1", 42, login(), ownerKey);
    await repository.upsert(
      "owner-1",
      42,
      login({ protocol: "x2go" }),
      ownerKey,
    );

    expect(await repository.delete(42, "spice")).toBe(true);
    expect(await repository.delete(42, "spice")).toBe(false);
    expect(
      (await repository.listRowsForHost(42)).map((row) => row.protocol),
    ).toEqual(["x2go"]);
  });
});
