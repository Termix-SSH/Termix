/**
 * The 2.8 to 2.9.0 upgrade, end to end. The committed 2.8 install in
 * fixtures/upgrade boots through the pre-upgrade backup, core's migrations,
 * every built plugin's migrations and the data moves, and everything it held
 * reads back through the plugins' routes, their settings and their ctx. Then
 * the same data directory boots again and nothing changes.
 *
 * TEST_DIALECT=postgres|mysql with TEST_DATABASE_URL runs it against a real
 * server instead (scripts/upgrade-check.sh sets that up).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LEGACY_TABLE_OWNERS } from "@termix/plugin-sdk/db";
import {
  assertPluginsBuilt,
  bootCore,
  BUILT_PLUGINS_DIR,
  UPGRADE_FIXTURE_DIR,
  type BootedCore,
} from "./built-harness.js";
import { remoteTestDialect } from "./remote-seed.js";
import {
  FIXTURE_PASSWORD,
  HOST_AUTH_TYPES,
  HOSTS,
  LDAP_PROVIDER_ID,
  OPERATORS_PERMISSIONS,
  ROWS,
  SSO_PROVIDER_ID,
  SYNCED_ENTITY_TYPES_28,
  TOTP_BACKUP_CODES,
  TOTP_SECRET,
  USER_ROLE_PERMISSIONS_28,
  USERS,
} from "../fixtures/upgrade/rows.js";

const BOOT_TIMEOUT = 240_000;

type UserKey = keyof typeof USERS;

interface Booted {
  core: BootedCore;
  app: express.Express;
  tokens: Record<UserKey, string>;
  errors: string[];
}

/** legacy table -> the p_ table its plugin renamed it to. */
function adoptedNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const id of new Set(Object.values(LEGACY_TABLE_OWNERS))) {
    const dir = path.join(BUILT_PLUGINS_DIR, id, "migrations", "sqlite");
    for (const file of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      for (const match of text.matchAll(
        /ALTER TABLE "([a-z0-9_]+)" RENAME TO "(p_[a-z0-9_]+)"/g,
      )) {
        names.set(match[1], match[2]);
      }
    }
  }
  return names;
}

async function boot(dataDir?: string): Promise<Booted> {
  vi.resetModules();
  const errors: string[] = [];
  const error = vi.spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args.map(String).join(" "));
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  let core: BootedCore;
  try {
    core = await bootCore(
      dataDir ? { reuseDataDir: dataDir } : { fixtureDir: UPGRADE_FIXTURE_DIR },
    );
  } finally {
    error.mockRestore();
    warn.mockRestore();
  }

  const { AuthManager } = await import("../../utils/auth-manager.js");
  const auth = AuthManager.getInstance();
  const tokens = {} as Record<UserKey, string>;
  for (const [key, userId] of Object.entries(USERS)) {
    await auth.unlockWithSystemKey(userId);
    tokens[key as UserKey] = await auth.generateJWTToken(userId, {
      deviceType: "web",
      deviceInfo: "upgrade test",
    });
  }

  const { mountPluginApi } =
    await import("../../database/routes/plugin-api-routes.js");
  const { default: pluginRoutes } =
    await import("../../database/routes/plugins.js");
  const { default: userRoutes } =
    await import("../../database/routes/users.js");
  const app = express();
  app.use(express.json());
  app.use("/users", userRoutes);
  app.use("/plugins", pluginRoutes);
  mountPluginApi(app);

  return { core, app, tokens, errors };
}

function get(booted: Booted, url: string, as: UserKey = "admin") {
  return request(booted.app)
    .get(url)
    .set("Authorization", `Bearer ${booted.tokens[as]}`);
}

async function settings(
  booted: Booted,
  pluginId: string,
  scope: string,
  as: UserKey = "admin",
): Promise<Record<string, unknown>> {
  const response = await get(
    booted,
    `/plugins/${pluginId}/settings/${scope}`,
    as,
  );
  expect(response.status, `${pluginId} ${scope} settings`).toBe(200);
  return response.body.values as Record<string, unknown>;
}

