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
