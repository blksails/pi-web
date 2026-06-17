import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Node-level e2e config — drives the real createPiWebHandler over HTTP/SSE in a
 * Node environment (no browser). Proves the full streaming chain offline when
 * the browser-level Playwright run is blocked.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["e2e/node/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
