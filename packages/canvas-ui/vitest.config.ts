import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // 与包 tsconfig(jsx: react-jsx)/web-kit build(jsx: automatic)/根 vitest 配置对齐;
  // vitest 的 esbuild 缺省是 classic runtime,首个 .tsx 测试(examples 组件包挂载)即暴露
  // "React is not defined"。
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      // canvas 纯 schema 子路径(浏览器安全,无 pi 值导入);vite 不解析工作区子路径 exports,
      // 显式别名到源文件(既有坑:漏 alias 害集成测试全崩;条目须先于任何同前缀主入口)。
      "@blksails/pi-web-tool-kit/aigc-canvas-schema": path.resolve(
        __dirname,
        "../tool-kit/src/aigc/canvas/schema.ts",
      ),
      // canvas-kit 主入口(client-image-ops 转发层/组件类型 canonical 家的上游)。
      "@blksails/pi-web-canvas-kit": path.resolve(__dirname, "../canvas-kit/src/index.ts"),
      // primitives 主入口(六薄封装 + cn 的新家,组件 import 改线后的目标)。
      "@blksails/pi-web-primitives": path.resolve(__dirname, "../primitives/src/index.ts"),
      // web-kit 主入口(WebExtSurfaceAccess/WebExtStateAccess/SurfaceOp 等跨包契约)。
      "@blksails/pi-web-kit": path.resolve(__dirname, "../web-kit/src/index.ts"),
      // react 包主入口(useConversationBridge 会话桥)。
      "@blksails/pi-web-react": path.resolve(__dirname, "../react/src/index.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
  },
});
