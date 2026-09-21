import { describe, expect, it } from "vitest";
import {
  parseManifest,
  validateManifest,
  SUPPORTED_PLUGIN_API_VERSION,
} from "../../plugins/manifest.js";

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: "sample-plugin",
    name: "Sample Plugin",
    version: "1.0.0",
    description: "A sample plugin.",
    author: { name: "Jane Doe" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: SUPPORTED_PLUGIN_API_VERSION },
    capabilities: {
      backend: true,
      frontend: false,
      electron: false,
      platforms: ["linux"],
    },
    permissions: ["hosts.read", "storage.own"],
    sidecars: [],
    ...overrides,
  };
}

describe("plugin manifest validation", () => {
  it("accepts a valid manifest", () => {
    expect(validateManifest(validManifest())).toEqual([]);
  });

  it("reports every missing required field", () => {
    const errors = validateManifest({ id: "x" });
    expect(errors).toContain('Missing required field: "description"');
    expect(errors).toContain('Missing required field: "engine"');
    expect(errors).toContain('Missing required field: "sidecars"');
  });

  it("rejects a bad id pattern", () => {
    const errors = validateManifest(validManifest({ id: "Bad_Id" }));
    expect(errors.some((e) => e.startsWith('Field "id" must match'))).toBe(
      true,
    );
  });

  it("rejects a non-semver version", () => {
    const errors = validateManifest(validManifest({ version: "1.0" }));
    expect(errors).toContain(
      'Field "version" must be valid semver, got: "1.0"',
    );
  });

  it("rejects an unknown permission", () => {
    const errors = validateManifest(
      validManifest({ permissions: ["credentials.read"] }),
    );
    expect(
      errors.some((e) => e.includes('Unknown permission: "credentials.read"')),
    ).toBe(true);
  });

  it("rejects an unknown category", () => {
    const errors = validateManifest(validManifest({ category: "Games" }));
    expect(
      errors.some((e) => e.startsWith('Field "category" must be one of')),
    ).toBe(true);
  });

  it("rejects a non-object manifest", () => {
    expect(validateManifest(null)).toEqual(["Manifest must be a JSON object"]);
    expect(validateManifest([])).toEqual(["Manifest must be a JSON object"]);
  });

  it("validates contributes sub-shapes", () => {
    const errors = validateManifest(
      validManifest({
        contributes: {
          tabs: [{ id: "t", titleKey: "k", icon: "Box", openFrom: ["nope"] }],
          apiPrefix: "Bad Prefix",
        },
      }),
    );
    expect(
      errors.some((e) => e.includes('openFrom has unknown value: "nope"')),
    ).toBe(true);
    expect(
      errors.some((e) => e.includes('"contributes.apiPrefix" must match')),
    ).toBe(true);
  });

  describe("parseManifest", () => {
    it("narrows a valid manifest", () => {
      const { manifest, errors } = parseManifest(validManifest());
      expect(errors).toEqual([]);
      expect(manifest?.id).toBe("sample-plugin");
    });

    it("refuses a manifest targeting a different SDK major", () => {
      const { manifest, errors } = parseManifest(
        validManifest({ engine: { termix: ">=2.9.0", api: "99" } }),
      );
      expect(manifest).toBeUndefined();
      expect(errors[0]).toContain('targets SDK api version "99"');
    });

    it("does not narrow when validation failed", () => {
      const { manifest, errors } = parseManifest({ id: "x" });
      expect(manifest).toBeUndefined();
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
