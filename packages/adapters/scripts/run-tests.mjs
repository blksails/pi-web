#!/usr/bin/env node
/**
 * 测试分档编排(spec: test-tiering-fast-lane;adapters 包副本由 adapters-package-extraction
 * 任务 1.2 建立,照 `../../runner/scripts/run-tests.mjs` 同形复制)。
 *
 * ★ 四份都存在是刻意的:每个包各自跑各自的档,合并成一个跨包运行器会让
 *   「哪个包红了」变成需要读日志才能回答的问题。
 *
 * 档位定义在 `vitest.workspace.ts`(按文件名后缀),本脚本只负责**怎么跑**:
 *
 *   pnpm test            全量 = fast → fast-mock → it(三相;e2e 不在内)
 *   pnpm test:fast       仅快档 = fast → fast-mock
 *   pnpm test:e2e        仅 e2e(需外部服务凭据)
 *   pnpm test -- <args>  开发者过滤:退回单次调用,行为与分档改造前一致
 *
 * ★ 为什么这些标志必须由本脚本经 CLI 传,而不是写进配置(两条都是实测,不是偏好):
 *
 *   ① `--no-file-parallelism`(it/e2e 串行)—— vitest 2.1.9 **忽略 project 级
 *      `fileParallelism`**:带该字段跑 `--project integration` 仍是 24.2s 并发,
 *      加 CLI 标志才 63.7s 真串行。串行是 it 档的正确性前提:这些文件各自 spawn 真实
 *      agent 子进程,并发时互相饿死,会话就绪被拖过 30s 探针死线 → 随机某个文件变红、
 *      孤立跑必绿。**治并发,不治超时数字** —— 放宽探针会掩盖真实退化。
 *
 *   ② `--no-isolate`(fast 档提速)—— 同族坑,第二次踩到:配置里写 `isolate: false`
 *      实测无效,加 CLI 标志才生效。而 `--no-isolate` 是**全局**开关、不分 project,
 *      故 fast 与 fast-mock **必须分两次调用**:fast-mock 那几个文件靠 `vi.mock` 覆盖
 *      模块导出,关隔离即失效(那正是它们单独成档的原因)。
 *
 * ★ 为什么有显式参数时退回单次调用:`pnpm` 把 `test -- <args>` 追加到整条脚本串尾,
 *   多相编排会让参数只作用于最后一相,破坏既有的
 *   `pnpm --filter @blksails/pi-web-adapters test -- --run <pattern>` 用法。
 *
 * ★ 验收提醒:并发/串行类改动**不能只看「跑绿了」** —— 必须比对耗时证据。
 */
import { spawn, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const shell = process.platform === "win32";

function vitest(extra) {
  const res = spawnSync("vitest", ["run", ...extra], { stdio: "inherit", shell });
  if (res.error) throw res.error;
  return res.status ?? 1;
}

/**
 * ★ 允许**空档**的三个档位:fast-mock / it / e2e。
 *
 * adapters 提取是分批搬迁的,搬到某一步时可能一个 `.mock.test.ts` 都还没有 ——
 * vitest 对空档默认 exit 1,那会让「这个包还没有这类测试」和「这个包的测试全炸了」
 * 报出同一个退出码。
 *
 * ⚠ **fast 档故意不给这个标志**。fast 档一旦变空,里面装着的东西就集体停摆而没有
 *   任何人会知道 —— 而这正是本仓已经被骗过两次的失效形态。fast 档为空必须是一次
 *   响亮的失败。
 *
 * ⚠ 由此推出:**测试搬入(任务 3.2)之前,本包 fast 档必然为空、按设计就该失败**。
 *   那是本机制在正常工作的证据,不是缺陷;它在 3.2 完成后才应转绿。
 */
const ALLOW_EMPTY = ["--passWithNoTests"];

/**
 * 快档两相。必须是**两次调用**(理由见文件头 ②),但可以**并发**跑。
 * fast-mock 的输出**缓冲后补打**在 fast 之后 —— 两个 vitest 同时 inherit stdio
 * 会让摘要交错,读起来比省下的两秒更贵。
 */
async function runFastLane() {
  let mockOut = "";
  const mock = spawn("vitest", ["run", "--project", "fast-mock", ...ALLOW_EMPTY], { shell });
  mock.stdout.on("data", (d) => (mockOut += d));
  mock.stderr.on("data", (d) => (mockOut += d));
  const mockDone = new Promise((resolve) => mock.on("close", resolve));

  const fast = vitest(["--project", "fast", "--no-isolate"]);
  const mockStatus = await mockDone;
  process.stdout.write(mockOut);
  return fast || (mockStatus ?? 1);
}

const mode = args[0];

// 开发者过滤用法:单次调用,行为与分档改造前一致。
if (args.length > 0 && mode !== "--fast" && mode !== "--e2e") {
  process.exit(vitest(args));
}

if (mode === "--fast") process.exit(await runFastLane());

// e2e 需外部服务凭据,**不在**默认路径里;整文件被门控者在无凭据时整体 skip。
if (mode === "--e2e")
  process.exit(vitest(["--project", "e2e", "--no-file-parallelism", ...ALLOW_EMPTY]));

// 全量:快档两相 → it 档串行。三相都跑完再汇总退出码,便于一次看全所有失败。
const fastLane = await runFastLane();
const it = vitest(["--project", "it", "--no-file-parallelism", ...ALLOW_EMPTY]);
process.exit(fastLane || it);
