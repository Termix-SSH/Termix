/**
 * A fixture plugin declares a protocol core has never heard of ("spice") and
 * gets a per-host login stored, encrypted, shared with a recipient (and
 * overridden by them) and resolved, with no core change: only the manifest
 * declaration. Runs on a real database with real repositories, sharing
 * manager and override service; only keys, permissions and audit are faked.
 */

import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { TestSqliteDatabase } from "../database/repositories/test-support.js";
import type { DatabaseContext } from "../../database/repositories/database-context.js";

const state = vi.hoisted(() => ({
  db: null as null | { drizzle: unknown },
  keys: new Map<string, Buffer>(),
  levels: new Map<string, string>(),
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
vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: vi.fn(async () => {}),
  getAuditUsername: async (id: string) => id,
  getRequestMeta: () => ({}),
}));
vi.mock("../../utils/data-crypto.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../utils/data-crypto.js")>();
  const DataCrypto = actual.DataCrypto as unknown as Record<string, unknown>;
  DataCrypto.getUserDataKey = (userId: string) =>
    state.keys.get(userId) ?? null;
  DataCrypto.validateUserAccess = (userId: string) => {
    const key = state.keys.get(userId);
    if (!key) throw new Error(`User ${userId} has no data encryption key`);
    return key;
  };
  return actual;
});
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      canAccessHost: async (userId: string, _hostId: number) => {
        const level = state.levels.get(userId);
        return level
          ? { hasAccess: true, isShared: true, permissionLevel: level }
          : { hasAccess: false };
      },
      hasPermission: async () => true,
    }),
  },
}));

import { setHostProtocolSource } from "../../hosts/protocol-auth/registry.js";
import {
  loadProtocolAuthSummaries,
  ProtocolAuthWriteError,
  readProtocolAuthPayload,
  writeProtocolAuth,
} from "../../hosts/protocol-auth/protocol-auth.js";
import { SharedHostSecretsManager } from "../../utils/shared-host-secrets-manager.js";
import { SharedHostAuthOverrideService } from "../../utils/shared-host-auth-override-service.js";
import { createPluginContext, createPluginHandle } from "../../plugins/ctx.js";
import { invalidatePluginPermissionCache } from "../../plugins/permissions.js";
import { runAsActor } from "../../plugins/actor.js";
import { sanitizeHostForRecipient } from "../../database/routes/host-normalizers.js";
import { FieldCrypto } from "../../utils/field-crypto.js";

const HOST_ID = 10;
const GRANT_ID = 1;

const manifest = {
  id: "fixture-spice",
  name: "Fixture Spice",
  version: "1.0.0",
  description: "",
  author: { name: "test" },
  license: "MIT",
  category: "Productivity",
  engine: { termix: ">=2.9.0", api: "1" },
  capabilities: ["credentials:read"],
  contributes: {
    protocols: [
      {
        id: "spice",
        credentialFields: [{ key: "display" }, { key: "ticket", secret: true }],
      },
    ],
  },
} as PluginManifest;

let database: TestSqliteDatabase | null = null;
let context: DatabaseContext;

async function exec(query: string): Promise<void> {
  await context.drizzle.run(sql.raw(query));
}

beforeEach(async () => {
  database = new TestSqliteDatabase("sqlite");
  context = await database.connect();
  state.db = context;
  state.keys = new Map([
    ["owner", crypto.randomBytes(32)],
    ["recipient", crypto.randomBytes(32)],
  ]);
  state.levels = new Map([["recipient", "connect"]]);
  for (const statement of [
    `INSERT INTO users (id, username, password_hash) VALUES
      ('owner', 'owner', 'x'), ('recipient', 'recipient', 'x')`,
    `INSERT INTO ssh_credentials (id, user_id, name, username, password, auth_type)
      VALUES (5, 'recipient', 'mine', 'own-user', 'own-pass', 'password'),
             (6, 'owner', 'owners', 'cred-user', 'cred-pass', 'password')`,
    `INSERT INTO ssh_data (id, user_id, name, ip, port, username, password, auth_type)
      VALUES (${HOST_ID}, 'owner', 'desk', '10.0.0.10', 22, 'root', 'ssh-pass', 'password')`,
    `INSERT INTO host_access (id, host_id, user_id, granted_by, permission_level)
      VALUES (${GRANT_ID}, ${HOST_ID}, 'recipient', 'owner', 'connect')`,
    `INSERT INTO plugins (id, name, version, state, manifest_json)
      VALUES ('fixture-spice', 'Fixture Spice', '1.0.0', 'enabled', '{}')`,
    `INSERT INTO plugin_permission_grants (plugin_id, capability, source)
      VALUES ('fixture-spice', 'credentials:read', 'bundled')`,
  ]) {
    await exec(statement);
  }
  invalidatePluginPermissionCache();
  // What the loader does with every installed manifest.
  setHostProtocolSource(() =>
    manifest.contributes!.protocols!.map((protocol) => ({
      ...protocol,
      pluginId: manifest.id,
      pluginName: manifest.name,
    })),
  );
});

