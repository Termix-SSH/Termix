/**
 * The vitest config every plugin uses.
 *
 * A plugin's vitest.config.ts is one line:
 *
 *   import { pluginVitestConfig } from "@termix/plugin-sdk/vitest-preset";
 *   export default pluginVitestConfig(import.meta.url);
 *
 * Two projects, matching the layout in ARCHITECTURE.md: tests/backend runs in
 * node, tests/frontend in jsdom.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Walks up from a plugin directory to the repo that holds src/ui.
 *
 * Plugin frontends and their tests still reach core through the "@/" alias
 * (the legacy debt A7 and D1 remove), so the preset has to resolve it. A
 * plugin developed outside this repo has no src/ui to point at, which is
 * exactly right: the alias stops resolving and the import fails loudly.
 */
function findRepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, "src", "ui"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export interface PluginVitestOptions {
  /** Extra aliases merged over the defaults. */
  alias?: Record<string, string>;
}

export function pluginVitestConfig(
  configUrl: string,
  options: PluginVitestOptions = {},
) {
  const pluginDir = path.dirname(fileURLToPath(configUrl));
  const pluginId = path.basename(pluginDir);
  const setupFile = fileURLToPath(
    new URL("./testing/setup.js", import.meta.url),
  );

  const repoRoot = findRepoRoot(pluginDir);
  // Inside a Termix checkout the SDK's browser entries resolve to source and
  // the test host is core's, so renderWithApp exercises the real registries
  // and the plugin shares one SDK instance with them.
  const alias: Record<string, string> = {
    ...(repoRoot
      ? {
          "@termix/plugin-sdk/frontend": path.join(
            repoRoot,
            "packages",
            "plugin-sdk",
            "src",
            "frontend.ts",
          ),
          "@termix/plugin-sdk/ui": path.join(
            repoRoot,
            "src",
            "ui",
            "plugin-host",
            "sdk-ui.ts",
          ),
          "@termix/plugin-host/testing": path.join(
            repoRoot,
            "src",
            "ui",
            "plugin-host",
            "testing-host.tsx",
          ),
          "@/types": path.join(repoRoot, "src", "types"),
          "@": path.join(repoRoot, "src", "ui"),
        }
      : {}),
    ...options.alias,
  };

  return {
    resolve: { alias },
    test: {
      globals: true,
      setupFiles: [setupFile],
      projects: [
        {
          resolve: { alias },
          test: {
            name: `${pluginId}:backend`,
            root: pluginDir,
            environment: "node",
            globals: true,
            setupFiles: [setupFile],
            include: ["tests/backend/**/*.test.ts"],
          },
        },
        {
          resolve: { alias },
          test: {
            name: `${pluginId}:frontend`,
            root: pluginDir,
            environment: "jsdom",
            globals: true,
            setupFiles: [setupFile],
            include: ["tests/frontend/**/*.test.{ts,tsx}"],
          },
        },
      ],
    },
  };
}
