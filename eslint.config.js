import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "test-results/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: { globals: globals.browser },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["error", "warn"] }],
    },
  },
  {
    files: ["scripts/**/*.mjs", "tests/**/*.{ts,mjs}", "*.{js,ts}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
