import fs from "fs";
import path from "path";
import { defineConfig, type Plugin } from "vitest/config";

/**
 * The built plugin bundles the boot tests load (dist/plugins) still reach
 * compiled core by relative path for a few plugins. Point those imports at
 * core's source, so the bundle shares the one database and the singletons the
 * test booted instead of loading a second, uninitialized copy of core.
 */
function builtPluginCoreImports(): Plugin {
  return {
    name: "built-plugin-core-imports",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !source.startsWith(".")) return null;
      if (!importer.replace(/\\/g, "/").includes("/dist/plugins/")) return null;
      const target = path
        .resolve(path.dirname(importer), source)
        .replace(/\\/g, "/");
      const match = /\/dist\/backend\/(backend|types)\/(.*)\.js$/.exec(target);
      if (!match) return null;
      const base = path.resolve(__dirname, "src", match[1], match[2]);
      for (const candidate of [`${base}.ts`, `${base}.tsx`]) {
        if (fs.existsSync(candidate)) return candidate;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [builtPluginCoreImports()],
  resolve: {
    alias: [
      {
        find: "@termix/plugin-sdk/frontend",
        replacement: path.resolve(
          __dirname,
          "./packages/plugin-sdk/src/frontend.ts",
        ),
      },
      {
        find: "@termix/plugin-sdk/ui",
        replacement: path.resolve(__dirname, "./src/ui/plugin-host/sdk-ui.ts"),
      },
      {
        find: "@termix/plugin-host/testing",
        replacement: path.resolve(
          __dirname,
          "./src/ui/plugin-host/testing-host.tsx",
        ),
      },
      // What built plugin frontends import instead of "@/...". D1 removes it.
      {
        find: /^@termix\/legacy-core\/ui\/(.*)$/,
        replacement: path.resolve(__dirname, "./src/ui") + "/$1",
      },
      {
        find: /^@termix\/legacy-core\/types(.*)$/,
        replacement: path.resolve(__dirname, "./src/types") + "$1",
      },
      { find: "@/types", replacement: path.resolve(__dirname, "./src/types") },
      { find: "@", replacement: path.resolve(__dirname, "./src/ui") },
    ],
  },
  test: {
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/coverage/**",
        "electron/**",
        "scripts/**",
        "**/*.config.*",
        "**/*.test.{ts,tsx}",
        "src/backend/test-helpers/**",
        "src/ui/locales/**",
      ],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "backend",
          environment: "node",
          include: ["src/backend/**/*.test.ts"],
          // The repository tests can be pointed at a real Postgres or MySQL
          // (TEST_DIALECT). Connecting, migrating and clearing tables between
          // tests costs seconds there, against microseconds for in-memory
          // SQLite, so the default timeout only fits the SQLite run.
          testTimeout: process.env.TEST_DIALECT ? 60_000 : 5_000,
          hookTimeout: process.env.TEST_DIALECT ? 60_000 : 10_000,
        },
      },
      {
        extends: true,
        test: {
          name: "frontend",
          environment: "jsdom",
          include: ["src/ui/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "scripts",
          environment: "node",
          include: ["scripts/**/*.test.ts"],
        },
      },
    ],
  },
});
