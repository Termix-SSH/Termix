/**
 * Legacy core imports: the debt D1 removes.
 *
 * Plugin code predates the SDK and still reaches core, and in one case a
 * sibling plugin, by relative path. Those specifiers must stay out of the
 * bundle and be rewritten to where the built server puts the target.
 *
 * The rewrite is output-relative, not source-relative. Every plugin bundles
 * to plugins/<id>/dist/backend.js, which sits at the same depth the old
 * per-file output did, so one prefix covers a source file at any nesting.
 *
 * Delete this file in D1, once every plugin reaches core through the SDK.
 */

import { legacyCoreSpecifier } from "./legacy-core-specifier.mjs";

// "../../../src/backend/" or "../../../../src/backend/", any depth.
const CORE_BACKEND = /^(?:\.\.\/)+src\/backend\//;
// Shared types. Mostly erased at compile, but automations imports a real
// value (AUTOMATION_DEFINITION_VERSION), so this has to resolve at runtime.
const CORE_TYPES = /^(?:\.\.\/)+src\/types\//;
const CORE_UI = /^(?:\.\.\/)+src\/ui\//;
/** dist/plugins/<id>/dist/backend.js -> dist/backend/... */
const COMPILED_CORE = "../../../backend/backend/";
const COMPILED_TYPES = "../../../backend/types/";

const CORE_ALIAS = /^@\//;

export function legacyCoreImports({ pluginId, platform, insideTermix = true }) {
  return {
    name: "legacy-core-imports",
    setup(build) {
      // The shell's own modules, reached as "@/..." or by relative path.
      // Bundling them would give the plugin a second copy of the shell's
      // contexts and API client, so each becomes a bare specifier the page's
      // import map resolves to the shell's own module.
      if (platform === "browser") {
        const toLegacy = (args) => {
          const specifier = legacyCoreSpecifier(args.path);
          if (!specifier) return null;
          if (!insideTermix) {
            return {
              errors: [
                {
                  text: `${pluginId}: "${args.path}" reaches Termix core. Only plugins built inside a Termix checkout may; use @termix/plugin-sdk instead.`,
                },
              ],
            };
          }
          return { path: specifier, external: true };
        };
        build.onResolve({ filter: CORE_ALIAS }, toLegacy);
        build.onResolve({ filter: CORE_UI }, toLegacy);
        build.onResolve({ filter: CORE_TYPES }, toLegacy);
      }

      build.onResolve({ filter: CORE_BACKEND }, (args) => ({
        path: args.path.replace(CORE_BACKEND, COMPILED_CORE),
        external: true,
      }));

      build.onResolve({ filter: CORE_TYPES }, (args) => ({
        path: args.path.replace(CORE_TYPES, COMPILED_TYPES),
        external: true,
      }));
    },
  };
}
