import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config for app integration + page-render tests.
 *
 * `jsdom` for RTL page-render smoke; resolves `@/` and the raw-TS `@pi-web/*`
 * packages (the `.js` import specifiers map to `.ts` via vitest's resolver).
 */
export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "@pi-web/logger": path.resolve(__dirname, "packages/logger/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["test/setup.ts"],
  },
});
