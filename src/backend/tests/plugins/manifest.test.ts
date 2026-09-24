/**
 * Manifest v2 validation.
 *
 * The rules live in the SDK so the server, the authoring script and plugin
 * authors share one implementation; these tests drive it through the server's
 * re-export, which is the path the loader actually takes.
 */

import { describe, expect, it } from "vitest";
import {
  parseManifest,
  validateManifest,
  SUPPORTED_PLUGIN_API_VERSION,
} from "../../plugins/manifest.js";

function base(overrides: Record<string, unknown> = {}) {
  return {
    id: "sample-plugin",
    name: "Sample Plugin",
    version: "1.0.0",
    description: "A fixture.",
    author: { name: "Termix Tests" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: SUPPORTED_PLUGIN_API_VERSION },
    capabilities: ["kv:own"],
    ...overrides,
  };
}

describe("manifest v2 validation", () => {
  it("accepts a minimal valid manifest", () => {
    expect(validateManifest(base())).toEqual([]);
  });

  it("reports every missing required field at once", () => {
    const errors = validateManifest({ id: "sample-plugin" });

    expect(errors.some((e) => e.includes('"name"'))).toBe(true);
    expect(errors.some((e) => e.includes('"version"'))).toBe(true);
    expect(errors.some((e) => e.includes('"capabilities"'))).toBe(true);
  });

  it("rejects an id that is not a lowercase slug", () => {
    expect(validateManifest(base({ id: "Sample_Plugin" })).join()).toMatch(
      /"id" must match/,
    );
  });

  it("rejects an id that starts with a digit", () => {
    expect(validateManifest(base({ id: "1plugin" })).join()).toMatch(
      /"id" must match/,
    );
  });

  it("rejects a non-semver version", () => {
    expect(validateManifest(base({ version: "1.0" })).join()).toMatch(
      /valid semver/,
    );
  });

  it("rejects an unknown category", () => {
    expect(validateManifest(base({ category: "Nonsense" })).join()).toMatch(
      /must be one of/,
    );
  });

  // Capabilities were dotted in v1. They are colon-separated now so they can
  // never be confused with the dotted RBAC permissions.
  it("rejects a dotted capability name", () => {
    expect(
      validateManifest(base({ capabilities: ["hosts.read"] })).join(),
    ).toMatch(/not a known capability/);
  });

  it("rejects a capability outside the catalog", () => {
    expect(
      validateManifest(base({ capabilities: ["hosts:obliterate"] })).join(),
    ).toMatch(/not a known capability/);
  });

  it("rejects a duplicated capability", () => {
    expect(
      validateManifest(base({ capabilities: ["kv:own", "kv:own"] })).join(),
    ).toMatch(/duplicates/);
  });

  it("refuses a manifest targeting another SDK api version", () => {
    const { manifest, errors } = parseManifest(
      base({ engine: { termix: ">=2.9.0", api: "2" } }),
    );

    expect(manifest).toBeUndefined();
    expect(errors.join()).toMatch(/SDK API version/);
  });

  it("fills in the entry point defaults", () => {
    const { manifest } = parseManifest(base());

    expect(manifest?.backend).toBe("dist/backend.js");
    expect(manifest?.frontend).toBe("dist/frontend.js");
    expect(manifest?.locales).toBe("locales");
  });
});

