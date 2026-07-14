/**
 * frame-channel · 装配期声明帧原语(Req 3)。
 *
 * 装配期一次性声明帧(`slash_completions` / `agent_routes` 声明)与运行期上行帧走**不同路径**:
 * 声明帧在 runner 进入 `runRpcMode` 的 `takeOverStdout` **之前**发出,此窗口 `process.stdout`
 * 仍指向进程原始 fd1,故可直接 `process.stdout.write`;此后一切运行期上行必须走 fd1 writer
 * (见 `line-writer.ts`)。⚠ 调用方必须在 `runRpcMode(runtime)` **之前**调用本函数。
 *
 * 空内容由调用方判定(无 slash 补全 / 无 routes → 不调用本函数),使存量 source 零行为变化。
 */

/**
 * 写出一条装配期声明帧(`JSON.stringify(frame) + "\n"`)。
 *
 * @param frame 声明帧对象(纯数据投影)。
 * @param write 行写出函数(默认 `process.stdout.write`);注入用于单测捕获。
 */
export function emitAssemblyFrame(
  frame: unknown,
  write: (line: string) => void = (line) => {
    process.stdout.write(line);
  },
): void {
  write(JSON.stringify(frame) + "\n");
}
