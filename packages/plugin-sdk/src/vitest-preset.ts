/**
 * The vitest config every plugin uses.
 *
 * A plugin's vitest.config.ts is one line:
 *
 *   import { pluginVitestConfig } from "@termix-ssh/plugin-sdk/vitest-preset";
 *   export default pluginVitestConfig(import.meta.url);
 *
 * Two projects: tests/backend runs in node, tests/frontend in jsdom.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Walks up from a plugin directory to a Termix checkout, if it is in one.
 *
 * Inside the repo the SDK's browser entries and the test host resolve to
 * core's source, so a test exercises the real registries. Outside it they
 * resolve to the builds the SDK ships in dist/host.
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

/**
 * termix-plugin build turns a .wasm or font import into its bytes. Tests get the same,
 * so code that imports a module compiles it the same way under vitest.
 */
export function wasmBinaryPlugin() {
  return {
    name: "termix-wasm-binary",
    enforce: "pre" as const,
    load(id: string) {
      const file = id.split("?")[0];
      if (![".wasm", ".ttf", ".otf"].some((ext) => file.endsWith(ext))) {
        return null;
      }
      const base64 = fs.readFileSync(file).toString("base64");
      return `export default new Uint8Array(Buffer.from(${JSON.stringify(base64)}, "base64"));`;
    },
  };
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
  const manifestPath = path.join(pluginDir, "manifest.json");
  const pluginId: string =
    (fs.existsSync(manifestPath) &&
      JSON.parse(fs.readFileSync(manifestPath, "utf8")).id) ||
    path.basename(pluginDir);
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
          "@termix-ssh/plugin-sdk/frontend": path.join(
            repoRoot,
            "packages",
            "plugin-sdk",
            "src",
            "frontend.ts",
          ),
          "@termix-ssh/plugin-sdk/ui": path.join(
            repoRoot,
            "src",
            "ui",
            "plugin-host",
            "sdk-ui.ts",
          ),
          "@termix-ssh/plugin-host/testing": path.join(
            repoRoot,
            "src",
            "ui",
            "plugin-host",
            "testing-host.tsx",
          ),
          // Core's own modules behind sdk-ui and the test host import each
          // other this way. Plugin code may not (eslint refuses it).
          "@/types": path.join(repoRoot, "src", "types"),
          "@": path.join(repoRoot, "src", "ui"),
        }
      : {
          // Outside a Termix checkout: the UI kit resolves through the
          // package, and the test host is the copy the SDK ships.
          "@termix-ssh/plugin-host/testing": fileURLToPath(
            new URL("./host/testing-host.js", import.meta.url),
          ),
        }),
    ...options.alias,
  };

  // Forks workers on Windows abort now and then with "Worker exited
  // unexpectedly". Threads don't.
  const pool = "threads" as const;

  const plugins = [wasmBinaryPlugin()];

  return {
    plugins,
    resolve: { alias },
    test: {
      globals: true,
      setupFiles: [setupFile],
      pool,
      projects: [
        {
          plugins,
          resolve: { alias },
          test: {
            name: `${pluginId}:backend`,
            root: pluginDir,
            environment: "node",
            pool,
            globals: true,
            setupFiles: [setupFile],
            include: ["tests/backend/**/*.test.ts"],
          },
        },
        {
          plugins,
          resolve: { alias },
          test: {
            name: `${pluginId}:frontend`,
            root: pluginDir,
            environment: "jsdom",
            pool,
            globals: true,
            setupFiles: [setupFile],
            // Run the SDK through Vite rather than plain Node, so its import
            // of the test host sees the alias above and the plugin and the
            // host share one copy of @termix-ssh/plugin-sdk/frontend.
            server: { deps: { inline: [/@termix-ssh\/plugin-sdk/] } },
            include: ["tests/frontend/**/*.test.{ts,tsx}"],
          },
        },
      ],
    },
  };
}
