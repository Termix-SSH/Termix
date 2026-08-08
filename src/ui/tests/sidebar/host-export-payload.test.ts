import { describe, expect, it } from "vitest";
import {
  buildExportPayload,
  hostKey,
  maskSecrets,
  SECRET_KEYS,
  type ExportPayload,
  type FieldGroup,
} from "../../sidebar/host-export-payload";

const ALL_GROUPS = new Set<FieldGroup>([
  "connection",
  "notes",
  "tags",
  "tunnels",
  "jumpHosts",
  "quickActions",
  "featureFlags",
  "advanced",
]);

function shareRaw(): ExportPayload {
  return {
    version: "1",
    exportedAt: "2026-07-27T00:00:00.000Z",
    credentials: [
      { alias: "prod-admin", name: "prod-admin", username: "root" },
      { alias: "orphan", name: "orphan", username: "nobody" },
    ],
    hosts: [
      {
        connectionType: "ssh",
        name: "web",
        ip: "10.0.0.1",
        port: 22,
        username: "deploy",
        folder: "prod",
        password: null,
        key: null,
        notes: "primary",
        tags: ["a"],
        pin: true,
        jumpHosts: [{ hostId: 3 }],
        credentialAlias: "prod-admin",
        authType: "credential",
      },
      {
        connectionType: "ssh",
        name: "db",
        ip: "10.0.0.2",
        port: 22,
        username: "deploy",
        folder: "prod",
        password: null,
        notes: "database",
        tags: [],
        pin: false,
        credentialAlias: "orphan",
        authType: "credential",
      },
    ],
  };
}

function rdpRaw(): ExportPayload {
  return {
    hosts: [
      {
        connectionType: "rdp",
        name: "desk",
        ip: "10.0.0.9",
        port: 3389,
        username: "admin",
        password: null,
        guacamoleConfig: {
          "gateway-hostname": "gw.example.com",
          "gateway-password": "gw-secret",
        },
      },
    ],
  };
}

function socks5Raw(): ExportPayload {
  return {
    hosts: [
      {
        connectionType: "ssh",
        name: "jump",
        ip: "10.0.0.5",
        port: 22,
        username: "admin",
        password: null,
        useSocks5: true,
        socks5ProxyChain: [
          {
            host: "proxy1",
            port: 1080,
            type: 5,
            username: "u1",
            password: "proxy-secret-1",
          },
          { host: "proxy2", port: 1080, type: 5, password: "proxy-secret-2" },
        ],
      },
    ],
  };
}

describe("hostKey", () => {
  it("distinguishes hosts differing in any tuple field", () => {
    const a = {
      name: "x",
      ip: "1",
      port: 22,
      username: "u",
      connectionType: "ssh",
    };
    expect(hostKey(a)).toBe(hostKey({ ...a }));
    expect(hostKey(a)).not.toBe(hostKey({ ...a, port: 2222 }));
    expect(hostKey(a)).not.toBe(hostKey({ ...a, connectionType: "rdp" }));
  });
});