/** A ctx for a running plugin, the one its own code gets. */
async function pluginCtx(pluginId: string) {
  const { getPluginRuntime } = await import("../../plugins/index.js");
  const { createPluginContext } = await import("../../plugins/ctx.js");
  const loaded = getPluginRuntime().loader.get(pluginId);
  if (!loaded?.handle) throw new Error(`${pluginId} is not running`);
  return createPluginContext(loaded.manifest, loaded.handle);
}

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const { runAsActor } = await import("../../plugins/actor.js");
  return runAsActor(userId, "asUser", fn);
}

/** Every row of a plugin table, read through that plugin's ctx.db. */
async function pluginRows(
  pluginId: string,
  table: string,
): Promise<Array<Record<string, unknown>>> {
  const ctx = await pluginCtx(pluginId);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const client = await ctx.db.client<any>();
  const query = sql`SELECT * FROM ${sql.identifier(table)}`;
  if (typeof client.all === "function") return client.all(query);
  const result = await client.execute(query);
  return Array.isArray(result) ? result[0] : result.rows;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Bookkeeping counts, compared between the first and second boot. */
async function counts(): Promise<Record<string, number>> {
  const { selectRows } =
    await import("../../utils/crypto-migration/raw-rows.js");
  const out: Record<string, number> = {};
  const tables = [
    "plugin_migrations",
    "plugin_settings",
    "user_second_factors",
    "user_external_identities",
    "roles",
    "user_roles",
    "ssh_data",
    ...adoptedNames().values(),
  ];
  for (const table of tables) {
    const [row] = await selectRows<{ n: number | string }>(
      sql`SELECT COUNT(*) AS n FROM ${sql.identifier(table)}`,
    );
    out[table] = Number(row.n);
  }
  return out;
}

function totpCode(secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "")) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(
    bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
}

