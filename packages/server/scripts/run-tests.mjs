#!/usr/bin/env node
/**
 * server 包测试启动器:让 `test/integration/**` 独占一相运行。
 *
 * 为什么需要它(而不是直接 `vitest run`):
 *   9 个集成测试文件各自 spawn 真实 agent 子进程。与其余 254 个单测并发时子进程
 *   互相饿死,会话就绪从常态 ~4.3s 被拖过 DEFAULT_READINESS_PROBE_TIMEOUT_MS
 *   (30s,src/session/pi-session.ts:156)→ 会话落 error{probe-timeout},测试空等到
 *   自己的 40s 死线报 "Timed out waiting for…"。表现为每次全量跑随机某个集成文件变红,
 *   孤立跑必绿。
 *
 * 为什么不是调大超时:这些用例已是 waitFor 40s / testTimeout 50s 仍失败,阈值不是
 *   瓶颈;探针的 30s 是产品语义(真实会话超 30s 未就绪本就该报错),为迁就测试放宽
 *   会掩盖真实退化。
 *
 * 为什么不是 vitest workspace 的 project 级 fileParallelism:实测(2.1.9)两个
 *   project 之间仍并发调度,集成文件照样与单测抢 CPU,红照旧。唯有分两次调用才真正独占。
 *
 * 为什么不是 `vitest run --project unit && vitest run --project integration`:
 *   pnpm 把 `test -- <args>` 追加到整条脚本串尾,会只作用于后半条,破坏既有的
 *   `pnpm --filter @blksails/pi-web-server test -- --run <pattern>` 过滤用法。
 *   故有显式参数时退回单次调用,语义与改造前完全一致。
 */
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const shell = process.platform === "win32";

function vitest(extra) {
  const res = spawnSync("vitest", ["run", ...extra], { stdio: "inherit", shell });
  if (res.error) throw res.error;
  return res.status ?? 1;
}

// 开发者过滤用法:单次调用,行为与改造前一致。
if (args.length > 0) process.exit(vitest(args));

// 全量:先并行跑单测,再独占跑集成。两相都跑完再汇总退出码,便于一次看全失败。
const unit = vitest(["--project", "unit"]);
const integration = vitest(["--project", "integration"]);
process.exit(unit || integration);