describe("buildExportPayload", () => {
  it("includes every host when selection is null", () => {
    const out = buildExportPayload(shareRaw(), null, ALL_GROUPS, false);
    expect(out.hosts.map((h) => h.name)).toEqual(["web", "db"]);
  });

  it("includes only the selected hosts", () => {
    const raw = shareRaw();
    const selected = new Set([hostKey(raw.hosts[0])]);
    const out = buildExportPayload(raw, selected, ALL_GROUPS, false);
    expect(out.hosts.map((h) => h.name)).toEqual(["web"]);
  });

  it("drops keys belonging to disabled groups", () => {
    const out = buildExportPayload(
      shareRaw(),
      null,
      new Set<FieldGroup>(["connection"]),
      false,
    );
    expect(out.hosts[0].name).toBe("web");
    expect(out.hosts[0]).not.toHaveProperty("notes");
    expect(out.hosts[0]).not.toHaveProperty("tags");
    expect(out.hosts[0]).not.toHaveProperty("jumpHosts");
  });

  it("prunes credentials whose only referencing host was deselected", () => {
    const raw = shareRaw();
    const selected = new Set([hostKey(raw.hosts[0])]);
    const out = buildExportPayload(raw, selected, ALL_GROUPS, false);
    expect(out.credentials?.map((c) => c.alias)).toEqual(["prod-admin"]);
  });

  it("keeps credential metadata regardless of enabled groups", () => {
    const out = buildExportPayload(
      shareRaw(),
      null,
      new Set<FieldGroup>(["connection"]),
      false,
    );
    expect(out.hosts[0].credentialAlias).toBe("prod-admin");
    expect(out.hosts[0].authType).toBe("credential");
  });

  it("never emits a secret value when the source has none", () => {
    const out = buildExportPayload(shareRaw(), null, ALL_GROUPS, false);
    for (const host of out.hosts) {
      for (const secret of SECRET_KEYS) {
        expect(host[secret] ?? null).toBeNull();
      }
    }
  });

  it("selects hosts identical across all tuple fields together", () => {
    const raw = shareRaw();
    raw.hosts[1] = { ...raw.hosts[0], notes: "different" };
    const selected = new Set([hostKey(raw.hosts[0])]);
    const out = buildExportPayload(raw, selected, ALL_GROUPS, false);
    expect(out.hosts).toHaveLength(2);
  });

  it("passes a real secret through untouched when credentials are included", () => {
    const raw: ExportPayload = {
      hosts: [{ name: "web", ip: "1", port: 22, password: "hunter2" }],
    };
    const out = buildExportPayload(
      raw,
      null,
      new Set<FieldGroup>(["connection"]),
      true,
    );
    expect(out.hosts[0].password).toBe("hunter2");
  });

  it("nulls the guacamole gateway password when credentials are excluded", () => {
    const out = buildExportPayload(rdpRaw(), null, ALL_GROUPS, false);
    const config = out.hosts[0].guacamoleConfig as Record<string, unknown>;
    expect(config["gateway-password"]).toBeNull();
    expect(config["gateway-hostname"]).toBe("gw.example.com");
  });

  it("keeps the guacamole gateway password when credentials are included", () => {
    const out = buildExportPayload(rdpRaw(), null, ALL_GROUPS, true);
    const config = out.hosts[0].guacamoleConfig as Record<string, unknown>;
    expect(config["gateway-password"]).toBe("gw-secret");
  });

  it("does not mutate the source payload when nulling nested secrets", () => {
    const raw = rdpRaw();
    buildExportPayload(raw, null, ALL_GROUPS, false);
    const config = raw.hosts[0].guacamoleConfig as Record<string, unknown>;
    expect(config["gateway-password"]).toBe("gw-secret");
  });

  it("nulls socks5 proxy chain passwords when credentials are excluded", () => {
    const out = buildExportPayload(socks5Raw(), null, ALL_GROUPS, false);
    const chain = out.hosts[0].socks5ProxyChain as Record<string, unknown>[];
    expect(chain[0].password).toBeNull();
    expect(chain[1].password).toBeNull();
    expect(chain[0].host).toBe("proxy1");
  });

  it("keeps socks5 proxy chain passwords when credentials are included", () => {
    const out = buildExportPayload(socks5Raw(), null, ALL_GROUPS, true);
    const chain = out.hosts[0].socks5ProxyChain as Record<string, unknown>[];
    expect(chain[0].password).toBe("proxy-secret-1");
    expect(chain[1].password).toBe("proxy-secret-2");
  });

  it("does not mutate the source payload when nulling socks5 proxy chain passwords", () => {
    const raw = socks5Raw();
    buildExportPayload(raw, null, ALL_GROUPS, false);
    const chain = raw.hosts[0].socks5ProxyChain as Record<string, unknown>[];
    expect(chain[0].password).toBe("proxy-secret-1");
    expect(chain[1].password).toBe("proxy-secret-2");
  });
});

describe("maskSecrets", () => {
  it("replaces present secret values and leaves nulls alone", () => {
    const raw: ExportPayload = {
      hosts: [{ name: "web", password: "hunter2", key: null }],
    };
    const out = maskSecrets(raw);
    expect(out.hosts[0].password).toBe("<included>");
    expect(out.hosts[0].key).toBeNull();
  });

  it("leaks no source secret into its output", () => {
    const raw: ExportPayload = {
      hosts: [{ name: "web", password: "hunter2", sudoPassword: "s3cret" }],
    };
    expect(JSON.stringify(maskSecrets(raw))).not.toContain("hunter2");
    expect(JSON.stringify(maskSecrets(raw))).not.toContain("s3cret");
  });

  it("masks the guacamole gateway password", () => {
    const out = maskSecrets(rdpRaw());
    const config = out.hosts[0].guacamoleConfig as Record<string, unknown>;
    expect(config["gateway-password"]).toBe("<included>");
    expect(config["gateway-hostname"]).toBe("gw.example.com");
    expect(JSON.stringify(out)).not.toContain("gw-secret");
  });

  it("masks socks5 proxy chain passwords", () => {
    const out = maskSecrets(socks5Raw());
    const chain = out.hosts[0].socks5ProxyChain as Record<string, unknown>[];
    expect(chain[0].password).toBe("<included>");
    expect(chain[1].password).toBe("<included>");
    expect(JSON.stringify(out)).not.toContain("proxy-secret-1");
    expect(JSON.stringify(out)).not.toContain("proxy-secret-2");
  });
});
