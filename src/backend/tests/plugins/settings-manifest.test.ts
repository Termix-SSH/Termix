/**
 * contributes.settings validation.
 *
 * A settings field is the one thing in a manifest that core writes to the
 * database on a plugin's behalf, so the schema has to reject anything it would
 * not know how to store or render.
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

function withSettings(settings: unknown) {
  return base({ contributes: { settings } });
}

describe("contributes.settings", () => {
  it("accepts a manifest with every field type", () => {
    const errors = validateManifest(
      withSettings({
        admin: [
          { key: "apiKey", type: "secret", labelKey: "k" },
          { key: "baseUrl", type: "string", labelKey: "k", default: "" },
          { key: "retries", type: "number", labelKey: "k", min: 0, max: 5 },
          { key: "enabled", type: "boolean", labelKey: "k" },
          {
            key: "mode",
            type: "select",
            labelKey: "k",
            options: [{ value: "a", labelKey: "k" }],
          },
          {
            key: "tags",
            type: "multiselect",
            labelKey: "k",
            options: [{ value: "a", labelKey: "k" }],
          },
          { key: "notes", type: "textarea", labelKey: "k" },
          { key: "raw", type: "json", labelKey: "k" },
          { key: "browser", type: "custom", component: "devices" },
        ],
        user: [{ key: "theme", type: "string", labelKey: "k" }],
        host: {
          enableKey: "enableThing",
          enableLabelKey: "k",
          fields: [{ key: "port", type: "number", labelKey: "k" }],
        },
      }),
    );

    expect(errors).toEqual([]);
  });

  it("accepts a manifest with no settings at all", () => {
    expect(validateManifest(base())).toEqual([]);
  });

  it("rejects an unknown field property", () => {
    const errors = validateManifest(
      withSettings({
        admin: [{ key: "a", type: "string", labelKey: "k", wat: 1 }],
      }),
    );

    expect(errors.join(" ")).toContain('Unknown field "wat"');
  });

  it("accepts a hidden field and rejects a non-boolean hidden", () => {
    expect(
      validateManifest(
        withSettings({
          host: {
            fields: [{ key: "a", type: "number", labelKey: "k", hidden: true }],
          },
        }),
      ),
    ).toEqual([]);
    const errors = validateManifest(
      withSettings({
        admin: [{ key: "a", type: "string", labelKey: "k", hidden: "yes" }],
      }),
    );
    expect(errors.join(" ")).toContain("hidden must be a boolean");
  });

  it("rejects an unknown scope", () => {
    const errors = validateManifest(
      withSettings({ global: [{ key: "a", type: "string", labelKey: "k" }] }),
    );

    expect(errors.join(" ")).toContain('Unknown field "global"');
  });

  it("rejects an unknown field type", () => {
    const errors = validateManifest(
      withSettings({ admin: [{ key: "a", type: "colour", labelKey: "k" }] }),
    );

    expect(errors.join(" ")).toContain("must be one of");
  });

  it("rejects a duplicate key within one scope", () => {
    const errors = validateManifest(
      withSettings({
        admin: [
          { key: "a", type: "string", labelKey: "k" },
          { key: "a", type: "number", labelKey: "k" },
        ],
      }),
    );

    expect(errors.join(" ")).toContain('duplicates "a"');
  });

  it("allows the same key in two different scopes", () => {
    const errors = validateManifest(
      withSettings({
        admin: [{ key: "shared", type: "string", labelKey: "k" }],
        user: [{ key: "shared", type: "string", labelKey: "k" }],
      }),
    );

    expect(errors).toEqual([]);
  });

  it("requires labelKey for everything but a custom field", () => {
    expect(
      validateManifest(
        withSettings({ admin: [{ key: "a", type: "string" }] }),
      ).join(" "),
    ).toContain("labelKey");

    expect(
      validateManifest(
        withSettings({ admin: [{ key: "a", type: "custom", component: "x" }] }),
      ),
    ).toEqual([]);
  });

  it("requires component on a custom field and forbids it elsewhere", () => {
    expect(
      validateManifest(
        withSettings({ admin: [{ key: "a", type: "custom" }] }),
      ).join(" "),
    ).toContain("component");

    expect(
      validateManifest(
        withSettings({
          admin: [{ key: "a", type: "string", labelKey: "k", component: "x" }],
        }),
      ).join(" "),
    ).toContain('only valid when type is "custom"');
  });

  it("requires non-empty options on select and multiselect", () => {
    for (const type of ["select", "multiselect"]) {
      expect(
        validateManifest(
          withSettings({ admin: [{ key: "a", type, labelKey: "k" }] }),
        ).join(" "),
      ).toContain("options must be a non-empty array");
    }
  });

  it("rejects options on a field that has no options", () => {
    const errors = validateManifest(
      withSettings({
        admin: [
          {
            key: "a",
            type: "string",
            labelKey: "k",
            options: [{ value: "x", labelKey: "k" }],
          },
        ],
      }),
    );

    expect(errors.join(" ")).toContain("only valid for select and multiselect");
  });

  it("rejects min greater than max", () => {
    const errors = validateManifest(
      withSettings({
        admin: [{ key: "a", type: "number", labelKey: "k", min: 10, max: 1 }],
      }),
    );

    expect(errors.join(" ")).toContain("must not be greater than");
  });

  it("rejects min or max on a non-number field", () => {
    const errors = validateManifest(
      withSettings({
        admin: [{ key: "a", type: "string", labelKey: "k", min: 1 }],
      }),
    );

    expect(errors.join(" ")).toContain("only valid for number fields");
  });

  it("rejects requires that names no boolean in the same scope", () => {
    const errors = validateManifest(
      withSettings({
        admin: [
          { key: "a", type: "string", labelKey: "k", requires: "missing" },
        ],
      }),
    );

    expect(errors.join(" ")).toContain("must name a boolean field");
  });

  it("rejects requires that names a non-boolean field", () => {
    const errors = validateManifest(
      withSettings({
        admin: [
          { key: "flag", type: "string", labelKey: "k" },
          { key: "a", type: "string", labelKey: "k", requires: "flag" },
        ],
      }),
    );

    expect(errors.join(" ")).toContain("must name a boolean field");
  });

  it("accepts requires pointing at a boolean declared later", () => {
    const errors = validateManifest(
      withSettings({
        admin: [
          { key: "a", type: "string", labelKey: "k", requires: "flag" },
          { key: "flag", type: "boolean", labelKey: "k" },
        ],
      }),
    );

    expect(errors).toEqual([]);
  });

  it("lets a host field require the section's enable key", () => {
    const errors = validateManifest(
      withSettings({
        host: {
          enableKey: "enableThing",
          enableLabelKey: "k",
          fields: [
            {
              key: "port",
              type: "number",
              labelKey: "k",
              requires: "enableThing",
            },
          ],
        },
      }),
    );

    expect(errors).toEqual([]);
  });

  it("rejects a host field colliding with the enable key", () => {
    const errors = validateManifest(
      withSettings({
        host: {
          enableKey: "enableThing",
          enableLabelKey: "k",
          fields: [{ key: "enableThing", type: "boolean", labelKey: "k" }],
        },
      }),
    );

    expect(errors.join(" ")).toContain("already the section's enableKey");
  });

  it("requires enableLabelKey alongside enableKey", () => {
    const errors = validateManifest(
      withSettings({
        host: { enableKey: "enableThing", fields: [] },
      }),
    );

    expect(errors.join(" ")).toContain("enableLabelKey");
  });

  it("rejects a key that would not be index-safe", () => {
    const errors = validateManifest(
      withSettings({
        admin: [{ key: "a".repeat(80), type: "string", labelKey: "k" }],
      }),
    );

    expect(errors.join(" ")).toContain("short alphanumeric key");
  });
});

describe("settings field permissions", () => {
  it("rejects a short permission the plugin does not declare", () => {
    const { errors } = parseManifest(
      base({
        contributes: {
          settings: {
            user: [
              { key: "a", type: "string", labelKey: "k", permission: "use" },
            ],
          },
        },
      }),
    );

    expect(errors.join(" ")).toContain(
      "not declared in contributes.permissions",
    );
  });

  it("accepts a short permission the plugin declares", () => {
    const { errors, manifest } = parseManifest(
      base({
        contributes: {
          permissions: [{ name: "use", titleKey: "k", descriptionKey: "k" }],
          settings: {
            user: [
              { key: "a", type: "string", labelKey: "k", permission: "use" },
            ],
          },
        },
      }),
    );

    expect(errors).toEqual([]);
    expect(manifest?.contributes?.settings?.user?.[0].permission).toBe("use");
  });

  it("accepts a fully qualified permission from another namespace", () => {
    // Cross-namespace ids cannot be checked here: the validator has no idea
    // which other plugins exist. Taken as given, exactly like ctx.rbac does.
    const { errors } = parseManifest(
      base({
        contributes: {
          settings: {
            user: [
              {
                key: "a",
                type: "string",
                labelKey: "k",
                permission: "hosts.view",
              },
            ],
          },
        },
      }),
    );

    expect(errors).toEqual([]);
  });
});
