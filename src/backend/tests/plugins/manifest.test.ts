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

  describe("providesSecret / requiresSecret", () => {
    const permissionGroup = {
      group: "testplugin",
      permissions: ["testplugin.secrets.share"],
    };

    it("accepts a well-formed pair", () => {
      expect(
        validateManifest(
          validManifest({
            providesSecret: [
              { key: "api-key", permission: "testplugin.secrets.share" },
            ],
            requiresSecret: [
              { plugin: "ai-assistant", key: "api-key", optional: true },
            ],
            contributes: { permissionGroup },
          }),
        ),
      ).toEqual([]);
    });

    it("rejects a dotted secret key", () => {
      // The owning plugin is already its own field, so a dotted key would only
      // encode the owner twice and invite the two disagreeing.
      const errors = validateManifest(
        validManifest({
          providesSecret: [
            { key: "ai.api-key", permission: "testplugin.secrets.share" },
          ],
        }),
      );
      expect(errors.some((e) => e.includes("providesSecret[0].key"))).toBe(
        true,
      );
    });

    it("rejects a duplicate offer of the same key", () => {
      const errors = validateManifest(
        validManifest({
          providesSecret: [
            { key: "api-key", permission: "testplugin.secrets.share" },
            { key: "api-key", permission: "testplugin.secrets.share" },
          ],
        }),
      );
      expect(errors.some((e) => e.includes("duplicate"))).toBe(true);
    });

    it("requires a permission on an offer", () => {
      const errors = validateManifest(
        validManifest({ providesSecret: [{ key: "api-key" }] }),
      );
      expect(
        errors.some((e) => e.includes("providesSecret[0].permission")),
      ).toBe(true);
    });

    it("rejects a reference with a bad plugin id", () => {
      const errors = validateManifest(
        validManifest({
          requiresSecret: [{ plugin: "Bad_Id", key: "api-key" }],
        }),
      );
      expect(errors.some((e) => e.includes("requiresSecret[0].plugin"))).toBe(
        true,
      );
    });

    it("rejects a duplicate reference to the same plugin and key", () => {
      const errors = validateManifest(
        validManifest({
          requiresSecret: [
            { plugin: "ai-assistant", key: "api-key" },
            { plugin: "ai-assistant", key: "api-key" },
          ],
        }),
      );
      expect(errors.some((e) => e.includes("duplicate"))).toBe(true);
    });

    it("refuses a shared secret gated by a permission the group never declares", () => {
      // Same rule as a service: sharing rides on an ordinary role permission,
      // so it has to be one an admin can actually grant.
      const { manifest, errors } = parseManifest(
        validManifest({
          providesSecret: [
            { key: "api-key", permission: "testplugin.undeclared" },
          ],
          contributes: { permissionGroup },
        }),
      );

      expect(manifest).toBeUndefined();
      expect(errors[0]).toContain("testplugin.undeclared");
      expect(errors[0]).toContain("permissionGroup");
    });

    it("refuses a plugin borrowing from itself", () => {
      const { manifest, errors } = parseManifest(
        validManifest({
          requiresSecret: [{ plugin: "sample-plugin", key: "api-key" }],
        }),
      );

      expect(manifest).toBeUndefined();
      expect(errors[0]).toContain("names this plugin itself");
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

  describe("actions / actionSlots", () => {
    function withActions(contributes: Record<string, unknown>) {
      return validateManifest(validManifest({ contributes }));
    }

    it("accepts a valid actions and actionSlots pair", () => {
      const errors = withActions({
        actions: [
          {
            id: "ai.openWithContext",
            titleKey: "ai.assistant",
            handler: "openWithContext",
            icon: "Bot",
            slot: "terminal.toolbar",
            kind: "button",
          },
        ],
        actionSlots: [{ id: "terminal.toolbar", accepts: ["button"] }],
      });
      expect(errors).toEqual([]);
    });

    it("allows a camelCase segment in an action id", () => {
      const errors = withActions({
        actions: [
          {
            id: "ai.openWithContext",
            titleKey: "k",
            handler: "openWithContext",
          },
        ],
      });
      expect(errors).toEqual([]);
    });

    it("rejects an action id that is not dotted", () => {
      const errors = withActions({
        actions: [{ id: "notdotted", titleKey: "k", handler: "h" }],
      });
      expect(errors.some((e) => e.includes("actions[0].id must match"))).toBe(
        true,
      );
    });

    it("rejects a duplicate action id", () => {
      const errors = withActions({
        actions: [
          { id: "a.one", titleKey: "k", handler: "h" },
          { id: "a.one", titleKey: "k", handler: "h" },
        ],
      });
      expect(
        errors.some((e) => e.includes('actions[1].id is a duplicate: "a.one"')),
      ).toBe(true);
    });

    it("requires titleKey and a valid handler", () => {
      const errors = withActions({
        actions: [{ id: "a.one", handler: "not a identifier" }],
      });
      expect(errors.some((e) => e.includes("actions[0].titleKey"))).toBe(true);
      expect(errors.some((e) => e.includes("actions[0].handler"))).toBe(true);
    });

    it("rejects an unknown contribution kind", () => {
      const errors = withActions({
        actions: [
          { id: "a.one", titleKey: "k", handler: "h", kind: "dropdown" },
        ],
      });
      expect(
        errors.some((e) => e.includes("actions[0].kind must be one of")),
      ).toBe(true);
    });

    it("rejects an unknown value in a slot's accepts", () => {
      const errors = withActions({
        actionSlots: [{ id: "terminal.toolbar", accepts: ["menu"] }],
      });
      expect(
        errors.some((e) =>
          e.includes('actionSlots[0].accepts has unknown value: "menu"'),
        ),
      ).toBe(true);
    });

    it("rejects an empty accepts array", () => {
      const errors = withActions({
        actionSlots: [{ id: "terminal.toolbar", accepts: [] }],
      });
      expect(
        errors.some((e) =>
          e.includes("actionSlots[0].accepts must be a non-empty array"),
        ),
      ).toBe(true);
    });

    it("rejects a duplicate slot id", () => {
      const errors = withActions({
        actionSlots: [
          { id: "terminal.toolbar", accepts: ["button"] },
          { id: "terminal.toolbar", accepts: ["button"] },
        ],
      });
      expect(
        errors.some((e) => e.includes("actionSlots[1].id is a duplicate")),
      ).toBe(true);
    });
  });

  describe("parseManifest", () => {
    it("refuses an action gated by an undeclared permission", () => {
      const { manifest, errors } = parseManifest(
        validManifest({
          contributes: {
            permissionGroup: { group: "ai", permissions: ["ai.use"] },
            actions: [
              {
                id: "ai.openWithContext",
                titleKey: "k",
                handler: "h",
                permission: "ai.services.use",
              },
            ],
          },
        }),
      );
      expect(manifest).toBeUndefined();
      expect(errors[0]).toContain(
        'Action "ai.openWithContext" is gated by "ai.services.use"',
      );
    });

    it("allows an action gated by a declared permission", () => {
      const { manifest, errors } = parseManifest(
        validManifest({
          contributes: {
            permissionGroup: {
              group: "ai",
              permissions: ["ai.services.use"],
            },
            actions: [
              {
                id: "ai.openWithContext",
                titleKey: "k",
                handler: "h",
                permission: "ai.services.use",
              },
            ],
          },
        }),
      );
      expect(errors).toEqual([]);
      expect(manifest?.contributes?.actions?.[0].id).toBe("ai.openWithContext");
    });

    it("allows an ungated action with no permissionGroup at all", () => {
      const { errors } = parseManifest(
        validManifest({
          contributes: {
            actions: [{ id: "a.one", titleKey: "k", handler: "h" }],
          },
        }),
      );
      expect(errors).toEqual([]);
    });

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
