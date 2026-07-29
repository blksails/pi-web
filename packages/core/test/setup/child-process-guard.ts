/**
 * fast 档的子进程守卫模块(spec: test-tiering-fast-lane,任务 2.2)。
 *
 * 在 fast / fast-mock 两档的配置里,`node:child_process` 与 `child_process` 被**别名**到本模块。
 * 于是无论消费方怎么写导入,拿到的都是这里的包装版:**导入不报错,调用才报错**。
 * 这正是我们要的语义 —— 静态层管「不该直接导入」,运行期管「不该真的调用」。
 *
 * ★ 为什么不是改写命名空间、也不是诊断通道 —— 两条都实测走不通:
 *   ① 改写 `cp.spawn` 拦不住 `import { spawn } from "node:child_process"`(ESM 具名导入在链接期
 *      绑定到原函数)。而 `src/rpc-channel/pi-rpc-process.ts` 正是这么写的。实测 `nsWorked === false`。
 *   ② `diagnostics_channel("child_process")` 只在**异步** `spawn` 创建 ChildProcess 时发布;
 *      `spawnSync` / `execFileSync` 实测**完全不发**(hits = 0),覆盖不全。
 *   别名是唯一同时覆盖「任意导入写法 × 同步与异步」的手段。
 *
 * ★ 取真实模块必须绕开别名本身,否则自引用成环。用 `createRequire` 走 Node 原生解析,
 *   不经 vite 的 resolve.alias。
 */
import { createRequire } from "node:module";

const realChildProcess = createRequire(import.meta.url)("child_process") as Record<string, unknown>;

/** 会真正创建子进程的入口。其余导出(如 `ChildProcess` 类型、常量)原样透出。 */
const BLOCKED = [
  "spawn",
  "spawnSync",
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "fork",
] as const;

function blocked(api: string): (...args: unknown[]) => never {
  return (...args: unknown[]): never => {
    const target = typeof args[0] === "string" ? args[0] : String(args[0]);
    throw new Error(
      `[fast 档违规] child_process.${api}("${target}") —— fast 档不得创建子进程。\n` +
        `修复方式:把该测试文件改名为 it 档后缀(*.it.test.ts),而不是放宽守卫。`,
    );
  };
}

const guarded: Record<string, unknown> = { ...realChildProcess };
for (const api of BLOCKED) guarded[api] = blocked(api);

export const spawn = guarded.spawn;
export const spawnSync = guarded.spawnSync;
export const exec = guarded.exec;
export const execSync = guarded.execSync;
export const execFile = guarded.execFile;
export const execFileSync = guarded.execFileSync;
export const fork = guarded.fork;
export const ChildProcess = realChildProcess.ChildProcess;
export default guarded;
