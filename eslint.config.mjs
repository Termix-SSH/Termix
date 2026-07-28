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
]);