// v1 accepted unknown fields silently, so a typo'd "contribute" validated
// clean and was then dropped. A manifest has to mean what it says.
describe("unknown field rejection", () => {
  it("rejects an unknown top-level field", () => {
    expect(validateManifest(base({ sudoEverything: true })).join()).toMatch(
      /Unknown field "sudoEverything"/,
    );
  });

  it("rejects a near-miss of a real field name", () => {
    expect(validateManifest(base({ contribute: {} })).join()).toMatch(
      /Unknown field "contribute"/,
    );
  });

  it("rejects an unknown field inside contributes", () => {
    const errors = validateManifest(base({ contributes: { widgets: [] } }));

    expect(errors.join()).toMatch(/Unknown field "widgets"/);
  });

  it("rejects an unknown field inside a tab", () => {
    const errors = validateManifest(
      base({
        contributes: {
          tabs: [
            {
              id: "t",
              titleKey: "k",
              icon: "i",
              openFrom: ["rail"],
              surprise: 1,
            },
          ],
        },
      }),
    );

    expect(errors.join()).toMatch(/Unknown field "surprise"/);
  });

  it("rejects an unknown field inside author and engine", () => {
    expect(
      validateManifest(base({ author: { name: "x", role: "admin" } })).join(),
    ).toMatch(/Unknown field "role"/);

    expect(
      validateManifest(
        base({ engine: { termix: ">=2.9.0", api: "1", unsafe: true } }),
      ).join(),
    ).toMatch(/Unknown field "unsafe"/);
  });

  it("rejects an unknown field inside a provides entry", () => {
    const errors = validateManifest(
      base({
        provides: [
          {
            service: "sample.thing",
            version: "1.0.0",
            permission: "sample-plugin.use",
            elevated: true,
          },
        ],
        contributes: {
          permissions: [
            {
              name: "use",
              titleKey: "permissions.use.title",
              descriptionKey: "permissions.use.description",
            },
          ],
        },
      }),
    );

    expect(errors.join()).toMatch(/Unknown field "elevated"/);
  });
});

describe("dependencies", () => {
  it("accepts a well-formed dependency map", () => {
    expect(
      validateManifest(base({ dependencies: { automations: "^1.0.0" } })),
    ).toEqual([]);
  });

  it("rejects a range that is not valid semver", () => {
    expect(
      validateManifest(
        base({ dependencies: { automations: "latest!" } }),
      ).join(),
    ).toMatch(/valid semver range/);
  });

  it("refuses a plugin depending on itself", () => {
    const { errors } = parseManifest(
      base({ dependencies: { "sample-plugin": "^1.0.0" } }),
    );

    expect(errors.join()).toMatch(/points at this plugin/);
  });

  it("refuses the same plugin in both dependency maps", () => {
    const { errors } = parseManifest(
      base({
        dependencies: { automations: "^1.0.0" },
        optionalDependencies: { automations: "^1.0.0" },
      }),
    );

    expect(errors.join()).toMatch(/both dependencies and optionalDependencies/);
  });
});

describe("plugin permissions", () => {
  it("accepts declared permissions", () => {
    expect(
      validateManifest(
        base({
          contributes: {
            permissions: [
              {
                name: "use",
                titleKey: "permissions.use.title",
                descriptionKey: "permissions.use.description",
              },
            ],
          },
        }),
      ),
    ).toEqual([]);
  });

  it("accepts a dotted name and a system role default", () => {
    expect(
      validateManifest(
        base({
          contributes: {
            permissions: [
              {
                name: "services.use",
                titleKey: "permissions.services.use.title",
                descriptionKey: "permissions.services.use.description",
                defaultRoles: ["admin"],
              },
            ],
          },
        }),
      ),
    ).toEqual([]);
  });

  // Without this a manifest could name a core group and then gate a route on
  // authority it was never given.
  it("refuses a name starting with a core group", () => {
    const errors = validateManifest(
      base({
        contributes: {
          permissions: [
            {
              name: "admin.users.manage",
              titleKey: "k",
              descriptionKey: "d",
            },
          ],
        },
      }),
    );

    expect(errors.join()).toMatch(/reserved core group/);
  });

  it("refuses a name starting with hosts", () => {
    const errors = validateManifest(
      base({
        contributes: {
          permissions: [
            { name: "hosts.view", titleKey: "k", descriptionKey: "d" },
          ],
        },
      }),
    );

    expect(errors.join()).toMatch(/reserved core group/);
  });

  // "sample-plugin" + "sample-plugin.use" would register as
  // sample-plugin.sample-plugin.use, which is never the intent.
  it("refuses a name that repeats the plugin id", () => {
    const errors = validateManifest(
      base({
        contributes: {
          permissions: [
            { name: "sample-plugin.use", titleKey: "k", descriptionKey: "d" },
          ],
        },
      }),
    );

    expect(errors.join()).toMatch(/already starts with this plugin/);
  });

  it("refuses a default for a role core does not seed", () => {
    const errors = validateManifest(
      base({
        contributes: {
          permissions: [
            {
              name: "use",
              titleKey: "k",
              descriptionKey: "d",
              defaultRoles: ["superuser"],
            },
          ],
        },
      }),
    );

    expect(errors.join()).toMatch(/defaultRoles\[0\]/);
  });

  it("refuses a duplicate name", () => {
    const errors = validateManifest(
      base({
        contributes: {
          permissions: [
            { name: "use", titleKey: "k", descriptionKey: "d" },
            { name: "use", titleKey: "k2", descriptionKey: "d2" },
          ],
        },
      }),
    );

    expect(errors.join()).toMatch(/declared more than once/);
  });

  it("requires both i18n keys", () => {
    const errors = validateManifest(
      base({ contributes: { permissions: [{ name: "use" }] } }),
    );

    expect(errors.join()).toMatch(/titleKey/);
    expect(errors.join()).toMatch(/descriptionKey/);
  });

  // The id an admin grants is <pluginId>.<name>, so cross-field checks compare
  // against the qualified form rather than the short name.
  it("matches a service permission against the qualified id", () => {
    const { errors } = parseManifest(
      base({
        provides: [
          {
            service: "sample.thing",
            version: "1.0.0",
            permission: "sample-plugin.use",
          },
        ],
        contributes: {
          permissions: [{ name: "use", titleKey: "k", descriptionKey: "d" }],
        },
      }),
    );

    expect(errors).toEqual([]);
  });
});

