/**
 * Builds the two pieces of the plugin SDK that come from core:
 *
 *   dist/host/ui.js            @termix/plugin-sdk/ui, the shell's UI kit
 *   dist/host/testing-host.js  what renderWithApp() renders plugins into
 *
 * Inside Termix the page's import map points @termix/plugin-sdk/ui at the
 * shell's own copy, so ui.js is never loaded there. It exists so a plugin in
 * its own repo can typecheck and run its tests without a Termix checkout.
 *
 * One esbuild run with code splitting, so both entries share one copy of the
 * registries: a test host with its own registries would never see what the
 * plugin's components registered.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "packages", "plugin-sdk", "dist", "host");

// Shared with the plugin, so never a second copy. Same list the page's import
// map provides, plus the test library the host renders with.
const EXTERNALS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react-dom/client",
  "i18next",
  "react-i18next",
  "sonner",
  "@termix/plugin-sdk/frontend",
  "@testing-library/react",
];

fs.rmSync(outDir, { recursive: true, force: true });

await esbuild.build({
  entryPoints: {
    ui: path.join(root, "src/ui/plugin-host/sdk-ui.ts"),
    "testing-host": path.join(root, "src/ui/plugin-host/testing-host.tsx"),
  },
  outdir: outDir,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  logLevel: "warning",
  external: EXTERNALS,
  alias: {
    "@/types": path.join(root, "src/types"),
    "@": path.join(root, "src/ui"),
  },
  loader: {
    ".css": "empty",
    ".svg": "dataurl",
    ".png": "dataurl",
    ".woff": "empty",
    ".woff2": "empty",
    ".ttf": "empty",
  },
  // import.meta.glob is Vite's; outside Termix the host ships English only,
  // so the translated locale files it would list are simply none.
  banner: { js: "const __termixNoGlob = () => ({});" },
  define: {
    "import.meta.glob": "__termixNoGlob",
    "import.meta.env.DEV": "false",
    "import.meta.env.PROD": "true",
    "import.meta.env.MODE": '"production"',
    "import.meta.env.BASE_URL": '"/"',
    "import.meta.env":
      '{"DEV":false,"PROD":true,"MODE":"production","SSR":false,"BASE_URL":"/"}',
  },
});

// Types for @termix/plugin-sdk/ui: the declarations tsc emits for sdk-ui.ts
// and everything it reaches, with core's "@/" paths made relative.
const typesDir = path.join(outDir, "types");
const tsc = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules", "typescript", "bin", "tsc"),
    "-p",
    path.join(root, "tsconfig.sdk-ui.json"),
    "--outDir",
    typesDir,
  ],
  { cwd: root, stdio: "inherit" },
);
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
// tsc follows @termix/plugin-sdk/frontend into the SDK's source; plugins get
// those types from the package itself.
fs.rmSync(path.join(typesDir, "packages"), { recursive: true, force: true });

const srcTypes = path.join(typesDir, "src");
function rewrite(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rewrite(file);
      continue;
    }
    if (!entry.name.endsWith(".d.ts")) continue;
    const text = fs
      .readFileSync(file, "utf8")
      .replace(
        /(["'])@\/(types(?=[/"'])|)([^"']*)\1/g,
        (_match, quote, types, rest) => {
          const target = types
            ? path.join(srcTypes, "types", rest.replace(/^\//, ""))
            : path.join(srcTypes, "ui", rest);
          let relative = path
            .relative(path.dirname(file), target)
            .replaceAll("\\", "/")
            .replace(/\.tsx?$/, "");
          if (!relative.startsWith(".")) relative = `./${relative}`;
          return `${quote}${relative}${quote}`;
        },
      );
    fs.writeFileSync(file, text);
  }
}
rewrite(srcTypes);
fs.writeFileSync(
  path.join(outDir, "ui.d.ts"),
  'export * from "./types/src/ui/plugin-host/sdk-ui.js";\n',
);

// The design tokens termix-plugin build compiles a plugin's classes against.
fs.copyFileSync(
  path.join(root, "src/ui/theme.css"),
  path.join(outDir, "theme.css"),
);

console.log(`Built the SDK host modules into ${path.relative(root, outDir)}`);
