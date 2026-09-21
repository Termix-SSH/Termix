/**
 * Builds a real unpacked plugin on disk for the loader/broker tests.
 *
 * The backend entry has to be a genuine .mjs file the worker can import, and
 * tsc only emits .ts, so these are written at test time rather than committed.
 * Same mkdtemp convention the other disk-touching backend tests use.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SUPPORTED_PLUGIN_API_VERSION } from "../../plugins/manifest.js";

export interface FixtureOptions {
  id?: string;
  permissions?: string[];
  /** Body of backend/index.mjs. Must export activate(ctx). */
  backendSource?: string;
  /** Omit the backend entry file even though the manifest declares one. */
  omitBackendEntry?: boolean;
  manifestOverrides?: Record<string, unknown>;
}

export interface Fixture {
  root: string;
  dir: string;
  id: string;
  cleanup: () => void;
}

const DEFAULT_BACKEND = `
export async function activate(ctx) {
  ctx.__ready = true;
}
`;

export function createFixturePlugin(options: FixtureOptions = {}): Fixture {
  const id = options.id ?? "sample-plugin";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-plugins-"));
  const dir = path.join(root, id);

  fs.mkdirSync(path.join(dir, "backend"), { recursive: true });

  const manifest = {
    id,
    name: "Sample Plugin",
    version: "1.0.0",
    description: "Fixture plugin for runtime tests.",
    author: { name: "Termix Tests" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: SUPPORTED_PLUGIN_API_VERSION },
    capabilities: {
      backend: true,
      frontend: false,
      electron: false,
      platforms: ["linux", "win32", "darwin"],
    },
    permissions: options.permissions ?? ["hosts.read", "storage.own"],
    sidecars: [],
    ...options.manifestOverrides,
  };

  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  if (!options.omitBackendEntry) {
    fs.writeFileSync(
      path.join(dir, "backend", "index.mjs"),
      options.backendSource ?? DEFAULT_BACKEND,
    );
  }

  return {
    root,
    dir,
    id,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