describe("services, secrets and actions", () => {
  it("refuses a service gated by a permission the group never declares", () => {
    const { errors } = parseManifest(
      base({
        provides: [
          {
            service: "sample.thing",
            version: "1.0.0",
            permission: "sample-plugin.missing",
          },
        ],
        contributes: {
          permissions: [
            {
              name: "use",
              titleKey: "permissions.use.title",
              descriptionKey: "permissions.use.description",
            },
          ],
        },
      }),
    );

    expect(errors.join()).toMatch(/not declared in contributes/);
  });

  it("refuses a shared secret gated by an undeclared permission", () => {
    const { errors } = parseManifest(
      base({
        providesSecret: [
          { key: "api-key", permission: "sample-plugin.missing" },
        ],
        contributes: {
          permissions: [
            {
              name: "use",
              titleKey: "permissions.use.title",
              descriptionKey: "permissions.use.description",
            },
          ],
        },
      }),
    );

    expect(errors.join()).toMatch(/not declared in contributes/);
  });

  it("refuses a plugin borrowing a secret from itself", () => {
    const { errors } = parseManifest(
      base({ requiresSecret: [{ plugin: "sample-plugin", key: "api-key" }] }),
    );

    expect(errors.join()).toMatch(/points at this plugin/);
  });

  it("refuses an action gated by an undeclared permission", () => {
    const { errors } = parseManifest(
      base({
        contributes: {
          permissions: [
            {
              name: "use",
              titleKey: "permissions.use.title",
              descriptionKey: "permissions.use.description",
            },
          ],
          actions: [
            {
              id: "sample.open",
              titleKey: "k",
              handler: "open",
              permission: "sample-plugin.missing",
            },
          ],
        },
      }),
    );

    expect(errors.join()).toMatch(/not declared in contributes/);
  });

  it("allows a camelCase segment in an action id", () => {
    expect(
      validateManifest(
        base({
          contributes: {
            actions: [
              { id: "ai.openWithContext", titleKey: "k", handler: "open" },
            ],
          },
        }),
      ),
    ).toEqual([]);
  });

  it("rejects an action id that is not dotted", () => {
    expect(
      validateManifest(
        base({
          contributes: {
            actions: [{ id: "open", titleKey: "k", handler: "open" }],
          },
        }),
      ).join(),
    ).toMatch(/dotted action id/);
  });

  it("rejects a handler that is not an identifier", () => {
    expect(
      validateManifest(
        base({
          contributes: {
            actions: [
              { id: "sample.open", titleKey: "k", handler: "not valid!" },
            ],
          },
        }),
      ).join(),
    ).toMatch(/JavaScript identifier/);
  });
});

