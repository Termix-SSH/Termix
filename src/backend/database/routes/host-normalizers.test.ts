import { describe, it, expect } from "vitest";
import {
  isNonEmptyString,
  isValidPort,
  normalizeImportedHost,
  renameFolderPath,
  stripSensitiveFields,
  transformHostResponse,
} from "./host-normalizers.js";

describe("isNonEmptyString", () => {
  it("accepts non-blank strings", () => {
    expect(isNonEmptyString("hello")).toBe(true);
    expect(isNonEmptyString("  x  ")).toBe(true);
  });

  it("rejects blank strings and non-strings", () => {
    expect(isNonEmptyString("")).toBe(false);
    expect(isNonEmptyString("   ")).toBe(false);
    expect(isNonEmptyString(123)).toBe(false);
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
  });
});

describe("renameFolderPath", () => {
  it("renames an exact folder match", () => {
    expect(renameFolderPath("Production", "Production", "Prod")).toBe("Prod");
  });

  it("re-paths nested children under the renamed ancestor", () => {
    expect(renameFolderPath("Production / Web", "Production", "Prod")).toBe(
      "Prod / Web",
    );
    expect(
      renameFolderPath("Production / Web / app01", "Production", "Prod"),
    ).toBe("Prod / Web / app01");
  });

  it("renames a nested folder itself and keeps its parent", () => {
    expect(
      renameFolderPath("Production / Web", "Production / Web", "Frontend"),
    ).toBe("Frontend");
    expect(
      renameFolderPath(
        "Production / Web / app01",
        "Production / Web",
        "Production / Frontend",
      ),
    ).toBe("Production / Frontend / app01");
  });

  it("returns null for unrelated folders", () => {
    expect(renameFolderPath("Staging", "Production", "Prod")).toBeNull();
    expect(renameFolderPath("Production2", "Production", "Prod")).toBeNull();
    expect(
      renameFolderPath("ProductionExtra / Web", "Production", "Prod"),
    ).toBeNull();
  });
});

describe("isValidPort", () => {
  it("accepts ports in range", () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(22)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
  });

  it("rejects out-of-range or non-number ports", () => {
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
    expect(isValidPort(-1)).toBe(false);
    expect(isValidPort("22")).toBe(false);
  });
});

describe("normalizeImportedHost", () => {
  it("defaults connectionType to ssh with port 22", () => {
    const host = normalizeImportedHost({ ip: "10.0.0.1" });
    expect(host.connectionType).toBe("ssh");
    expect(host.port).toBe(22);
    expect(host.enableSsh).toBe(true);
    expect(host.enableRdp).toBe(false);
  });

  it("infers rdp from enableRdp and uses default rdp port", () => {
    const host = normalizeImportedHost({ enableRdp: true, ip: "10.0.0.2" });
    expect(host.connectionType).toBe("rdp");
    expect(host.port).toBe(3389);
    expect(host.enableRdp).toBe(true);
  });

  it("honors an explicit port over protocol defaults", () => {
    const host = normalizeImportedHost({
      connectionType: "ssh",
      port: 2222,
    });
    expect(host.port).toBe(2222);
  });

  it("resolves ip from common aliases", () => {
    expect(normalizeImportedHost({ address: "a.example" }).ip).toBe(
      "a.example",
    );
    expect(normalizeImportedHost({ hostname: "h.example" }).ip).toBe(
      "h.example",
    );
  });

  it("normalizes tags from a comma string", () => {
    const host = normalizeImportedHost({ tags: "prod, db , , web" });
    expect(host.tags).toEqual(["prod", "db", "web"]);
  });

  it("normalizes tags from an array", () => {
    const host = normalizeImportedHost({ tags: ["a", "  b  ", "", "c"] });
    expect(host.tags).toEqual(["a", "b", "c"]);
  });

  it("infers authType credential when credentialId present", () => {
    const host = normalizeImportedHost({ credentialId: 7 });
    expect(host.credentialId).toBe(7);
    expect(host.authType).toBe("credential");
  });
});

describe("stripSensitiveFields", () => {
  it("removes secret fields and adds boolean presence flags", () => {
    const result = stripSensitiveFields({
      name: "web",
      password: "secret",
      key: "PRIVATE KEY",
      keyPassword: "kp",
      sudoPassword: "sp",
    });
    expect(result.password).toBeUndefined();
    expect(result.key).toBeUndefined();
    expect(result.keyPassword).toBeUndefined();
    expect(result.sudoPassword).toBeUndefined();
    expect(result.hasPassword).toBe(true);
    expect(result.hasKey).toBe(true);
    expect(result.hasKeyPassword).toBe(true);
    expect(result.hasSudoPassword).toBe(true);
    expect(result.name).toBe("web");
  });

  it("marks presence flags false when secrets are absent", () => {
    const result = stripSensitiveFields({ name: "web" });
    expect(result.hasPassword).toBe(false);
    expect(result.hasKey).toBe(false);
  });
});

describe("transformHostResponse", () => {
  it("parses tags and coerces enable flags to booleans", () => {
    const result = transformHostResponse({
      tags: "a,b,c",
      enableTerminal: 1,
      enableTunnel: 0,
      pin: 1,
    });
    expect(result.tags).toEqual(["a", "b", "c"]);
    expect(result.enableTerminal).toBe(true);
    expect(result.enableTunnel).toBe(false);
    expect(result.pin).toBe(true);
  });

  it("parses JSON array fields and defaults them to []", () => {
    const result = transformHostResponse({
      tunnelConnections: '[{"sourcePort":8080}]',
      jumpHosts: null,
    });
    expect(result.tunnelConnections).toEqual([{ sourcePort: 8080 }]);
    expect(result.jumpHosts).toEqual([]);
  });

  it("infers protocol flags for a migrated non-ssh host", () => {
    const result = transformHostResponse({
      connectionType: "rdp",
      enableSsh: true,
    });
    expect(result.enableSsh).toBe(false);
    expect(result.enableRdp).toBe(true);
  });

  it("applies default protocol ports", () => {
    const result = transformHostResponse({ port: 22 });
    expect(result.sshPort).toBe(22);
    expect(result.rdpPort).toBe(3389);
    expect(result.vncPort).toBe(5900);
    expect(result.telnetPort).toBe(23);
  });

  it("coerces enableProxmox and parses proxmoxConfig", () => {
    const result = transformHostResponse({
      enableProxmox: 1,
      proxmoxConfig: '{"defaultCredentialId":3,"windowsPatterns":"win"}',
    });
    expect(result.enableProxmox).toBe(true);
    expect(result.proxmoxConfig).toEqual({
      defaultCredentialId: 3,
      windowsPatterns: "win",
    });
  });

  it("defaults enableProxmox to false when absent", () => {
    const result = transformHostResponse({ port: 22 });
    expect(result.enableProxmox).toBe(false);
    expect(result.proxmoxConfig).toBeUndefined();
  });
});
