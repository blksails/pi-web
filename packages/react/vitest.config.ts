import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    // 同 packages/ui:jsdom + SSE mock 的 e2e 用例在全量并发下会撞破默认 5s(prompt-stream
    // e2e 实测单跑 1.5s / 全量超时),放宽以消除负载假红。
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
