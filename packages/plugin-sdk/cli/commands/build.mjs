import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";
import { BACKEND_EXTERNALS, FRONTEND_EXTERNALS } from "../lib/externals.mjs";
import { staticUrlImports } from "../lib/static-url-imports.mjs";
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
    // Bundled CJS deps still call require() for Node builtins at runtime.
    // ESM has no ambient require, so give esbuild's require shim a real one.
    banner: {
      js: "import { createRequire as __termixCreateRequire } from 'node:module'; const require = __termixCreateRequire(import.meta.url);",
    },
  });

  // Without this Node finds the host's typeless package.json, tries backend.js
  // as CommonJS first and warns before reparsing it as ESM.
  fs.writeFileSync(
    path.join(outDir, "package.json"),
    `${JSON.stringify({ type: "module" }, null, 2)}\n`,
  );

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
      plugins: [staticUrlImports({ outDir })],
    });
  }

  copyDir(path.join(cwd, "locales"), path.join(outDir, "locales"));
  copyDir(path.join(cwd, "migrations"), path.join(outDir, "migrations"));

  console.log(`built ${pluginId}`);
}
