import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";
import { globalIgnores } from "eslint/config";

export default tseslint.config([
  globalIgnores(["dist", "release", "Mobile", "src/mcp-server/node_modules"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      "react-hooks": reactHooks,
      "unused-imports": unusedImports,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "no-empty": "warn",
      "no-control-regex": "off",
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-refresh/only-export-components": "warn",
    },
  },
  {
    // MySQL has no RETURNING clause, and drizzle's mysql-core does not expose
    // the method at all — a bare .returning() is a TypeError there, not a bad
    // query, and it only fails on the engine no test in this repo runs against.
    //
    // 175 call sites were migrated off it. This is what stops number 176.
    // Writes that need rows back go through repositories/returning.ts, which
    // picks one statement or a read-then-write transaction per dialect.
    files: ["src/backend/database/repositories/**/*.ts"],
    ignores: [
      // The two files whose job is to absorb these differences.
      "src/backend/database/repositories/returning.ts",
      "src/backend/database/repositories/mutation-result.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='returning']",
          message:
            "MySQL has no RETURNING. Use insertReturning/updateReturning/deleteReturning from ./returning.js, or rowsAffected() if you only need a count. Inside a proven sqlite-only branch, disable this rule with a comment saying so.",
        },
        {
          // `||` concatenates on SQLite and Postgres. On MySQL it is logical OR
          // unless the server runs with PIPES_AS_CONCAT, so a folder path built
          // this way silently became 0. Use CONCAT, which all three agree on.
          selector:
            "TaggedTemplateExpression[tag.name='sql'] TemplateElement[value.raw=/\\|\\|/]",
          message:
            "`||` is logical OR on MySQL, not concatenation. Use CONCAT(...).",
        },
        {
          // Postgres and SQLite spell it ON CONFLICT; MySQL spells it ON
          // DUPLICATE KEY and names no columns, so drizzle's mysql-core has no
          // onConflictDoUpdate at all — another TypeError, not a bad query.
          selector: "CallExpression[callee.property.name='onConflictDoUpdate']",
          message:
            "MySQL has no ON CONFLICT. Use upsert() from ./returning.js.",
        },
        {
          // better-sqlite3 puts these on a write result; node-postgres and
          // mysql2 do not, so reading them directly yields undefined — and
          // Number(undefined) is NaN, which reaches the database as the string
          // "NaN" and fails an integer column. Three call sites did exactly
          // this and only broke on Postgres.
          selector:
            "MemberExpression[property.name=/^(lastInsertRowid|changes)$/]",
          message:
            "lastInsertRowid and changes are better-sqlite3 only. Use insertedId() or rowsAffected() from ./mutation-result.js.",
        },
      ],
    },
  },
  {
    // Core must not reach into a plugin. A plugin can be disabled, upgraded
    // or removed, so an import from core turns "disabled" into a broken
    // build rather than a missing feature. Core talks to plugins through the
    // runtime in src/backend/plugins/ and the dispatchers in
    // database/routes/*-dispatch.ts, both of which handle absence.
    //
    // Tests are exempt: they import a plugin's modules on purpose to test
    // them, and until A2 gives each plugin its own suite they live under
    // src/*/tests/plugins/.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/tests/**"],
    rules: {
      // An error for the backend, which has dispatchers to register through
      // and no remaining offenders.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/plugins/*/backend/**"],
              message:
                "Core must not import a plugin backend. Register a dispatcher or an SDK service instead, so disabling the plugin degrades cleanly.",
            },
          ],
        },
      ],
    },
  },
  {
    // The shell still imports plugin components directly (the terminal tab,
    // the Guacamole app, the Proxmox dialog). There is no frontend plugin
    // loader yet, so there is nothing to move them to: A7 builds the app
    // object that registers these surfaces and this becomes an error.
    files: ["src/ui/**/*.{ts,tsx}"],
    ignores: ["src/ui/tests/**"],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            {
              group: ["**/plugins/*/frontend/**"],
              message:
                "The shell should not import plugin components directly. A7 replaces these with registrations through the app object.",
            },
          ],
        },
      ],
    },
  },
  {
    // The other direction. A plugin is supposed to talk to core only through
    // @termix/plugin-sdk, which is the contract D1 finishes enforcing.
    //
    // Only the backend is fenced today. Plugin backends reach core by
    // relative path (../../../src/backend/...) and plugin frontends use the
    // "@/" alias for shared UI, both of which are the "legacy core imports"
    // debt recorded in packages/plugin-sdk/ARCHITECTURE.md: the SDK does not
    // yet expose the SSH pool, host resolution, repositories or the
    // component library. A7 moves the frontends onto the app object and D1
    // moves the backends onto SDK APIs, and this rule tightens to match.
    //
    // What it already catches: a plugin backend importing the frontend tree,
    // which is not debt in any direction, just a mistake.
    files: ["plugins/**/backend/**/*.{ts,mjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*", "**/src/ui/**"],
              message:
                "A plugin backend cannot import frontend code. Import from @termix/plugin-sdk, or use a relative path within the plugin.",
            },
          ],
        },
      ],
    },
  },
]);
