import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/build/**", "android/**", "desktop/out/**"] },
  ...tseslint.configs.recommended,
  { rules: { "no-eval": "error", "no-new-func": "error", "no-implied-eval": "error" } },
);
