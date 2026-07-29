/**
 * 测试分档(spec: test-tiering-fast-lane)。四档,**按文件名后缀**划分,不按目录。
 *
 *   fast       裸 `*.test.ts`        纯逻辑;线程池 + 关隔离 + 运行期哨兵;目标 < 10s
 *   fast-mock  `*.mock.test.ts`      用 `vi.mock` 的快档测试;需保留模块隔离
 *   it         `*.it.test.ts`        起子进程 / 写真实 fs / 发本地网络;由运行脚本**串行**跑
 *   e2e        `*.e2e.test.ts`       整文件被外部服务凭据门控;**不进默认路径**
 *
 * 为什么改成按后缀:改造前按目录切(`test/integration/**` vs 其余),而重量不按目录分布 ——
 * 25 个真实 spawn 子进程的文件散在 "unit" 档里,名字甚至已挂着 `.integration` / `.e2e` 后缀。
 * 结果是看名字判断不了它在哪档跑,新加的重测试也没有机制拦住。原起因(子进程互相饿死 →
 * 会话就绪拖过 30s 探针 → 随机某个文件变红、孤立跑必绿)在 it 档继续由**串行**解决。
 *
 * ★ 四条实测教训,改本文件前先读:
 *
 * ① **`fileParallelism` 与 `isolate` 都不能写在这里** —— vitest 2.1.9 **忽略 project 级**这两个字段。
 *    · `fileParallelism`:带该字段跑 `--project integration` 仍是 24.2s 并发;加 CLI
 *      `--no-file-parallelism` 才 63.7s 真串行。
 *    · `isolate`:配置里写 `isolate: false` 实测**无效**(fast 档 12.34s,prepare 12.85s);
 *      加 CLI `--no-isolate` 才生效(4.03s,prepare 1.16s)。**同一族坑,第二次踩到。**
 *    两者一律由 `scripts/run-tests.mjs` 传 CLI 标志保证。写在这里只会制造
 *    「以为改这里有用」的假象 —— 故本文件**一个都不写**。
 *
 *    ⚠ 由此推出一条编排约束:`--no-isolate` 是**全局**开关,不分 project。
 *    故 fast 与 fast-mock **必须分两次调用** —— 合并成一次会把 fast-mock 的
 *    `vi.mock` 一并打坏(那正是它单独成档的原因)。
 *
 * ② **`setupFiles` 必须写在 project 里**。本文件存在时,`vitest -c <某配置>` 的根级
 *    `test.setupFiles` 会被**完全忽略**(实测:哨兵 0 次加载,而结果看起来是「零违规」)。
 *    本 spec 开发中被这个坑骗过两次 —— 没装上的哨兵报出的绿,和真的没有违规长得一模一样。
 *
 * ③ **`isolate: false` 是 fast 档 4.7 倍加速的来源**(20.46s → 4.37s),但它让 `vi.mock`
 *    失效(同 worker 内模块注册表共享)。故用 `vi.mock` 的文件走 fast-mock 档保留隔离,
 *    而不是改写那些测试 —— 改测试内容超出本 spec 边界。
 *
 * ④ **不用 `extends: "./vitest.config.ts"`**:实测基础配置的 include 会被并入 project,
 *    导致某个 project 把全部文件再跑一遍。故此处内联基础项,各 project 的 include 独立。
 */
import { fileURLToPath } from "node:url";

const childProcessGuard = fileURLToPath(
  new URL("./test/setup/child-process-guard.ts", import.meta.url),
);

const base = { environment: "node", testTimeout: 30_000 } as const;
const commonExclude = ["**/node_modules/**", "**/dist/**"];

/**
 * 快档共用的解析别名:把 `node:child_process` 指向守卫模块 —— **导入不报错、调用才报错**。
 * 用别名而非改写命名空间,是因为改写拦不住 `import { spawn } from "node:child_process"`
 * (ESM 具名导入在链接期绑定,实测拦不住),而 `src/rpc-channel/pi-rpc-process.ts` 正是这么写的。
 */
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
      setupFiles: ["./test/setup/fast-sentinel.ts"],
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
      // 隔离必须保持开启(vitest 默认即开):这些文件靠 `vi.mock` 覆盖模块导出,关隔离即失效。
      // 故本档**绝不可**与 fast 档合并到同一次带 `--no-isolate` 的调用里。
      setupFiles: ["./test/setup/fast-sentinel.ts"],
    },
  },
  {
    test: {
      ...base,
      name: "it",
      include: ["test/**/*.it.test.ts"],
      exclude: commonExclude,
    },
  },
  {
    test: {
      ...base,
      name: "e2e",
      include: ["test/**/*.e2e.test.ts"],
      exclude: commonExclude,
    },
  },
];
