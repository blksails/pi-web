/**
 * 把 `test/integration/**`(真实 spawn 子进程的集成测试)与其余单测拆成两个 project,
 * 前者禁用文件级并行。
 *
 * 起因:9 个集成测试文件各自 spawn 真实 agent 子进程,而根 vitest 配置未限并发,
 * 默认吃满全部核心 —— 263 个文件一起跑时子进程互相饿死,会话就绪从常态 ~4.3s
 * 被拖过 `DEFAULT_READINESS_PROBE_TIMEOUT_MS`(30s,pi-session.ts:156),会话直接
 * 落 error{probe-timeout},测试再空等到自己的 40s 死线才报 "Timed out waiting for…"。
 * 表现为随机某个集成文件变红(谁先撞破自己的死线是随机的),孤立跑必绿。
 *
 * ★ 不采用「继续调大超时」:这些用例已是 waitFor 40s / testTimeout 50s 仍失败,
 * 说明阈值不是瓶颈;而探针的 30s 是产品语义(真实会话超 30s 未就绪本就该报错),
 * 为迁就测试放宽会掩盖真实退化。故治并发,不治数字。
 *
 * 保持单次 `vitest run` 调用(而非串两条命令),使既有
 * `pnpm --filter @blksails/pi-web-server test -- --run <pattern>` 过滤用法不受影响。
 */
// ★ 不用 `extends: "./vitest.config.ts"`:实测(vitest 2.1.9)基础配置的 include
// 会被并入 project,导致 integration project 把全部 263 个文件都当集成测试再跑一遍
// (517 文件 / 4479 用例)。故此处内联基础项,两个 project 的 include 各自独立。
const base = { environment: "node", testTimeout: 30_000 } as const;

export default [
  {
    test: {
      ...base,
      name: "unit",
      include: ["test/**/*.test.ts"],
      exclude: ["**/node_modules/**", "**/dist/**", "test/integration/**"],
    },
  },
  {
    test: {
      ...base,
      name: "integration",
      include: ["test/integration/**/*.test.ts"],
      exclude: ["**/node_modules/**", "**/dist/**"],
      // 集成文件之间串行:每个文件仍在独立 worker 中隔离(避免 globalThis 上的
      // handler 单例跨文件泄漏),但同一时刻只跑一个,不再互相抢 CPU。
      fileParallelism: false,
    },
  },
];
