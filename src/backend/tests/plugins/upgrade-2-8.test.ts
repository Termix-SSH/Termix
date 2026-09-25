/**
 * The quick upgrade check: a 2.8 database with rows in the tables plugins
 * adopt, host columns plugins took over and settings keys they moved boots
 * into 2.9.0, and the data reads back through the plugins' own APIs.
 */

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  assertPluginsBuilt,
  bootCore,
  create28Database,
  type BootedCore,
} from "./built-harness.js";

const BOOT_TIMEOUT = 180_000;
const USER = "user-upgrade";

let core: BootedCore;
let app: express.Express;
let token: string;
const ids: Record<string, number> = {};

function seed() {
  const { sqlite, insert } = create28Database();
  insert("users", {
    id: USER,
    username: "admin",
    password_hash: "not-a-real-hash",
    is_admin: 1,
  });

  // A host that changed every plugin-owned switch away from its default...
  ids.custom = insert("ssh_data", {
    user_id: USER,
    name: "custom",
    ip: "10.0.0.1",
    port: 22,
    username: "root",
    auth_type: "password",
    enable_terminal: 1,
    enable_command_history: 0,
    enable_terminal_toolbar: 0,
    enable_session_logging: 0,
    allow_session_sharing: 0,
    enable_file_manager: 0,
    default_path: "/srv/data",
    scp_legacy: 1,
    enable_tunnel: 1,
    tunnel_connections: [
      {
        sourcePort: 8080,
        endpointPort: 80,
        endpointHost: "custom",
        autoStart: false,
      },
    ],
    enable_web_ui: 1,
    web_ui_config: {
      endpoints: [
        { id: "grafana", label: "Grafana", port: 3000, protocol: "http" },
      ],
    },
    enable_tmux_monitor: 1,
    enable_docker: 1,
  });
  // ...and one that never touched them, which must keep 2.8's defaults.
  ids.plain = insert("ssh_data", {
    user_id: USER,
    name: "plain",
    ip: "10.0.0.2",
    port: 22,
    username: "root",
    auth_type: "password",
  });

  insert("snippets", {
    user_id: USER,
    name: "upgrade-snippet",
    content: "uptime",
  });
  insert("fleets", { user_id: USER, name: "upgrade-fleet" });
  insert("user_workspaces", {
    user_id: USER,
    name: "upgrade-workspace",
    payload: {},
  });
  insert("network_topology", {
    user_id: USER,
    topology: { nodes: [{ id: "upgrade-node" }], edges: [] },
  });
  insert("automations", {
    user_id: USER,
    name: "upgrade-automation",
    enabled: 0,
    definition: {
      version: 1,
      trigger: { type: "manual" },
      steps: [],
    },
  });
  insert("homepage_items", {
    user_id: USER,
    type_id: "clock",
    title: "upgrade-widget",
    config: {},
  });
  insert("vault_profiles", {
    user_id: USER,
    name: "upgrade-vault",
    vault_addr: "https://vault.example.com",
    ssh_role: "admin",
  });
  insert("termix_identities", { user_id: USER, handle: "upgrade-handle" });
  insert("sso_providers", {
    name: "upgrade-sso",
    type: "oidc",
    config: {
      issuerUrl: "https://id.example.com",
      clientId: "termix",
      clientSecret: "secret",
    },
  });

  insert("settings", { key: "terminal_session_timeout_minutes", value: "45" });
  insert("settings", { key: "step_ca_url", value: "https://ca.example.com" });
  return sqlite;
}

beforeAll(async () => {
  assertPluginsBuilt();
  vi.resetModules();
  core = await bootCore(seed());

  const { AuthManager } = await import("../../utils/auth-manager.js");
  const auth = AuthManager.getInstance();
  await auth.registerUser(USER);
  await auth.unlockWithSystemKey(USER);
  token = await auth.generateJWTToken(USER, {
    deviceType: "web",
    deviceInfo: "upgrade test",
  });

  const { mountPluginApi } =
    await import("../../database/routes/plugin-api-routes.js");
  const { default: pluginRoutes } =
    await import("../../database/routes/plugins.js");
  app = express();
  app.use(express.json());
  app.use("/plugins", pluginRoutes);
  mountPluginApi(app);
}, BOOT_TIMEOUT);

