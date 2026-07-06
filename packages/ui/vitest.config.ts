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
      // canvas-kit 主入口(client-image-ops 转发层/组件类型 canonical 家的上游)。
      "@blksails/pi-web-canvas-kit": path.resolve(__dirname, "../canvas-kit/src/index.ts"),
      // primitives 主入口(src/ui 六组件 + lib/cn 转发层的上游)。
      "@blksails/pi-web-primitives": path.resolve(__dirname, "../primitives/src/index.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
  },
});
