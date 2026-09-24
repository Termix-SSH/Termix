import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";
import { BACKEND_EXTERNALS, FRONTEND_EXTERNALS } from "../lib/externals.mjs";
import { legacyCoreImports } from "../lib/legacy-core-imports.mjs";
import { readManifest, resolveEntry, copyDir } from "../lib/plugin-dir.mjs";

const BACKEND_ENTRIES = [
  "src/backend/index.ts",
  "src/backend/index.mjs",
  "src/backend/index.js",
];
const FRONTEND_ENTRIES = [
  "src/frontend/index.tsx",
  "src/frontend/index.ts",
  "src/frontend/index.mjs",
  "src/frontend/index.js",
];

/** Whether the plugin sits in a Termix checkout, i.e. is a bundled plugin. */
function insideTermixCheckout(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, "src", "ui", "plugin-host"))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export async function build({ cwd }) {
  const manifest = readManifest(cwd);
  const pluginId = manifest.id ?? path.basename(cwd);
  const outDir = path.join(cwd, "dist");

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const backendEntry = resolveEntry(cwd, BACKEND_ENTRIES);
  if (!backendEntry) {
    throw new Error(
      `${pluginId}: no backend entry (looked for ${BACKEND_ENTRIES.join(", ")})`,
    );
  }

  await esbuild.build({
    entryPoints: [backendEntry],
    outfile: path.join(outDir, "backend.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    sourcemap: true,
    logLevel: "warning",
    // A native dependency's compiled .node binary is resolved by the
    // package's own relative paths, which break once esbuild inlines its JS
    // elsewhere. Declaring it in nativeDependencies keeps it a real
    // node_modules import instead, resolved at runtime like a host-provided
    // package.
    external: [...BACKEND_EXTERNALS, ...(manifest.nativeDependencies ?? [])],
    plugins: [legacyCoreImports({ pluginId, platform: "node" })],
  });

  const frontendEntry = resolveEntry(cwd, FRONTEND_ENTRIES);
  if (frontendEntry) {
    await esbuild.build({
      entryPoints: [frontendEntry],
      outfile: path.join(outDir, "frontend.js"),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      jsx: "automatic",
      sourcemap: true,
      logLevel: "warning",
      external: FRONTEND_EXTERNALS,
      plugins: [
        legacyCoreImports({
          pluginId,
          platform: "browser",
          insideTermix: insideTermixCheckout(cwd),
        }),
      ],
    });
  }

  copyDir(path.join(cwd, "locales"), path.join(outDir, "locales"));
  copyDir(path.join(cwd, "migrations"), path.join(outDir, "migrations"));

  console.log(`built ${pluginId}`);
}
