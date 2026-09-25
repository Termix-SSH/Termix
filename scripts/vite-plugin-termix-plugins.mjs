/**
 * Makes the shell a host for plugin bundles.
 *
 * - Every shared module (React, i18next and the SDK) becomes an entry chunk,
 *   reached through a stable shim at dist/shared/<name>.js.
 * - index.html gets an import map pointing those bare specifiers at the shims,
 *   so a plugin bundle's `import "react"` lands on the shell's React.
 * - In `vite dev`, src/ui/plugin-host/workspace-plugins.ts is replaced with
 *   import.meta.glob calls, so the monorepo's plugins load through Vite with
 *   HMR, and the map points at dev-server module URLs instead.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  importMapCspHash,
  productionImportMap,
  sharedModules,
  shimName,
  shimPath,
  SHARED_VENDOR_MODULES,
  SHARED_VENDORS,
} from "./lib/plugin-import-map.mjs";

const VIRTUAL_PREFIX = "\0termix-shared:";
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function hasDefaultExport(file) {
  const source = fs.readFileSync(file, "utf8");
  return (
    /\bexport\s+default\b/.test(source) ||
    /\bexport\s*\{[^}]*\bas\s+default\b/.test(source)
  );
}

/**
 * CommonJS packages (React among them) lose their named exports through
 * `export *`, so their facade lists every name explicitly, read from the
 * package itself at build time.
 */
function vendorFacade(repoRoot, specifier) {
  const vendor = SHARED_VENDORS.find((item) => item.specifier === specifier);
  if (vendor && !vendor.cjs) {
    const target = JSON.stringify(specifier);
    return vendor.hasDefault
      ? `export * from ${target};
export { default } from ${target};`
      : `export * from ${target};`;
  }
  const require = createRequire(path.join(repoRoot, "package.json"));
  const names = Object.keys(require(specifier)).filter(
    (name) =>
      name !== "default" && name !== "__esModule" && IDENTIFIER.test(name),
  );
  const lines = [`import * as m from ${JSON.stringify(specifier)};`];
  lines.push("const d = m.default ?? m;");
  for (const name of names) {
    lines.push(`export const ${name} = m.${name} ?? d.${name};`);
  }
  lines.push("export default d;");
  return lines.join("\n");
}

function sourceFacade(file) {
  const target = JSON.stringify(file.replaceAll("\\", "/"));
  const lines = [`export * from ${target};`];
  if (hasDefaultExport(file)) lines.push(`export { default } from ${target};`);
  return lines.join("\n");
}

export function termixPluginHost({ repoRoot, sdkUiEntry, sdkFrontendEntry }) {
  let command = "build";
  let shared = [];
  const workspaceModule = path
    .join(repoRoot, "src", "ui", "plugin-host", "workspace-plugins.ts")
    .replaceAll("\\", "/");

  const facadeSource = (specifier) => {
    if (SHARED_VENDOR_MODULES.includes(specifier)) {
      return vendorFacade(repoRoot, specifier);
    }
    if (specifier === "@termix/plugin-sdk/ui") return sourceFacade(sdkUiEntry);
    if (specifier === "@termix/plugin-sdk/frontend") {
      return sourceFacade(sdkFrontendEntry);
    }
    throw new Error(`termix-plugin-host: ${specifier} is not a shared module`);
  };

  return {
    name: "termix-plugin-host",

    config(_config, env) {
      command = env.command;
      shared = sharedModules();
      if (command !== "build") return;
      const input = { index: path.join(repoRoot, "index.html") };
      for (const specifier of shared) {
        input[`shared-${shimName(specifier)}`] = VIRTUAL_PREFIX + specifier;
      }
      return {
        build: {
          rollupOptions: {
            input,
            // Entry exports are the contract with plugin bundles; they must
            // survive tree-shaking even though nothing in the shell uses them.
            preserveEntrySignatures: "exports-only",
          },
        },
      };
    },

    resolveId(id) {
      if (id.startsWith(VIRTUAL_PREFIX)) return id;
      return null;
    },

    load(id) {
      if (id.startsWith(VIRTUAL_PREFIX)) {
        return facadeSource(id.slice(VIRTUAL_PREFIX.length));
      }
      if (
        command === "serve" &&
        id.replaceAll("\\", "/").split("?")[0] === workspaceModule
      ) {
        return [
          'const frontends = import.meta.glob("/plugins/*/src/frontend/index.{tsx,ts}");',
          'const locales = import.meta.glob("/plugins/*/locales/**/*.json", { import: "default" });',
          "export const workspaceFrontends = {};",
          "export const workspaceLocales = {};",
          "for (const [file, load] of Object.entries(frontends)) {",
          '  workspaceFrontends[file.split("/")[2]] = load;',
          "}",
          "for (const [file, load] of Object.entries(locales)) {",
          '  const parts = file.split("/");',
          "  const id = parts[2];",
          '  const name = parts[parts.length - 1].replace(/\\.json$/, "");',
          "  (workspaceLocales[id] ??= {})[name] = load;",
          "}",
        ].join("\n");
      }
      return null;
    },

    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || !chunk.isEntry) continue;
        const facade = chunk.facadeModuleId ?? "";
        if (!facade.startsWith(VIRTUAL_PREFIX)) continue;
        const specifier = facade.slice(VIRTUAL_PREFIX.length);
        const target = JSON.stringify(`../${chunk.fileName}`);
        const lines = [`export * from ${target};`];
        if (chunk.exports.includes("default")) {
          lines.push(`export { default } from ${target};`);
        }
        this.emitFile({
          type: "asset",
          fileName: shimPath(specifier),
          source: `${lines.join("\n")}\n`,
        });
      }
      const text = productionImportMap(shared);
      this.emitFile({
        type: "asset",
        fileName: "importmap.sha256",
        source: `${importMapCspHash(text)}\n`,
      });
    },

    transformIndexHtml: {
      order: "pre",
      handler() {
        const text =
          command === "build"
            ? productionImportMap(shared)
            : JSON.stringify({
                imports: Object.fromEntries(
                  [...shared]
                    .sort()
                    .map((specifier) => [
                      specifier,
                      `/@id/__x00__${VIRTUAL_PREFIX.slice(1)}${specifier}`,
                    ]),
                ),
              });
        return [
          {
            tag: "script",
            attrs: { type: "importmap" },
            children: text,
            injectTo: "head-prepend",
          },
        ];
      },
    },
  };
}
