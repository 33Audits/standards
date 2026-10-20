import eslint from "@eslint/js";
import prettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import tseslint from "typescript-eslint";

// Mirrors the Banned column in AGENTS.md — change both together.
const banned = [
  { name: "typeorm", message: "Use Prisma." },
  { name: "sequelize", message: "Use Prisma." },
  { name: "mongoose", message: "Use Prisma." },
  { name: "knex", message: "Use Prisma, or raw pg where Prisma cannot express it." },
  { name: "moment", message: "Use date-fns." },
  { name: "dayjs", message: "Use date-fns." },
  { name: "yup", message: "Use zod." },
  { name: "joi", message: "Use zod." },
];

// Type-aware rules need the repo's own tsconfig, so this is a factory:
//   export default backend({ tsconfigRootDir: import.meta.dirname });
export default function backend({ tsconfigRootDir }) {
  return tseslint.config(
    { ignores: ["eslint.config.mjs", "dist/**"] },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    prettier,
    {
      languageOptions: {
        globals: { ...globals.node, ...globals.jest },
        sourceType: "commonjs",
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/no-unsafe-argument": "error",
        "no-console": "error",
        "no-restricted-imports": ["error", { paths: banned }],
        "prettier/prettier": ["error", { endOfLine: "auto" }],
      },
    },
    {
      // Test doubles are `any` by construction; keep them visible, not blocking.
      files: ["**/*.spec.ts", "test/**/*.ts"],
      rules: {
        "@typescript-eslint/no-explicit-any": "warn",
        "@typescript-eslint/no-unsafe-argument": "warn",
        "@typescript-eslint/no-unsafe-assignment": "warn",
        "@typescript-eslint/no-unsafe-member-access": "warn",
        "@typescript-eslint/no-unsafe-return": "warn",
        "@typescript-eslint/no-unsafe-call": "warn",
      },
    },
  );
}
