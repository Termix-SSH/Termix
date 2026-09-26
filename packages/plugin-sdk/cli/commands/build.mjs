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

/**
 * A bundled CommonJS package that calls require("react/jsx-runtime") (or any
 * other host-provided package) cannot reach it: the package is external, and
 * esbuild's ESM output has no require, so the plugin throws "Dynamic require
 * is not supported" as soon as it loads. Each such require is pointed at a
 * small ES module that imports the external and re-exports it, which esbuild
 * can hand to CommonJS code.
 */
export function externalRequireInterop(externals) {
  const names = new Set(externals.filter((name) => !name.includes("*")));
  return {
    name: "termix-external-require",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind !== "require-call" || !names.has(args.path)) return;
        return { path: args.path, namespace: "termix-external-require" };
      });
      build.onLoad(
        { filter: /.*/, namespace: "termix-external-require" },
        (args) => {
          const id = JSON.stringify(args.path);
          return {
            contents: `import * as mod from ${id};\nexport * from ${id};\nexport default mod.default ?? mod;\n`,
            loader: "js",
          };
        },
      );
    },
  };
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
      // Vite replaces these in the dev server; a plugin bundle has to have
      // them too, or code that reads them throws when the plugin loads.
      define: {
        "process.env.NODE_ENV": '"production"',
        "import.meta.env.DEV": "false",
        "import.meta.env.PROD": "true",
        "import.meta.env.MODE": '"production"',
        "import.meta.env.SSR": "false",
        "import.meta.env":
          '{"DEV":false,"PROD":true,"MODE":"production","SSR":false,"BASE_URL":"/"}',
      },
      plugins: [
        externalRequireInterop(FRONTEND_EXTERNALS),
        staticUrlImports({ outDir }),
      ],
    });
  }

  copyDir(path.join(cwd, "locales"), path.join(outDir, "locales"));
  copyDir(path.join(cwd, "migrations"), path.join(outDir, "migrations"));

  console.log(`built ${pluginId}`);
}
