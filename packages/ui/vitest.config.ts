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
      // canvas-ui 主入口(src/canvas 8 转发文件的上游,canvas 领域组件新家)。
      "@blksails/pi-web-canvas-ui": path.resolve(__dirname, "../canvas-ui/src/index.ts"),
      // primitives 主入口(src/ui 六组件 + lib/cn 转发层的上游)。
      "@blksails/pi-web-primitives": path.resolve(__dirname, "../primitives/src/index.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    // ★超时放宽(不是掩盖失败,是消除假红):本包用例几乎全是 RTL + userEvent 的富交互装配,
    // 单跑一个文件 ~1.2s,但全量并发下同一文件要 75s——jsdom 环境准备与 userEvent 的
    // advanceTimers 在 CPU 争抢下极易撞破 vitest 默认 5s,实测同一批用例两次全量分别红
    // 55/36 个而单跑全绿。默认值对本包没有诊断价值,真错误表现为断言失败而非超时。
    // 60s 而非 30s:队列/e2e 那几个最重的装配用例在满负载全量里实测 36~54s(单跑 1~2s),
    // 30s 仍会假红。真正的失败在本包表现为断言错误,不会撞这个上限。
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
