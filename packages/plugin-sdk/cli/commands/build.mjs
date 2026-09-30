import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

const SDK_PATCHES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "patches",
);

/**
 * Patches a dependency before it is bundled, so the fix ships inside the
 * plugin rather than depending on whoever ran npm install.
 *
 * package.json "termix": { "patches": ["xterm-android-ime"] } names patches
 * the SDK ships for libraries several plugins share. Any .cjs file in the
 * plugin's own patches/ folder runs too. Every patch must be safe to run
 * twice.
 */
export function applyPatches(cwd, pluginId) {
  const pkgPath = path.join(cwd, "package.json");
  const pkg = fs.existsSync(pkgPath)
    ? JSON.parse(fs.readFileSync(pkgPath, "utf8"))
    : {};
  const scripts = [];
  for (const name of pkg.termix?.patches ?? []) {
    const file = path.join(SDK_PATCHES, `${name}.cjs`);
    if (!/^[a-z0-9-]+$/.test(name) || !fs.existsSync(file)) {
      throw new Error(`${pluginId}: the SDK has no patch named "${name}"`);
    }
    scripts.push(file);
  }
  const own = path.join(cwd, "patches");
  if (fs.existsSync(own)) {
    for (const file of fs.readdirSync(own).sort()) {
      if (file.endsWith(".cjs")) scripts.push(path.join(own, file));
    }
  }
  for (const file of scripts) {
    const result = spawnSync(process.execPath, [file], {
      cwd,
      env: { ...process.env, TERMIX_PATCH_ROOT: cwd },
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error(`${pluginId}: patch ${path.basename(file)} failed`);
    }
  }
}

const THEME_CSS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "dist",
  "host",
  "theme.css",
);

/**
 * Compiles the Tailwind classes the plugin's frontend uses into
 * dist/frontend.css, against the theme core ships in the SDK. Core only
 * compiles its own classes, so a class no core file happens to use would
 * otherwise have no CSS at all. Appended to whatever CSS the bundle already
 * produced (a library's stylesheet the plugin imports).
 */
/**
 * Moves a plugin's Tailwind layers under their own names. Core orders
 * termix-plugin-utilities above its base styles and below its own utilities,
 * so a plugin's copy of `.hidden` can never beat core's `md:flex` just
 * because the plugin's file loaded later.
 */
export function lowerPluginLayers(css) {
  return css.replace(
    /@layer (properties|utilities)(?=[\s{;,])/g,
    "@layer termix-plugin-$1",
  );
}

export async function buildTailwind(cwd, outDir) {
  const { compile, optimize } = await import("@tailwindcss/node");
  const { Scanner } = await import("@tailwindcss/oxide");
  if (!fs.existsSync(THEME_CSS)) {
    throw new Error("The SDK theme is missing. Run: npm run build:sdk");
  }
  const input = [
    '@import "tailwindcss/theme.css" theme(reference);',
    `@import ${JSON.stringify(THEME_CSS.replaceAll("\\", "/"))};`,
    '@import "tailwindcss/utilities.css" layer(utilities);',
  ].join("\n");
  const compiler = await compile(input, {
    base: path.dirname(THEME_CSS),
    onDependency: () => {},
  });
  const scanner = new Scanner({
    sources: [
      {
        base: path.join(cwd, "src", "frontend"),
        pattern: "**/*",
        negated: false,
      },
    ],
  });
  // Flattened and minified the way core's own CSS is, so it does not rely
  // on native CSS nesting.
  const css = lowerPluginLayers(
    optimize(compiler.build(scanner.scan()), { minify: true }).code.trim(),
  );
  if (!css) return;
  const target = path.join(outDir, "frontend.css");
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  fs.writeFileSync(target, `${existing}${existing ? "\n" : ""}${css}\n`);
}

export async function build({ cwd }) {
  const manifest = readManifest(cwd);
  const pluginId = manifest.id ?? path.basename(cwd);
  const outDir = path.join(cwd, "dist");

  applyPatches(cwd, pluginId);

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

  if (frontendEntry) await buildTailwind(cwd, outDir);

  copyDir(path.join(cwd, "locales"), path.join(outDir, "locales"));
  copyDir(path.join(cwd, "migrations"), path.join(outDir, "migrations"));

  console.log(`built ${pluginId}`);
}
