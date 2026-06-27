import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config for app integration + page-render tests.
 *
 * `jsdom` for RTL page-render smoke; resolves `@/` and the raw-TS `@blksails/pi-web-*`
 * packages (the `.js` import specifiers map to `.ts` via vitest's resolver).
 */
export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "@blksails/pi-web-logger": path.resolve(__dirname, "packages/logger/src/index.ts"),
      "@blksails/pi-web-agent-kit": path.resolve(__dirname, "packages/agent-kit/src/index.ts"),
      "@blksails/pi-web-tool-kit/commands": path.resolve(__dirname, "packages/tool-kit/src/commands/index.ts"),
      "@blksails/pi-web-tool-kit/extension-entry": path.resolve(__dirname, "packages/tool-kit/src/extension-tools/entry-path.ts"),
      "@blksails/pi-web-tool-kit": path.resolve(__dirname, "packages/tool-kit/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["test/setup.ts"],
  },
});
