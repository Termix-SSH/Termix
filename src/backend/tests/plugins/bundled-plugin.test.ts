/**
 * The bundled plugins, as they ship.
 *
 * This reads plugins/ in the repo rather than a fixture: the manifests are
 * checked-in artifacts, and a typo in one would otherwise only show up when
 * the server tried to boot.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getBundledPluginsDir } from "../../plugins/paths.js";
import { parseManifest } from "../../plugins/manifest.js";
import { isKnownCapability } from "@termix/plugin-sdk/capabilities";

vi.mock("../../utils/logger.js", () => ({
  pluginLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const BUNDLED_DIR = getBundledPluginsDir();

function bundledIds(): string[] {
  return fs
    .readdirSync(BUNDLED_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => fs.existsSync(path.join(BUNDLED_DIR, id, "manifest.json")));
}

function readManifest(pluginId: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(BUNDLED_DIR, pluginId, "manifest.json"), "utf8"),
  );
}

const ids = bundledIds();

describe("bundled plugins", () => {
  it("finds the bundled plugin directory", () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  it.each(ids)("%s has a manifest that parses", (id) => {
    const { manifest, errors } = parseManifest(readManifest(id));

    expect(errors).toEqual([]);
    expect(manifest?.id).toBe(id);
  });

  it.each(ids)("%s declares only catalog capabilities", (id) => {
    const { manifest } = parseManifest(readManifest(id));

    for (const capability of manifest?.capabilities ?? []) {
      expect(isKnownCapability(capability)).toBe(true);
    }
  });

  it.each(ids)("%s ships the entry points its manifest names", (id) => {
    const { manifest } = parseManifest(readManifest(id));
    const dir = path.join(BUNDLED_DIR, id);

    expect(fs.existsSync(path.join(dir, manifest!.backend!))).toBe(true);
    expect(fs.existsSync(path.join(dir, manifest!.frontend!))).toBe(true);
  });

  // process:transport-owner was the v1 marker for the in-process tier. There
  // is one tier now, so nothing should still be asking for it.
  it.each(ids)("%s does not declare a v1 permission", (id) => {
    const raw = readManifest(id);

    expect(raw.permissions).toBeUndefined();
    expect(raw.sidecars).toBeUndefined();
    expect(JSON.stringify(raw)).not.toContain("transport-owner");
  });
});

describe("declared dependencies", () => {
  it("names a plugin that is actually bundled", () => {
    for (const id of ids) {
      const { manifest } = parseManifest(readManifest(id));
      for (const dependency of Object.keys(manifest?.dependencies ?? {})) {
        expect(ids).toContain(dependency);
      }
    }
  });

  // ai reaches automations through the automations.access service, so it
  // keeps working when automations is off.
  it("keeps ai's use of automations optional", () => {
    if (!ids.includes("ai")) return;

    const { manifest } = parseManifest(readManifest("ai"));

    expect(manifest?.dependencies?.automations).toBeUndefined();
    expect(manifest?.optionalDependencies?.automations).toBeTruthy();
  });
});

describe("plugins that own a port", () => {
  // Every one of these had its server created at module scope at some point.
  // The rule is that it belongs inside activate, or disable leaves the port
  // held and re-enable fails.
  it.each(["ssh-terminal", "docker", "host-metrics", "remote-desktop"])(
    "%s creates no listener at module scope",
    (id) => {
      if (!ids.includes(id)) return;

      const entry = path.join(BUNDLED_DIR, id, "src", "backend", "index.ts");
      const source = fs.readFileSync(entry, "utf8");
      const moduleScope = source.slice(
        0,
        source.indexOf("export async function activate"),
      );

      expect(moduleScope).not.toMatch(/\.listen\(/);
      expect(moduleScope).not.toMatch(/new WebSocketServer/);
    },
  );

  it("docker does not register a process signal handler", () => {
    if (!ids.includes("docker")) return;

    // Core owns shutdown: gracefulShutdown calls shutdownPlugins, which runs
    // every plugin's deactivate. A plugin calling process.exit() itself
    // skipped the rest of that sequence.
    for (const file of ["index.ts", "console.ts"]) {
      const candidate = path.join(
        BUNDLED_DIR,
        "docker",
        "src",
        "backend",
        file,
      );
      if (!fs.existsSync(candidate)) continue;

      // Comments are stripped first: the rule is worth explaining in prose
      // right where it applies, and that prose names the thing it forbids.
      const code = fs
        .readFileSync(candidate, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      expect(code).not.toMatch(/process\.on\(\s*["']SIG/);
      expect(code).not.toMatch(/process\.exit\(/);
    }
  });
});
