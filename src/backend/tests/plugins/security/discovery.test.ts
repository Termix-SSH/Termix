/**
 * Discovery: a bundled id can never be taken by a user plugin, the folder
 * name is the id, nothing a manifest names (or a symlink inside the plugin)
 * reaches outside the plugin folder, table prefixes cannot overlap, and the
 * manifest validator refuses unknown fields, bad ids and reserved ids.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PluginLoader, prefixesOverlap } from "../../../plugins/loader.js";
import { parseManifest } from "../../../plugins/manifest.js";
import { RESERVED_PLUGIN_IDS } from "@termix/plugin-sdk/manifest";
import { createFixturePlugin } from "../fixture-plugin.js";

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentPluginStorageRepository: () => ({}),
}));

const cleanups: Array<() => void> = [];

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

afterEach(() => {
  delete process.env.TERMIX_BUNDLED_PLUGINS_DIR;
  delete process.env.DATA_DIR;
  while (cleanups.length) cleanups.pop()?.();
});

function validManifest(overrides: Record<string, unknown> = {}) {
  const fixture = createFixturePlugin();
  cleanups.push(fixture.cleanup);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(fixture.dir, "manifest.json"), "utf8"),
  );
  return { ...manifest, ...overrides };
}

describe("shadowing a bundled plugin", () => {
  it("is refused even when the bundled one failed to load", async () => {
    const bundled = tempRoot("termix-bundled-");
    const user = tempRoot("termix-data-");
    const userPlugins = path.join(user, "plugins");
    fs.mkdirSync(userPlugins, { recursive: true });

    // The bundled copy is broken, so it never makes it into the loader.
    createFixturePlugin({ id: "ssh-terminal", root: bundled });
    fs.writeFileSync(
      path.join(bundled, "ssh-terminal", "manifest.json"),
      "{ broken",
    );
    createFixturePlugin({ id: "ssh-terminal", root: userPlugins });

    process.env.TERMIX_BUNDLED_PLUGINS_DIR = bundled;
    process.env.DATA_DIR = user;
    const loaded = await new PluginLoader().loadAll();

    expect(loaded).toEqual([]);
  });

  it("needs the folder name to be the manifest id", async () => {
    const fixture = createFixturePlugin({
      manifestOverrides: { id: "other-id" },
    });
    cleanups.push(fixture.cleanup);
    await expect(new PluginLoader().load(fixture.dir, "user")).rejects.toThrow(
      /does not match manifest id/,
    );
  });
});

describe("table prefixes", () => {
  it("overlap when one id's prefix covers the other's tables", () => {
    expect(prefixesOverlap("foo", "foo-bar")).toBe(true);
    expect(prefixesOverlap("foo-bar", "foo")).toBe(true);
    expect(prefixesOverlap("session", "session-sharing")).toBe(true);
    expect(prefixesOverlap("ai", "automations")).toBe(false);
    expect(prefixesOverlap("web-endpoint", "webauthn")).toBe(false);
    expect(prefixesOverlap("foo", "foo")).toBe(false);
  });

  it("the loader refuses the second plugin of an overlapping pair", async () => {
    const root = tempRoot("termix-overlap-");
    createFixturePlugin({ id: "foo", root });
    createFixturePlugin({ id: "foo-bar", root });
    const loader = new PluginLoader();
    await loader.load(path.join(root, "foo"), "bundled");
    await expect(
      loader.load(path.join(root, "foo-bar"), "user"),
    ).rejects.toThrow(/overlaps "foo"/);
  });

  it("no two bundled plugins overlap", () => {
    const plugins = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../../plugins",
    );
    const ids = fs
      .readdirSync(plugins, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const a of ids) {
      for (const b of ids) {
        expect(prefixesOverlap(a, b), `${a} and ${b}`).toBe(false);
      }
    }
  });
});

describe("paths stay inside the plugin", () => {
  it("refuses a backend entry that is a symlink to outside", async () => {
    const root = tempRoot("termix-link-");
    const outside = path.join(root, "outside.mjs");
    fs.writeFileSync(outside, "export function activate() {}");
    const fixture = createFixturePlugin({ id: "linker", root });
    const entry = path.join(fixture.dir, "backend", "index.mjs");
    fs.rmSync(entry);
    try {
      fs.symlinkSync(outside, entry, "file");
    } catch {
      return;
    }
    await expect(new PluginLoader().load(fixture.dir, "user")).rejects.toThrow(
      /outside the plugin directory/,
    );
  });

  it.each([
    ["backend", "../../evil.js"],
    ["backend", "/etc/evil.js"],
    ["backend", "C:/evil.js"],
    ["frontend", "dist\\..\\..\\evil.js"],
    ["frontend", "."],
    ["locales", "../../secrets"],
  ])("the validator refuses %s: %s", (field, value) => {
    const { manifest, errors } = parseManifest(
      validManifest({ [field]: value }),
    );
    expect(manifest).toBeUndefined();
    expect(errors.join("\n")).toMatch(/relative path inside the plugin/);
  });
});

describe("manifest validation", () => {
  it.each(RESERVED_PLUGIN_IDS.map((id) => [id]))(
    "refuses the reserved id %s",
    (id) => {
      const { manifest, errors } = parseManifest(validManifest({ id }));
      expect(manifest).toBeUndefined();
      expect(errors.join("\n")).toMatch(/reserved/);
    },
  );

  it.each([["Bad-Id"], ["1starts-with-digit"], ["has_underscore"], ["a"]])(
    "refuses the bad id %s",
    (id) => {
      expect(parseManifest(validManifest({ id })).manifest).toBeUndefined();
    },
  );

  it("refuses an unknown top-level field", () => {
    const { manifest, errors } = parseManifest(
      validManifest({ runAsRoot: true }),
    );
    expect(manifest).toBeUndefined();
    expect(errors.join("\n")).toMatch(/runAsRoot/);
  });

  it("refuses an unknown nested field", () => {
    const { manifest } = parseManifest(
      validManifest({ author: { name: "x", backdoor: true } }),
    );
    expect(manifest).toBeUndefined();
  });

  it("refuses a preset key that is not a plain name", () => {
    const presets = {
      simple: { __proto__x: true },
      balanced: { __proto__x: true },
      advanced: { __proto__x: true },
    };
    const { manifest, errors } = parseManifest(
      validManifest({ contributes: { uiPresets: presets } }),
    );
    expect(manifest).toBeUndefined();
    expect(errors.join("\n")).toMatch(/invalid key/);
  });
});
