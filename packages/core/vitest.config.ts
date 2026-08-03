import { defineConfig } from "vitest/config";

/**
 * ★ 这个文件**必须存在**,哪怕内容看起来是多余的(与 `../server/vitest.config.ts` 同形)。
 *
 * 包内没有 `vitest.config.ts` 时,vitest 会向上找到**仓库根**的配置并套用它 ——
 * 根配置是给 app 层准备的(jsdom + `test/setup.ts` + 根 include),落到本包上的表现是
 * 「No test files found」。实测踩到:分档机制刚搬进 core 时,9 个测试文件明明躺在
 * `test/tiering/` 却一个都跑不到。
 *
 * 档位划分不在这里,在 `vitest.workspace.ts`(按文件名后缀)。
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
  },
});
