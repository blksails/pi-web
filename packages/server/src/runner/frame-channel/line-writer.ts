/**
 * frame-channel · 上行行 writer 原语(单一权威,Req 2)。
 *
 * runner 运行期(pi `runRpcMode` 的 `takeOverStdout` 生效后)的所有自定义上行帧**必须**直写
 * 进程原始 fd1,**不能**用 `process.stdout.write`:takeOverStdout 会把 `process.stdout` 劫持
 * 重定向到 stderr(防 agent 杂散输出污染 RPC 流),而 RPC 帧经 pi 内部保存的原始 fd1 写出。
 * server 的 `PiRpcProcess` 读的是子进程 fd1;经 ACS sandbox 云链路时,沙箱内 `agent-runner`
 * 全量转发子进程 stdout(fd1)为 `{type:"line"}` 上行帧,而 stderr 转 `{type:"log"}` 汇入控制面
 * 日志——故走 `process.stdout` 的帧在云上会**掉进日志黑洞、彻底脱离 RPC 流**。
 *
 * `fs.writeSync(1, …)` 直写 fd1(takeOverStdout 不触碰底层 fd),单次系统调用原子,不与 pi 的
 * 异步写交织成半行(Req 2.5)。测试可注入 `WritableLike` 捕获写出(Req 2.4)。
 */
import { writeSync } from "node:fs";
import type { WritableLike } from "./stream-views.js";

/**
 * 构造「写一行」函数。
 *
 * @param injected 注入的可写出口(测试接缝);缺省时直写原始 fd1。
 * @returns 单次原子写出完整一行的函数(调用方传入的 `line` 应已含结尾换行)。
 */
export function makeLineWriter(injected?: WritableLike): (line: string) => void {
  if (injected !== undefined) {
    return (line: string): void => {
      injected.write(line);
    };
  }
  return (line: string): void => {
    writeSync(1, line);
  };
}
