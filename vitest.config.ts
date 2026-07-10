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
      "@blksails/pi-web-tool-kit/aigc-canvas-schema": path.resolve(__dirname, "packages/tool-kit/src/aigc/canvas/schema.ts"),
      "@blksails/pi-web-tool-kit/commands": path.resolve(__dirname, "packages/tool-kit/src/commands/index.ts"),
      "@blksails/pi-web-tool-kit/extension-entry": path.resolve(__dirname, "packages/tool-kit/src/extension-tools/entry-path.ts"),
      "@blksails/pi-web-tool-kit/auto-title-entry": path.resolve(__dirname, "packages/tool-kit/src/auto-title/entry-path.ts"),
      "@blksails/pi-web-tool-kit": path.resolve(__dirname, "packages/tool-kit/src/index.ts"),
      // webext-registry 静态载入 examples 的 .pi/web:stickers.tsx 直连 canvas-kit(非根声明依赖,
      // Next 走 tsconfig paths 可解析,vitest 不读 paths 须显式 alias);canvas-ui 同规则对齐。
      "@blksails/pi-web-canvas-kit": path.resolve(__dirname, "packages/canvas-kit/src/index.ts"),
      "@blksails/pi-web-canvas-ui": path.resolve(__dirname, "packages/canvas-ui/src/index.ts"),
      // cli-package-commands:越仓 registry 客户端(源码 alias 指向兄弟仓)+ 契约夹具(/testing)。
      // 注意子路径 alias 须在裸包名**之前**匹配,故 /testing 先列。
      "@pi-clouds/registry-client/testing": path.resolve(__dirname, "../pi-clouds/packages/registry-client/src/testing/index.ts"),
      "@pi-clouds/registry-client": path.resolve(__dirname, "../pi-clouds/packages/registry-client/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["test/setup.ts"],
  },
});
