import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Vendored component libraries (Untitled UI via `untitledui add`, ElevenLabs UI via `shadcn add`).
  // Kept close to upstream so they can be re-synced; app code stays under the full rule set.
  {
    files: [
      "src/components/base/**",
      "src/components/foundations/**",
      "src/components/shared-assets/**",
      "src/components/ui/**",
    ],
    rules: {
      "@next/next/no-img-element": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "storage/**", "drizzle/**"]),
]);

export default eslintConfig;
