import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/migrations/**", "backups/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Service worker: roda fora da página, com globais próprias.
    files: ["apps/web/public/sw.js"],
    languageOptions: { globals: { self: "readonly", caches: "readonly", fetch: "readonly", URL: "readonly", Response: "readonly" } },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly", URL: "readonly", Buffer: "readonly" } },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": true }],
    },
  },
);
