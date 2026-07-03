import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // canvas 纯 schema 子路径(浏览器安全,无 pi 值导入);vite 不解析工作区子路径 exports,
      // 显式别名到源文件(既有坑:漏 alias 害集成测试全崩)。
      "@blksails/pi-web-tool-kit/aigc-canvas-schema": path.resolve(
        __dirname,
        "../tool-kit/src/aigc/canvas/schema.ts",
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
  },
});
