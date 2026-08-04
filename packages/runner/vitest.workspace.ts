/**
 * runner 包的测试分档。四档定义与判据**与内核包、兼容层包完全同形**
 * (spec: runner-package-extraction,任务 1.2)。
 *
 *   fast       裸 `*.test.ts`        纯逻辑;线程池 + 关隔离 + 运行期哨兵;目标 < 10s
 *   fast-mock  `*.mock.test.ts`      用 `vi.mock` 的快档测试;需保留模块隔离
 *   it         `*.it.test.ts`        起子进程 / 写真实 fs / 发本地网络;由运行脚本**串行**跑
 *   e2e        `*.e2e.test.ts`       整文件被外部服务凭据门控;**不进默认路径**
 *
 * ★ 改本文件前先读 `../server/vitest.workspace.ts` 的文件头四条实测教训 —— 那份是原本,
 *   本文件是同形副本。四条里最要命的两条在这里同样成立:
 *   ① `fileParallelism` / `isolate` 写在 project 级会被 vitest 2.1.9 **忽略**,必须走 CLI;
 *   ② 本文件存在时,根级 `setupFiles` 被完全忽略,故必须写在每个 project 里
 *      —— 哨兵没装上时的「零违规」,和真的没有违规长得一模一样。
 */
import { fileURLToPath } from "node:url";

/**
 * ★ 两个 setup 共享件住在 **core 包**(spec: core-package-extraction,任务 2.1),
 *   runner 与兼容层一样跨包引用它 —— core 是更低的包,方向正确;反过来会让 core 的
 *   测试依赖 runner。改路径时注意:setup 文件必须用**绝对路径**,相对路径会被解析到
 *   本包根下而静默指空 —— 而没装上的哨兵报出的绿,和真的没有违规长得一模一样。
 */
const childProcessGuard = fileURLToPath(
  new URL("../core/test/setup/child-process-guard.ts", import.meta.url),
);
const fastSentinel = fileURLToPath(new URL("../core/test/setup/fast-sentinel.ts", import.meta.url));

const base = { environment: "node", testTimeout: 30_000 } as const;
const commonExclude = ["**/node_modules/**", "**/dist/**"];

/** 见 `../server/vitest.workspace.ts`:用别名而非改写命名空间,ESM 具名导入改写拦不住。 */
const fastAlias = {
  alias: { "node:child_process": childProcessGuard, child_process: childProcessGuard },
} as const;

export default [
  {
    resolve: fastAlias,
    test: {
      ...base,
      name: "fast",
      include: ["test/**/*.test.ts"],
      exclude: [
        ...commonExclude,
        "test/**/*.it.test.ts",
        "test/**/*.mock.test.ts",
        "test/**/*.e2e.test.ts",
      ],
      pool: "threads",
      // isolate 见文件头 ① —— 必须由 CLI `--no-isolate` 传入,写在这里无效。
      setupFiles: [fastSentinel],
    },
  },
  {
    resolve: fastAlias,
    test: {
      ...base,
      name: "fast-mock",
      include: ["test/**/*.mock.test.ts"],
      exclude: commonExclude,
      pool: "threads",
      setupFiles: [fastSentinel],
    },
  },
  {
    test: { ...base, name: "it", include: ["test/**/*.it.test.ts"], exclude: commonExclude },
  },
  {
    test: { ...base, name: "e2e", include: ["test/**/*.e2e.test.ts"], exclude: commonExclude },
  },
];
