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

// "../../../src/backend/" or "../../../../src/backend/", any depth.
const CORE_BACKEND = /^(?:\.\.\/)+src\/backend\//;
// Shared types. Mostly erased at compile, but automations imports a real
// value (AUTOMATION_DEFINITION_VERSION), so this has to resolve at runtime.
const CORE_TYPES = /^(?:\.\.\/)+src\/types\//;
const CORE_UI = /^(?:\.\.\/)+src\/ui\//;
// "../../../<other-plugin>/backend/" -- only plugins/ai/.../executor.ts today.
// esbuild filters are Go RE2, which has no lookahead, so "src" is excluded in
// the callback rather than the pattern.
const CROSS_PLUGIN = /^(?:\.\.\/)+([a-z0-9-]+)\/(?:src\/)?backend\//;

/** dist/plugins/<id>/dist/backend.js -> dist/backend/... */
const COMPILED_CORE = "../../../backend/backend/";
const COMPILED_TYPES = "../../../backend/types/";

export function legacyCoreImports({ pluginId, platform }) {
  return {
    name: "legacy-core-imports",
    setup(build) {
      build.onResolve({ filter: CORE_BACKEND }, (args) => ({
        path: args.path.replace(CORE_BACKEND, COMPILED_CORE),
        external: true,
      }));

      build.onResolve({ filter: CORE_TYPES }, (args) => ({
        path: args.path.replace(CORE_TYPES, COMPILED_TYPES),
        external: true,
      }));

      // The shell's own modules. Only plugins/docker's frontend entry reaches
      // core this way; every other frontend uses the "@/" alias, which is
      // externalized by name. A7 removes both.
      if (platform === "browser") {
        build.onResolve({ filter: CORE_UI }, (args) => ({
          path: args.path,
          external: true,
        }));
      }

      build.onResolve({ filter: CROSS_PLUGIN }, (args) => {
        const [, other] = CROSS_PLUGIN.exec(args.path);
        if (other === "src" || other === pluginId) return null;
        return { path: `../../${other}/dist/backend.js`, external: true };
      });
    },
  };
}