describe("tabs and host capabilities", () => {
  it("rejects an unknown openFrom value", () => {
    expect(
      validateManifest(
        base({
          contributes: {
            tabs: [
              { id: "t", titleKey: "k", icon: "i", openFrom: ["telepathy"] },
            ],
          },
        }),
      ).join(),
    ).toMatch(/openFrom\[0\] must be one of/);
  });

  it("rejects duplicate tab ids", () => {
    expect(
      validateManifest(
        base({
          contributes: {
            tabs: [
              { id: "t", titleKey: "k", icon: "i", openFrom: ["rail"] },
              { id: "t", titleKey: "k2", icon: "i", openFrom: ["rail"] },
            ],
          },
        }),
      ).join(),
    ).toMatch(/duplicates/);
  });

  it("accepts hostCapability as a single object or an array", () => {
    const one = {
      key: "enableThing",
      labelKey: "k",
      editorTab: "general",
    };

    expect(
      validateManifest(base({ contributes: { hostCapability: one } })),
    ).toEqual([]);

    expect(
      validateManifest(
        base({
          contributes: {
            hostCapability: [one, { ...one, key: "enableOther" }],
          },
        }),
      ),
    ).toEqual([]);
  });

  it("rejects duplicate hostCapability keys", () => {
    const one = { key: "enableThing", labelKey: "k", editorTab: "general" };

    expect(
      validateManifest(
        base({ contributes: { hostCapability: [one, one] } }),
      ).join(),
    ).toMatch(/duplicates/);
  });
});

describe("panels, dashboard cards and guest pages", () => {
  it("accepts declared panels, cards and the guest flag", () => {
    expect(
      validateManifest(
        base({
          contributes: {
            panels: [{ id: "sample-panel", titleKey: "nav.panel" }],
            dashboardCards: [
              { id: "sample-card", titleKey: "cards.sample", icon: "Box" },
            ],
            guest: true,
          },
        }),
      ),
    ).toEqual([]);
  });

  it("rejects duplicate view ids and missing title keys", () => {
    const errors = validateManifest(
      base({
        contributes: {
          panels: [
            { id: "p", titleKey: "a" },
            { id: "p", titleKey: "b" },
          ],
          dashboardCards: [{ id: "c" }],
        },
      }),
    ).join();
    expect(errors).toMatch(/panels\[1\]\.id duplicates "p"/);
    expect(errors).toMatch(/dashboardCards\[0\]\.titleKey/);
  });

  it("accepts guest views on a guest plugin and refuses them otherwise", () => {
    expect(
      validateManifest(
        base({ contributes: { guest: true, guestViews: ["shared"] } }),
      ),
    ).toEqual([]);
    const errors = validateManifest(
      base({ contributes: { guestViews: ["Shared View"] } }),
    ).join();
    expect(errors).toMatch(/contributes\.guestViews entries must be/);
    expect(errors).toMatch(/needs "contributes\.guest"/);
  });

  it("rejects an unknown field inside a view and a non-boolean guest", () => {
    const errors = validateManifest(
      base({
        contributes: {
          panels: [{ id: "p", titleKey: "a", width: 3 }],
          guest: "yes",
        },
      }),
    ).join();
    expect(errors).toMatch(/Unknown field "width"/);
    expect(errors).toMatch(/contributes\.guest" must be a boolean/);
  });
});

describe("named service providers", () => {
  const provides = (names: unknown) => [
    {
      service: "sample.live",
      version: "1.0.0",
      permission: "sample-plugin.use",
      names,
    },
  ];
  const permissions = {
    permissions: [
      {
        name: "use",
        titleKey: "permissions.use.title",
        descriptionKey: "permissions.use.description",
      },
    ],
  };

  it("accepts a list of provider names", () => {
    expect(
      validateManifest(
        base({ provides: provides(["ssh", "rdp"]), contributes: permissions }),
      ),
    ).toEqual([]);
  });

  it("refuses an empty, duplicated or malformed list", () => {
    for (const names of [[], ["ssh", "ssh"], ["SSH"], "ssh"]) {
      expect(
        validateManifest(
          base({ provides: provides(names), contributes: permissions }),
        ).join(),
      ).toMatch(/provides\[0\]\.names/);
    }
  });
});
