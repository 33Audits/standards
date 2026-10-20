import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Mirrors the Banned column in AGENTS.md — change both together.
const banned = [
  { name: "moment", message: "Use date-fns." },
  { name: "dayjs", message: "Use date-fns." },
  { name: "yup", message: "Use zod." },
  { name: "react-hot-toast", message: "Use sonner." },
  { name: "react-toastify", message: "Use sonner." },
  { name: "redux", message: "Use context, or zustand for shared client state." },
  { name: "@reduxjs/toolkit", message: "Use context, or zustand for shared client state." },
];

// Already in use somewhere: warn so existing repos keep building while they migrate.
// A separate rule name lets these run at a different severity from `banned`.
const migrating = [
  { name: "framer-motion", message: "Renamed upstream. Import from motion/react." },
];
const migratingPatterns = [
  { group: ["react-icons", "react-icons/*"], message: "Use the repo's icon set: Phosphor or Tabler." },
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-imports": ["error", { paths: banned }],
      "@typescript-eslint/no-restricted-imports": [
        "warn",
        { paths: migrating, patterns: migratingPatterns },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
