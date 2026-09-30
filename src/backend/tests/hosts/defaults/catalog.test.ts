import { describe, expect, it, vi } from "vitest";

vi.mock("../../../database/repositories/factory.js", () => ({}));
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import {
  buildCatalog,
  catalogNamespaces,
  isDefaultableField,
} from "../../../hosts/defaults/catalog.js";
import {
  defaultValuesEqual,
  normalizeAuthDefault,
  normalizeSocks5Default,
  parseDefaultOverrides,
  splitDefaultKey,
  stableStringify,
} from "../../../../types/host-defaults.js";

const manifest = {
  id: "fixture",
  contributes: {
    settings: {
      host: {
        enableKey: "enabled",
        enableDefault: true,
        fields: [
          { key: "mode", type: "select", default: "a", options: [] },
          { key: "token", type: "secret" },
          { key: "config", type: "json", secretKeys: ["password"] },
          { key: "mac", type: "string", defaultable: false },
          {
            key: "snippet",
            type: "number",
            defaultLevels: ["user", "folder"],
          },
          { key: "font", type: "number", default: 14, personal: true },
        ],
      },
    },
  },
} as unknown as PluginManifest;

describe("the catalog", () => {
  it("holds core's keys and each defaultable plugin field", () => {
    const catalog = buildCatalog([manifest]);
    expect(catalog.has("core.sshPort")).toBe(true);
    expect(catalog.has("core.auth")).toBe(true);
    expect(catalog.has("fixture.enabled")).toBe(true);
    expect(catalog.has("fixture.mode")).toBe(true);
    expect(catalog.has("fixture.token")).toBe(false);
    expect(catalog.has("fixture.config")).toBe(false);
    expect(catalog.has("fixture.mac")).toBe(false);
    expect(catalog.get("fixture.snippet")?.levels).toEqual(["user", "folder"]);
    expect(catalog.get("fixture.font")?.personal).toBe(true);
    expect(catalog.get("fixture.enabled")?.builtin).toBe(true);
    expect(catalogNamespaces(catalog)).toEqual(["core", "fixture"]);
  });

  it("reads an unset plugin value as its manifest default", () => {
    const mode = buildCatalog([manifest]).get("fixture.mode")!;
    expect(mode.normalize(null)).toBe("a");
    expect(mode.normalize("")).toBe("a");
    expect(mode.normalize("b")).toBe("b");
  });

  it("never lets a secret be a default", () => {
    expect(isDefaultableField({ key: "s", type: "secret" })).toBe(false);
    expect(
      isDefaultableField({ key: "s", type: "secret", defaultable: true }),
    ).toBe(false);
  });
});

describe("value shapes", () => {
  it("keeps only the auth fields its type uses", () => {
    expect(
      normalizeAuthDefault({
        authType: "agent",
        credentialId: 4,
        agentSocketPath: "/tmp/agent",
      }),
    ).toEqual({
      authType: "agent",
      credentialId: null,
      overrideCredentialUsername: false,
      agentSocketPath: "/tmp/agent",
      agentIdentity: null,
    });
    expect(normalizeAuthDefault(null)).toBeNull();
  });

  it("drops a proxy's settings while it is off, and chain passwords always", () => {
    expect(
      normalizeSocks5Default({ useSocks5: false, socks5Host: "x" }).socks5Host,
    ).toBeNull();
    expect(
      normalizeSocks5Default({
        useSocks5: true,
        socks5ProxyChain: [{ host: "a", password: "p" }],
      }).socks5ProxyChain,
    ).toEqual([{ host: "a" }]);
  });

  it("compares objects regardless of key order", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(
      stableStringify({ a: 2, b: 1 }),
    );
    expect(defaultValuesEqual([{ a: 1 }], [{ a: 1 }])).toBe(true);
  });

  it("parses overrides and splits keys", () => {
    expect(parseDefaultOverrides('{"core":["b","a","a"],"x":"no"}')).toEqual({
      core: ["a", "b"],
    });
    expect(parseDefaultOverrides(null)).toBeNull();
    expect(splitDefaultKey("ssh-terminal.fontSize")).toEqual([
      "ssh-terminal",
      "fontSize",
    ]);
  });
});
