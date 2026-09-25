import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";
import { globalIgnores } from "eslint/config";
import path from "node:path";

// A plugin may import @termix/plugin-sdk, npm packages and its own files.
// A relative path that climbs out of plugins/<id>/ reaches core or another
// plugin, and "@/..." is core's alias.
const pluginBoundary = {
  rules: {
    "stay-inside": {
      meta: {
        type: "problem",
        messages: {
          core: "A plugin reaches core only through @termix/plugin-sdk. Use an SDK API, or add one.",
          outside:
            "A plugin cannot import files outside its own folder. Use the SDK, ctx.services, events, actions or slots.",
        },
      },
      create(context) {
        const file = context.filename.replace(/\\/g, "/");
        const root = /^(.*\/plugins\/[^/]+)\//.exec(file)?.[1];
        const check = (node, source) => {
          if (typeof source !== "string") return;
          if (source === "@" || source.startsWith("@/")) {
            context.report({ node, messageId: "core" });
            return;
          }
          if (!root || !source.startsWith(".")) return;
          const target = path.posix.normalize(
            path.posix.join(path.posix.dirname(file), source),
          );
          if (target !== root && !target.startsWith(`${root}/`)) {
            context.report({ node, messageId: "outside" });
          }
        };
        return {
          ImportDeclaration: (node) => check(node, node.source.value),
          ExportNamedDeclaration: (node) => check(node, node.source?.value),
          ExportAllDeclaration: (node) => check(node, node.source.value),
          ImportExpression: (node) => check(node, node.source.value),
        };
      },
    },
  },
};

export default tseslint.config([
  globalIgnores([
    "**/dist",
    "release",
    "Mobile",
    "src/mcp-server/node_modules",
  ]),
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
    // runtime in src/backend/plugins/, which handles absence. Core tests only
    // use fixture plugins.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/plugins/*/src/backend/**"],
              message:
                "Core must not import a plugin backend. Go through the plugin runtime, so disabling the plugin degrades cleanly.",
            },
          ],
        },
      ],
    },
  },
  {
    // The shell never imports a plugin. It reaches plugins only through the
    // registries their frontends fill via the app object (A7). This block
    // also carries the backend rule for src/ui files, because flat config
    // replaces a rule's options rather than merging them.
    files: ["src/ui/**/*.{ts,tsx}", "src/main.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/plugins/*/src/**", "**/plugins/*/dist/**"],
              message:
                "The shell does not import plugins. Register the surface through the app object and read it from a registry.",
            },
          ],
        },
      ],
    },
  },
  {
    // The other direction. A plugin reaches core only through
    // @termix/plugin-sdk, and never reaches into another plugin's source.
    files: ["plugins/*/src/**/*.{ts,tsx,mjs}", "plugins/*/tests/**/*.{ts,tsx}"],
    plugins: { "termix-plugins": pluginBoundary },
    rules: {
      "termix-plugins/stay-inside": "error",
    },
  },
]);
