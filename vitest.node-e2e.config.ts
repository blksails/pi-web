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
      // tool-kit 子路径导出指向 .ts 源(无 dist);vite 不解析工作区子路径 exports,
      // 显式别名到源文件(否则 pi-handler 经子路径 import 时 handler 集成测试全崩)。
      "@blksails/pi-web-tool-kit/extension-entry": path.resolve(
        __dirname,
        "packages/tool-kit/src/extension-tools/entry-path.ts",
      ),
      "@blksails/pi-web-tool-kit/auto-title-entry": path.resolve(
        __dirname,
        "packages/tool-kit/src/auto-title/entry-path.ts",
      ),
      "@blksails/pi-web-tool-kit/commands": path.resolve(
        __dirname,
        "packages/tool-kit/src/commands/index.ts",
      ),
      "@blksails/pi-web-tool-kit/runtime": path.resolve(
        __dirname,
        "packages/tool-kit/src/runtime.ts",
      ),
      "@blksails/pi-web-tool-kit/aigc-canvas-schema": path.resolve(
        __dirname,
        "packages/tool-kit/src/aigc/canvas/schema.ts",
      ),
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
