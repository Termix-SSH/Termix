/**
 * Legacy core modules a bundled plugin frontend still imports.
 *
 * Bundled plugin frontends predate the SDK and import the shell's own modules
 * as "@/..." (or, in a couple of places, by relative path into src/). Bundling
 * those would give the plugin a second copy of the shell's contexts and API
 * client, so the CLI rewrites each one to a bare specifier under
 * "@termix/legacy-core/" and core's build exposes exactly that module through
 * the import map. Both sides use this one normalizer so they cannot disagree.
 *
 * Only plugins built inside a Termix checkout may do this. D1 deletes it.
 */

export const LEGACY_CORE_PREFIX = "@termix/legacy-core/";

const EXTENSION = /\.(tsx|ts|jsx|js|mjs)$/;

function clean(rest) {
  return rest.replace(EXTENSION, "").replace(/\/+$/, "");
}

/**
 * "@/components/button.tsx" -> "@termix/legacy-core/ui/components/button"
 * "@/types"                 -> "@termix/legacy-core/types"
 * "@/types/connection-log"  -> "@termix/legacy-core/types/connection-log"
 * "../../../src/ui/x.tsx"   -> "@termix/legacy-core/ui/x"
 * Anything else             -> null
 */
export function legacyCoreSpecifier(specifier) {
  if (specifier.startsWith("@/")) {
    const rest = clean(specifier.slice(2));
    if (rest === "types" || rest.startsWith("types/")) {
      return LEGACY_CORE_PREFIX + rest;
    }
    return `${LEGACY_CORE_PREFIX}ui/${rest}`;
  }
  const relative = /^(?:\.\.\/)+src\/(ui|types)(\/.*)?$/.exec(specifier);
  if (relative) {
    return LEGACY_CORE_PREFIX + clean(`${relative[1]}${relative[2] ?? ""}`);
  }
  return null;
}

/**
 * Every value import in a source file that names a legacy core module.
 * Type-only imports are skipped: they are erased and never reach the map.
 */
export function findLegacyCoreImports(source) {
  const found = new Set();
  const patterns = [
    /^\s*(?:import|export)\s+(?!type\s)[^'";]*?\sfrom\s+["']([^"']+)["']/gm,
    /^\s*import\s+["']([^"']+)["']/gm,
    /import\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const normalized = legacyCoreSpecifier(match[1]);
      if (normalized) found.add(normalized);
    }
  }
  return found;
}