/** Everything a 2.8 install had, checked against a booted 2.9.0. */
function upgradeChecks(current: () => Booted, bootIndex: number) {
  it("boots without logging an error", () => {
    expect(current().errors).toEqual([]);
  });

  it("activates every plugin", async () => {
    const { getPluginRuntime } = await import("../../plugins/index.js");
    const notActive = getPluginRuntime()
      .loader.list()
      .filter((plugin) => plugin.state !== "active")
      .map((plugin) => `${plugin.id}: ${plugin.state} ${plugin.lastError}`);
    expect(notActive).toEqual([]);
  });

  it("keeps every row of every adopted table, readable by its plugin", async () => {
    const names = adoptedNames();
    for (const [legacy, pluginId] of Object.entries(LEGACY_TABLE_OWNERS)) {
      const seeded = ROWS[legacy] ?? [];
      expect(seeded.length, `the fixture fills ${legacy}`).toBeGreaterThan(0);
      const table = names.get(legacy);
      expect(table, `${pluginId} adopts ${legacy}`).toBeDefined();
      // 2.8 kept LDAP directories in sso_providers; the ldap plugin takes them.
      const expected =
        legacy === "sso_providers"
          ? seeded.filter((row) => row.type !== "ldap")
          : seeded;
      const rows = await pluginRows(pluginId, table!);
      const ids = rows.map((row) => String(row.id)).sort();
      expect(ids, `${legacy} -> ${table}`).toEqual(
        expected.map((row) => String(row.id)).sort(),
      );
    }
    const ldap = await pluginRows("ldap", "p_ldap_providers");
    expect(ldap.map((row) => String(row.id))).toEqual([
      String(LDAP_PROVIDER_ID),
    ]);
  });

  it("reads the adopted rows back through each plugin's routes", async () => {
    const checks: Array<[string, string, UserKey?]> = [
      ["/plugin-api/snippets/", "d4-snippet"],
      ["/plugin-api/snippets/shared", "d4-shared-snippet", "alice"],
      ["/plugin-api/fleets/", "d4-fleet"],
      ["/plugin-api/workspaces/", "d4-workspace"],
      ["/plugin-api/network-topology/", "d4-node"],
      ["/plugin-api/automations/", "d4-automation"],
      ["/plugin-api/homepage/items", "d4-widget"],
      ["/plugin-api/homepage/service-links", "d4-link"],
      ["/plugin-api/vault/profiles", "d4-vault"],
      ["/plugin-api/termix-identity/me", "d4-handle"],
      ["/plugin-api/sso/providers", "d4-sso"],
      ["/plugin-api/ldap/providers", "d4-ldap"],
      [
        `/plugin-api/ssh-terminal/command-history/${HOSTS.password}`,
        "d4-history-command",
      ],
      ["/plugin-api/tunnels/presets", "d4-preset"],
      ["/plugin-api/ai/providers", "d4-provider"],
      ["/plugin-api/ai/conversations/1", "d4-message"],
      ["/plugin-api/secret-sources", "d4-source"],
      ["/plugin-api/session-sharing/rooms", "d4-room"],
      ["/plugin-api/webauthn/credentials", "d4-passkey", "passkey"],
      ["/plugin-api/alerts/channels", "d4-channel"],
    ];
    const failures: string[] = [];
    for (const [url, marker, as] of checks) {
      const response = await get(current(), url, as);
      if (
        response.status !== 200 ||
        !JSON.stringify(response.body).includes(marker)
      ) {
        failures.push(
          `${url} -> ${response.status} ${JSON.stringify(response.body).slice(0, 200)}`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it("moves every host flag into its plugin's host settings", async () => {
    const booted = current();
    const host = (id: string) => settings(booted, id, `host/${HOSTS.password}`);
    expect(await host("ssh-terminal")).toMatchObject({
      enableTerminal: true,
      enableCommandHistory: false,
      enableTerminalToolbar: false,
    });
    expect(await host("session-recording")).toMatchObject({
      enableSessionRecording: false,
    });
    expect(await host("session-sharing")).toMatchObject({
      allowSessionSharing: false,
    });
    expect(await host("file-manager")).toMatchObject({
      enableFileManager: false,
      defaultPath: "/srv/d4",
      scpLegacy: true,
    });
    const tunnels = await host("tunnels");
    expect(tunnels.enableTunnel).toBe(true);
    expect(JSON.stringify(tunnels.tunnelConnections)).toContain("8080");
    const web = await host("web-endpoint");
    expect(web.enableWebUi).toBe(true);
    expect(JSON.stringify(web.webUiConfig)).toContain("d4-grafana");
    expect(await host("tmux-monitor")).toMatchObject({
      enableTmuxMonitor: true,
    });
    expect(await host("docker")).toMatchObject({
      enableDocker: true,
      containerRuntime: "podman",
    });
    expect(await host("ai")).toMatchObject({ enableAiAssistant: true });
    expect(await host("wake-on-lan")).toMatchObject({
      macAddress: "AA:BB:CC:DD:EE:04",
      broadcastAddress: "10.4.0.255",
    });
    expect(await host("host-metrics")).toMatchObject({
      metricsEnabled: false,
      metricsInterval: 45,
      enabledWidgets: ["cpu", "memory"],
    });

    const proxmox = await settings(booted, "proxmox", `host/${HOSTS.key}`);
    expect(proxmox.enableProxmox).toBe(true);
    expect(JSON.stringify(proxmox)).toContain("pve.d4.example");

    expect(
      await settings(booted, "remote-desktop", `host/${HOSTS.desktop}`),
    ).toMatchObject({
      enableRdp: true,
      enableVnc: true,
      enableTelnet: true,
      rdpPort: 3390,
      vncPort: 5901,
      telnetPort: 2323,
    });
    expect(
      await settings(booted, "remote-desktop", `host/${HOSTS.rdpOnly}`),
    ).toMatchObject({ enableRdp: true });

    expect(
      await settings(booted, "vault", `host/${HOSTS.vault}`),
    ).toMatchObject({ profileId: 1 });
    expect(
      await settings(booted, "warpgate", `host/${HOSTS.warpgate}`),
    ).toMatchObject({ useWarpgate: true });
  });

  it("keeps 2.8's defaults on a host that never changed them", async () => {
    const booted = current();
    const host = (id: string) => settings(booted, id, `host/${HOSTS.plain}`);
    expect(await host("file-manager")).toMatchObject({
      enableFileManager: true,
    });
    expect(await host("ssh-terminal")).toMatchObject({
      enableTerminal: true,
      enableCommandHistory: true,
      enableTerminalToolbar: true,
    });
    expect(await host("session-recording")).toMatchObject({
      enableSessionRecording: true,
    });
    expect(await host("session-sharing")).toMatchObject({
      allowSessionSharing: true,
    });
    expect(await host("docker")).toMatchObject({ enableDocker: false });
    expect(await host("tmux-monitor")).toMatchObject({
      enableTmuxMonitor: false,
    });
  });

  it("keeps each host's connection and secrets", async () => {
    const { selectRows } =
      await import("../../utils/crypto-migration/raw-rows.js");
    const hosts = await selectRows<{
      id: number;
      auth_type: string;
      enable_ssh: unknown;
    }>(sql`SELECT id, auth_type, enable_ssh FROM ssh_data ORDER BY id`);
    const byId = new Map(hosts.map((row) => [row.id, row]));
    for (const [id, authType] of Object.entries(HOST_AUTH_TYPES)) {
      // Warpgate became a plugin setting on a host with no SSH auth of its own.
      const want = authType === "warpgate" ? "none" : authType;
      expect(byId.get(Number(id))?.auth_type, `host ${id}`).toBe(want);
    }
    expect(Number(byId.get(HOSTS.rdpOnly)?.enable_ssh)).toBe(0);

    const ctx = await pluginCtx("remote-desktop");
    const target = await asUser(USERS.admin, () =>
      ctx.credentials.resolveHostProtocol(HOSTS.rdpOnly, "rdp"),
    );
    expect(target?.auth.password).toBe("d4-rdp-password");
  });

  it("registers an SSH auth provider for every 2.8 auth type", async () => {
    const { listSshAuthProviders } =
      await import("../../hosts/connect/auth-provider-registry.js");
    const types = new Set(listSshAuthProviders().map((p) => p.type));
    for (const authType of new Set(Object.values(HOST_AUTH_TYPES))) {
      if (authType === "warpgate") continue;
      expect(types, authType).toContain(authType);
    }
  });

  it("plays back every 2.8 recording", async () => {
    const booted = current();
    const list = await get(booted, "/plugin-api/session-recording/");
    expect(
      (list.body.logs as Array<{ id: number }>).map((log) => log.id).sort(),
    ).toEqual([1, 2]);
    for (const [id, kind] of [
      [1, "ssh"],
      [2, "rdp"],
    ] as const) {
      const content = await get(
        booted,
        `/plugin-api/session-recording/${id}/content`,
      )
        .buffer(true)
        .parse((res, done) => {
          let text = "";
          res.on("data", (chunk: Buffer) => (text += chunk.toString()));
          res.on("end", () => done(null, text));
        });
      expect(content.status, `recording ${id}`).toBe(200);
      expect(content.body).toContain(`d4 ${kind} recording`);
    }
  });

  it("puts every moved setting in its plugin's admin and user scope", async () => {
    const booted = current();
    expect(await settings(booted, "ssh-terminal", "admin")).toMatchObject({
      sessionTimeoutMinutes: 45,
      sessionPersistence: false,
      commandHistoryForNewHosts: false,
      imageMaxCount: 7,
    });
    expect(await settings(booted, "step-ca", "admin")).toMatchObject({
      caUrl: "https://ca.d4.example",
      fingerprint: "d4fingerprint",
      provisioner: "d4-provisioner",
    });
    expect(await settings(booted, "remote-desktop", "admin")).toMatchObject({
      enabled: true,
      guacdUrl: "guacd.d4.example:4822",
    });
    expect(await settings(booted, "host-metrics", "admin")).toMatchObject({
      metricsInterval: 40,
      historyRetentionDays: 14,
      enabledForNewHosts: false,
    });
    expect(await settings(booted, "ai", "admin")).toMatchObject({
      globallyEnabled: true,
    });
    expect(await settings(booted, "session-recording", "admin")).toMatchObject({
      retentionDays: 3650,
    });
    expect(
      JSON.stringify((await settings(booted, "ai", "admin")).privateEndpoints),
    ).toContain("10.4.0.0/24");
    expect(await settings(booted, "session-sharing", "admin")).toMatchObject({
      globallyEnabled: false,
    });
    expect(await settings(booted, "acme-ssl", "admin")).toMatchObject({
      domain: "termix.d4.example",
      email: "d4@example.com",
    });
    expect(await settings(booted, "tailscale", "admin")).toMatchObject({
      apiBaseUrl: "https://headscale.d4.example",
    });
    expect(await settings(booted, "ai", "user")).toMatchObject({
      enabled: true,
      allowReadOnlyCommands: true,
    });
    expect(await settings(booted, "remote-desktop", "user")).toMatchObject({
      colorDepth: "16",
      resizeMethod: "reconnect",
      enableDrive: "on",
    });
  });

  it("keeps every secret readable by the plugin that owns it", async () => {
    const tailscale = await pluginCtx("tailscale");
    expect(await tailscale.settings.get("apiKey")).toBe("tskey-d4");
    const acme = await pluginCtx("acme-ssl");
    expect(JSON.stringify(await acme.settings.getAll("admin"))).toContain(
      "d4-cloudflare-token",
    );
    const ai = await pluginCtx("ai");
    expect(await asUser(USERS.admin, () => ai.secrets.get("provider:1"))).toBe(
      "sk-d4-provider-key",
    );
    const sources = await pluginCtx("secret-sources");
    expect(
      await asUser(USERS.admin, () => sources.secrets.get("source:d4-source")),
    ).toBe("d4-source-token");
  });

  it("moves every notification channel into alerts, config readable", async () => {
    const response = await get(current(), "/plugin-api/alerts/channels/1");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: "d4-channel",
      type: "ntfy",
      usable: true,
      config: { url: "https://ntfy.d4.example/d4" },
    });
  });

  it("keeps every role's permissions", async () => {
    const { PermissionManager } =
      await import("../../utils/permission-manager.js");
    const permissions = PermissionManager.getInstance();
    for (const permission of OPERATORS_PERMISSIONS) {
      expect(
        await permissions.hasPermission(USERS.alice, permission),
        `operators: ${permission}`,
      ).toBe(true);
    }
    for (const permission of USER_ROLE_PERMISSIONS_28) {
      expect(
        await permissions.hasPermission(USERS.passkey, permission),
        `user: ${permission}`,
      ).toBe(true);
    }
    expect(await permissions.hasPermission(USERS.admin, "sso.manage")).toBe(
      true,
    );
  });

  it("still asks a 2.8 TOTP user for a code, and accepts one", async () => {
    const booted = current();
    const login = await request(booted.app)
      .post("/users/login")
      .send({ username: "d4-totp", password: FIXTURE_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.requires_totp).toBe(true);
    expect(JSON.stringify(login.body.second_factors)).toContain("totp");

    const wrong = await request(booted.app)
      .post("/users/totp/verify-login")
      .send({ temp_token: login.body.temp_token, totp_code: "000000" });
    expect(wrong.status).not.toBe(200);

    const verify = await request(booted.app)
      .post("/users/totp/verify-login")
      .send({
        temp_token: login.body.temp_token,
        totp_code: totpCode(TOTP_SECRET),
      });
    expect(verify.status).toBe(200);

    const again = await request(booted.app)
      .post("/users/login")
      .send({ username: "d4-totp", password: FIXTURE_PASSWORD });
    const backup = await request(booted.app)
      .post("/users/totp/verify-login")
      .send({
        temp_token: again.body.temp_token,
        totp_code: TOTP_BACKUP_CODES[bootIndex],
      });
    expect(backup.status).toBe(200);
  });

  it("signs a password user without a second factor straight in", async () => {
    const login = await request(current().app)
      .post("/users/login")
      .send({ username: "d4-alice", password: FIXTURE_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.requires_totp).toBeFalsy();
  });

  it("links SSO and LDAP users to their providers", async () => {
    const { selectRows } =
      await import("../../utils/crypto-migration/raw-rows.js");
    const links = await selectRows<{
      user_id: string;
      provider_id: unknown;
    }>(sql`SELECT user_id, provider_id FROM user_external_identities`);
    const byUser = new Map(
      links.map((row) => [row.user_id, String(row.provider_id)]),
    );
    expect(byUser.get(USERS.sso)).toBe(String(SSO_PROVIDER_ID));
    // The ldap plugin signs in with "ldap:<provider>".
    expect(byUser.get(USERS.ldap)).toBe(`ldap:${LDAP_PROVIDER_ID}`);
  });

  it("syncs every entity type 2.8 synced, under the same name", async () => {
    const { listEntityTypes } = await import("../../plugins/sync-registry.js");
    const { registerCoreSyncEntities } = await import("../../sync/entities.js");
    registerCoreSyncEntities();
    const known = new Set(listEntityTypes());
    for (const type of SYNCED_ENTITY_TYPES_28) {
      expect(known, type).toContain(type);
    }

    const snippets = await pluginRows("snippets", "p_snippets_snippets");
    expect(snippets.map((row) => row.sync_id)).toContain("d4-sync-snippet");
    const vault = await pluginRows("vault", "p_vault_profiles");
    expect(vault.map((row) => row.sync_id)).toContain("d4-sync-vault");
  });
}

let first: Booted;
let firstCounts: Record<string, number>;
let second: Booted;

beforeAll(async () => {
  assertPluginsBuilt();
  first = await boot();
}, BOOT_TIMEOUT);

afterAll(async () => {
  await (second ?? first)?.core.shutdown();
}, BOOT_TIMEOUT);

describe("a 2.8 install upgraded to 2.9.0", () => {
  // Only SQLite is backed up by Termix; a server database is the operator's.
  it.skipIf(remoteTestDialect())(
    "backed up the 2.8 database before anything touched it",
    async () => {
      const backups = path.join(first.core.dataDir, "backups");
      const dirs = fs
        .readdirSync(backups)
        .filter((name) => name.startsWith("pre-plugin-runtime-"));
      expect(dirs).toHaveLength(1);
      const copy = fs.readFileSync(path.join(backups, dirs[0], "db.sqlite"));
      expect(copy.equals(first.core.seed!)).toBe(true);
    },
  );

  upgradeChecks(() => first, 0);
});

describe("booting the upgraded install again", () => {
  beforeAll(async () => {
    firstCounts = await counts();
    const dataDir = first.core.dataDir;
    await first.core.shutdown({ keepDataDir: true });
    second = await boot(dataDir);
  }, BOOT_TIMEOUT);

  it("changes nothing", async () => {
    expect(await counts()).toEqual(firstCounts);
  });

  it.skipIf(remoteTestDialect())("takes no second backup", () => {
    const backups = fs.readdirSync(path.join(second.core.dataDir, "backups"));
    expect(
      backups.filter((name) => name.startsWith("pre-plugin-runtime-")),
    ).toHaveLength(1);
  });

  upgradeChecks(() => second, 1);
});
