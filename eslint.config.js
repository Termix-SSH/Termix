import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist", 
      "build", 
      "node_modules", 
      "electron-dist", 
      "public/**/*.js" // Ignore minified/worker scripts in public
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,cjs,mjs}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2020,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-empty": "off",
      "no-undef": "off", // Usually handled better by TypeScript itself
      
      "react-refresh/only-export-components": "off",
      "no-case-declarations": "off",
      "prefer-const": "off",                
      "no-async-promise-executor": "off",   
      "react-hooks/rules-of-hooks": "error", 
      "react-hooks/exhaustive-deps": "off", 
      "@typescript-eslint/no-unused-expressions": "off",
      "no-constant-binary-expression": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off"
    },
  }
);