import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@/types": path.resolve(__dirname, "./src/types"),
      "@": path.resolve(__dirname, "./src/ui"),
    },
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