afterEach(async () => {
  setHostProtocolSource(() => []);
  await database?.close();
  database = null;
});

function pluginCtx() {
  return createPluginContext(
    manifest,
    createPluginHandle(manifest.id, { activate: () => {} }),
  );
}

async function storeLogin(): Promise<void> {
  const patch = readProtocolAuthPayload({
    protocolAuth: {
      spice: {
        authType: "direct",
        username: "viewer",
        password: "spice-pass",
        fields: { display: "2", ticket: "t-secret" },
      },
      unknown: { username: "ignored" },
    },
  });
  await writeProtocolAuth("owner", HOST_ID, patch!, { isOwner: true });
}

async function storedRow(): Promise<Record<string, unknown>> {
  const rows = (await context.drizzle.all(
    sql.raw(`SELECT * FROM host_protocol_auth WHERE host_id = ${HOST_ID}`),
  )) as Record<string, unknown>[];
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe("a plugin protocol core does not know", () => {
  it("stores the login encrypted with the owner's key, secrets apart", async () => {
    await storeLogin();
    const row = await storedRow();

    expect(row.protocol).toBe("spice");
    expect(row.username).toBe("viewer");
    expect(JSON.parse(row.fields as string)).toEqual({ display: "2" });
    expect(String(row.password)).not.toContain("spice-pass");
    expect(String(row.secret_fields)).not.toContain("t-secret");
    expect(
      FieldCrypto.decryptField(
        row.password as string,
        state.keys.get("owner")!,
        "",
        "password",
      ),
    ).toBe("spice-pass");
    expect(() =>
      FieldCrypto.decryptField(
        row.password as string,
        state.keys.get("recipient")!,
        "",
        "password",
      ),
    ).toThrow();

    const summaries = await loadProtocolAuthSummaries([{ id: HOST_ID }]);
    expect(summaries.get(HOST_ID)).toEqual({
      spice: {
        authType: "direct",
        credentialId: null,
        username: "viewer",
        fields: { display: "2" },
        hasPassword: true,
        secretFieldKeys: ["ticket"],
      },
    });
  });

  it("resolves the owner's login for the declaring plugin", async () => {
    await storeLogin();
    const target = await runAsActor("owner", "request", () =>
      pluginCtx().credentials.resolveHostProtocol(HOST_ID, "spice"),
    );
    expect(target?.shared).toBe(false);
    expect(target?.auth).toEqual({
      authType: "direct",
      username: "viewer",
      password: "spice-pass",
      fields: { display: "2", ticket: "t-secret" },
    });
  });

  it("treats a tampered password as missing, never as a value", async () => {
    await storeLogin();
    const row = await storedRow();
    const envelope = JSON.parse(row.password as string);
    envelope.tag = "0".repeat(envelope.tag.length);
    await exec(
      `UPDATE host_protocol_auth SET password = '${JSON.stringify(envelope)}' WHERE host_id = ${HOST_ID}`,
    );

    const target = await runAsActor("owner", "request", () =>
      pluginCtx().credentials.resolveHostProtocol(HOST_ID, "spice"),
    );
    expect(target?.auth.password).toBe("");
    expect(target?.auth.fields.ticket).toBe("t-secret");
  });

  it("gives a recipient the shared snapshot, not the owner's secret", async () => {
    await storeLogin();
    await SharedHostSecretsManager.getInstance().snapshotForUser(
      GRANT_ID,
      HOST_ID,
      "recipient",
      "owner",
    );
    // The owner's row loses its password without a resync: the recipient
    // keeps reading their own copy, never the owner's row.
    await exec(
      `UPDATE host_protocol_auth SET password = NULL WHERE host_id = ${HOST_ID}`,
    );

    const target = await runAsActor("recipient", "request", () =>
      pluginCtx().credentials.resolveHostProtocol(HOST_ID, "spice"),
    );
    expect(target?.shared).toBe(true);
    expect(target?.auth).toEqual({
      authType: "direct",
      username: "viewer",
      password: "spice-pass",
      fields: { display: "2", ticket: "t-secret" },
    });
  });

  it("uses the recipient's own override over the shared snapshot", async () => {
    await storeLogin();
    await SharedHostSecretsManager.getInstance().snapshotForUser(
      GRANT_ID,
      HOST_ID,
      "recipient",
      "owner",
    );
    await SharedHostAuthOverrideService.getInstance().setCredentialId(
      HOST_ID,
      "recipient",
      "spice",
      5,
    );

    const target = await runAsActor("recipient", "request", () =>
      pluginCtx().credentials.resolveHostProtocol(HOST_ID, "spice"),
    );
    expect(target?.auth).toEqual({
      authType: "credential",
      username: "own-user",
      password: "own-pass",
      // The owner's plain fields, never their secret ones.
      fields: { display: "2", ticket: "" },
    });
  });

  it("refuses an override for a protocol nobody declares", async () => {
    await expect(
      SharedHostAuthOverrideService.getInstance().setCredentialId(
        HOST_ID,
        "recipient",
        "made-up",
        5,
      ),
    ).rejects.toThrow(/No plugin declares/);
  });

  it("follows a credential the owner points the login at", async () => {
    const patch = readProtocolAuthPayload({
      protocolAuth: { spice: { authType: "credential", credentialId: 6 } },
    });
    await writeProtocolAuth("owner", HOST_ID, patch!, { isOwner: true });

    const target = await runAsActor("owner", "request", () =>
      pluginCtx().credentials.resolveHostProtocol(HOST_ID, "spice"),
    );
    expect(target?.auth).toMatchObject({
      authType: "credential",
      username: "cred-user",
      password: "cred-pass",
    });
  });

  it("lets a shared editor change the login but not its credential", async () => {
    await storeLogin();
    const rename = readProtocolAuthPayload({
      protocolAuth: { spice: { username: "renamed", password: "" } },
    });
    await writeProtocolAuth("owner", HOST_ID, rename!, { isOwner: false });
    expect((await storedRow()).username).toBe("renamed");
    // An empty password from an editor who cannot see it keeps it.
    const target = await runAsActor("owner", "request", () =>
      pluginCtx().credentials.resolveHostProtocol(HOST_ID, "spice"),
    );
    expect(target?.auth.password).toBe("spice-pass");

    const repoint = readProtocolAuthPayload({
      protocolAuth: { spice: { authType: "credential", credentialId: 6 } },
    });
    await expect(
      writeProtocolAuth("owner", HOST_ID, repoint!, { isOwner: false }),
    ).rejects.toBeInstanceOf(ProtocolAuthWriteError);
    const remove = readProtocolAuthPayload({ protocolAuth: { spice: null } });
    await writeProtocolAuth("owner", HOST_ID, remove!, { isOwner: false });
    expect(
      (await context.drizzle.all(
        sql.raw(`SELECT id FROM host_protocol_auth`),
      )) as unknown[],
    ).toHaveLength(0);
  });

  it("shows each share level only what it may see", async () => {
    await storeLogin();
    const summaries = await loadProtocolAuthSummaries([{ id: HOST_ID }]);
    const host = {
      id: HOST_ID,
      name: "desk",
      ip: "10.0.0.10",
      protocolAuth: summaries.get(HOST_ID),
    };

    expect(
      sanitizeHostForRecipient({ ...host }, "connect").protocolAuth,
    ).toEqual({ spice: { authType: "direct" } });
    for (const level of ["view", "edit", "manage"]) {
      expect(
        sanitizeHostForRecipient({ ...host }, level).protocolAuth,
        level,
      ).toEqual({
        spice: {
          authType: "direct",
          credentialId: null,
          username: "viewer",
          fields: { display: "2" },
        },
      });
    }
  });
});
