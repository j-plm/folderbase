import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "node_modules"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Swallowing bad localStorage JSON is intentional
      "no-empty": ["error", { allowEmptyCatch: true }],
      // tsc already enforces noUnusedLocals / noUnusedParameters
      "@typescript-eslint/no-unused-vars": "off",
      // All invoke() calls go through src/lib/commands.ts
      "no-restricted-imports": ["error", {
        paths: [{
          name: "@tauri-apps/api/core",
          importNames: ["invoke"],
          message: "Call Rust through src/lib/commands.ts, not invoke() directly.",
        }],
      }],
      // Platform detection lives in src/lib/platform.ts
      "no-restricted-properties": ["error",
        { object: "navigator", property: "platform", message: "Use src/lib/platform.ts." },
        { object: "navigator", property: "userAgent", message: "Use src/lib/platform.ts." },
      ],
    },
  },
  { files: ["src/lib/commands.ts"], rules: { "no-restricted-imports": "off" } },
  { files: ["src/lib/platform.ts"], rules: { "no-restricted-properties": "off" } },
);
