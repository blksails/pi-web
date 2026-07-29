/**
 * fast 档运行期行为哨兵(spec: test-tiering-fast-lane,任务 2.2)。
 *
 * 静态判据只看**直接**导入,看不见「测试 → src 模块 → 起子进程」这类间接路径
 * (传递依赖扫描已被实测证伪,59% 误报,见 research.md §4.1)。本哨兵在运行期兜底:
 * 任何 fast 档测试若真的起了子进程或发了网络请求,当场判红并指出是哪个用例。
 *
 * ★ 为什么用 `diagnostics_channel` 而不是改写 `child_process` 的导出
 *   —— 实测结论,不是偏好:
 *   ESM 具名导入(`import { spawn } from "node:child_process"`,`src/rpc-channel/pi-rpc-process.ts`
 *   正是这么写的)在链接期就绑定到原函数,**事后改命名空间拦不住**(实测 `nsWorked === false`)。
 *   一个拦不住的哨兵比没有哨兵更坏 —— 它会把「零违规」这种毫无信息量的结果伪装成安全证明。
 *   `diagnostics_channel("child_process")` 由 Node 在 ChildProcess 实际创建时发布,
 *   与消费方的导入写法无关,实测可靠触发。
 *
 * 代价:诊断通道只能**观测**,不能阻止子进程被创建。故哨兵采取「记录 → 在用例结束时判红」,
 * 而非「调用点抛错」。对 fast 档而言这已足够:目的是让违规**无法通过 CI**,不是阻止其发生。
 *
 * `fetch` 走另一条路:它是全局属性,调用时才查找,替换即生效,故直接替换并**当场抛错**。
 */
import diagnosticsChannel from "node:diagnostics_channel";
import { afterEach, beforeEach, expect } from "vitest";

export interface FastTierViolation {
  readonly api: string;
  readonly detail: string;
}

const violations: FastTierViolation[] = [];

/** 由诊断通道发布的子进程消息形状(只取我们要的字段,不假设其余结构)。 */
interface ChildProcessMessage {
  readonly process?: { readonly spawnfile?: string; readonly spawnargs?: readonly string[] };
}

diagnosticsChannel.subscribe("child_process", (message) => {
  const proc = (message as ChildProcessMessage).process;
  const file = proc?.spawnfile ?? "<unknown>";
  const args = proc?.spawnargs?.slice(1).join(" ") ?? "";
  violations.push({ api: "child_process.spawn", detail: args ? `${file} ${args}` : file });
});

const realFetch = globalThis.fetch;
globalThis.fetch = ((...args: Parameters<typeof realFetch>) => {
  const target = typeof args[0] === "string" ? args[0] : String((args[0] as { url?: string })?.url ?? args[0]);
  violations.push({ api: "fetch", detail: target });
  throw new Error(`[fast 档违规] fetch("${target}") —— fast 档不得发起网络请求`);
}) as typeof realFetch;

beforeEach(() => {
  violations.length = 0;
});

afterEach(() => {
  if (violations.length === 0) return;
  const lines = violations.map((v) => `  · ${v.api}: ${v.detail}`).join("\n");
  violations.length = 0;
  expect.unreachable(
    `[fast 档违规] 本用例在运行期触发了 fast 档禁止的行为:\n${lines}\n` +
      `修复方式:把该测试文件改名为 it 档后缀,而不是放宽哨兵。`,
  );
});

