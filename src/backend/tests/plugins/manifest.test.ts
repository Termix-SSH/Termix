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

  describe("provides / requires", () => {
    const permissionGroup = {
      group: "testplugin",
      permissions: ["testplugin.greet.use"],
    };

    it("accepts a declared service and requirement", () => {
      const errors = validateManifest(
        validManifest({
          provides: [
            {
              service: "testplugin.greet",
              version: "1.0.0",
              permission: "testplugin.greet.use",
            },
          ],
          requires: [
            { service: "other.thing", versionRange: "^1.0.0", optional: true },
          ],
          contributes: { permissionGroup },
        }),
      );
      expect(errors).toEqual([]);
    });

    it("rejects a service name that is not dotted", () => {
      const errors = validateManifest(
        validManifest({
          provides: [{ service: "greet", version: "1.0.0", permission: "x.y" }],
        }),
      );
      expect(errors.some((e) => e.includes("provides[0].service"))).toBe(true);
    });

    it("rejects a non-semver service version", () => {
      const errors = validateManifest(
        validManifest({
          provides: [{ service: "a.b", version: "1.0", permission: "x.y" }],
        }),
      );
      expect(errors.some((e) => e.includes("provides[0].version"))).toBe(true);
    });

    it("rejects a duplicate provided service", () => {
      const errors = validateManifest(
        validManifest({
          provides: [
            { service: "a.b", version: "1.0.0", permission: "x.y" },
            { service: "a.b", version: "2.0.0", permission: "x.y" },
          ],
        }),
      );
      expect(errors.some((e) => e.includes("duplicate"))).toBe(true);
    });

    it("rejects an invalid semver range", () => {
      const errors = validateManifest(
        validManifest({
          requires: [{ service: "a.b", versionRange: "not a range" }],
        }),
      );
      expect(errors.some((e) => e.includes("versionRange"))).toBe(true);
    });

    it("rejects a non-boolean optional", () => {
      const errors = validateManifest(
        validManifest({
          requires: [
            { service: "a.b", versionRange: "^1.0.0", optional: "yes" },
          ],
        }),
      );
      expect(errors.some((e) => e.includes("optional"))).toBe(true);
    });

    it("refuses a service gated by a permission the group never declares", () => {
      // Otherwise every call through it would deny against a permission no
      // admin could ever grant.
      const { manifest, errors } = parseManifest(
        validManifest({
          provides: [
            {
              service: "testplugin.greet",
              version: "1.0.0",
              permission: "testplugin.undeclared",
            },
          ],
          contributes: { permissionGroup },
        }),
      );

      expect(manifest).toBeUndefined();
      expect(errors[0]).toContain("testplugin.undeclared");
      expect(errors[0]).toContain("permissionGroup");
    });
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