afterAll(async () => {
  await core?.shutdown();
}, BOOT_TIMEOUT);

function get(path: string) {
  return request(app).get(path).set("Authorization", `Bearer ${token}`);
}

async function hostSettings(pluginId: string, hostId: number) {
  const response = await get(`/plugins/${pluginId}/settings/host/${hostId}`);
  expect(response.status, `${pluginId} host settings`).toBe(200);
  return response.body.values as Record<string, unknown>;
}

describe("upgrading a 2.8 database", () => {
  it("renames every adopted table the 2.8 schema had", () => {
    const tables = new Set(
      (
        core.sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name),
    );
    for (const legacy of [
      "snippets",
      "fleets",
      "user_workspaces",
      "network_topology",
      "automations",
      "homepage_items",
      "vault_profiles",
      "termix_identities",
      "sso_providers",
    ]) {
      expect(tables.has(legacy), `${legacy} was adopted`).toBe(false);
    }
  });

  it("reads the adopted rows back through each plugin's routes", async () => {
    const checks: Array<[string, string]> = [
      ["/plugin-api/snippets/", "upgrade-snippet"],
      ["/plugin-api/fleets/", "upgrade-fleet"],
      ["/plugin-api/workspaces/", "upgrade-workspace"],
      ["/plugin-api/network-topology/", "upgrade-node"],
      ["/plugin-api/automations/", "upgrade-automation"],
      ["/plugin-api/homepage/items", "upgrade-widget"],
      ["/plugin-api/vault/profiles", "upgrade-vault"],
      ["/plugin-api/termix-identity/me", "upgrade-handle"],
      ["/plugin-api/sso/providers", "upgrade-sso"],
    ];
    for (const [path, marker] of checks) {
      const response = await get(path);
      expect(response.status, path).toBe(200);
      expect(JSON.stringify(response.body), path).toContain(marker);
    }
  });

  it("moves every changed host switch into its plugin's host settings", async () => {
    expect(await hostSettings("ssh-terminal", ids.custom)).toMatchObject({
      enableTerminal: true,
      enableCommandHistory: false,
      enableTerminalToolbar: false,
    });
    expect(await hostSettings("session-recording", ids.custom)).toMatchObject({
      enableSessionRecording: false,
    });
    expect(await hostSettings("session-sharing", ids.custom)).toMatchObject({
      allowSessionSharing: false,
    });
    expect(await hostSettings("file-manager", ids.custom)).toMatchObject({
      enableFileManager: false,
      defaultPath: "/srv/data",
      scpLegacy: true,
    });
    const tunnels = await hostSettings("tunnels", ids.custom);
    expect(tunnels.enableTunnel).toBe(true);
    expect(JSON.stringify(tunnels.tunnelConnections)).toContain("8080");
    const web = await hostSettings("web-endpoint", ids.custom);
    expect(web.enableWebUi).toBe(true);
    expect(JSON.stringify(web.webUiConfig)).toContain("Grafana");
    expect(await hostSettings("tmux-monitor", ids.custom)).toMatchObject({
      enableTmuxMonitor: true,
    });
    expect(await hostSettings("docker", ids.custom)).toMatchObject({
      enableDocker: true,
    });
  });

  it("keeps 2.8's defaults for a host that never changed them", async () => {
    expect(await hostSettings("file-manager", ids.plain)).toMatchObject({
      enableFileManager: true,
    });
    expect(await hostSettings("ssh-terminal", ids.plain)).toMatchObject({
      enableTerminal: true,
      enableCommandHistory: true,
    });
    expect(await hostSettings("session-recording", ids.plain)).toMatchObject({
      enableSessionRecording: true,
    });
    expect(await hostSettings("session-sharing", ids.plain)).toMatchObject({
      allowSessionSharing: true,
    });
  });

  it("moves core settings keys into plugin settings", async () => {
    const terminal = await get("/plugins/ssh-terminal/settings/admin");
    expect(terminal.status).toBe(200);
    expect(terminal.body.values.sessionTimeoutMinutes).toBe(45);

    const stepCa = await get("/plugins/step-ca/settings/admin");
    expect(stepCa.status).toBe(200);
    expect(stepCa.body.values.caUrl).toBe("https://ca.example.com");
  });
});
