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
 * 为什么不是 vitest workspace 的 project 级 fileParallelism:实测(2.1.9)该字段在
 *   project 配置里**被完全忽略**——`vitest run --project integration` 用时 24.2s(9 个文件
 *   仍并发),加上 CLI `--no-file-parallelism` 才是 63.7s(≈各文件耗时之和,真串行)。
 *   且两个 project 之间本就并发调度。故串行**必须**由下面的 CLI 标志保证,不能只写配置。
 *   ★ 只看「跑绿了」不足以验证此修复,必须比对耗时/并发证据,否则会被偶然的绿骗过。
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

// 全量:先并行跑单测,再独占且**串行**跑集成。两相都跑完再汇总退出码,便于一次看全失败。
// `--no-file-parallelism` 不可省:它是集成文件之间真正串行的唯一保证(见上方说明)。
const unit = vitest(["--project", "unit"]);
const integration = vitest(["--project", "integration", "--no-file-parallelism"]);
process.exit(unit || integration);
