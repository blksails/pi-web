/**
 * message-queue-ui「取回」· runner 子进程装配接线 `wireClearQueueBridge`。
 *
 * pi 的 `AgentSession.clearQueue()` 不在 pi 的 RPC 命令集内,故复用 state-injection-bridge 的
 * 「第二个 stdin 读取器 + `fs.writeSync(1)` 自定义 stdout 行」接缝在 pi-web 内闭环(pi 上游零改动):
 *
 *  1. **请求(server→runner)**:server 经 stdin 下发内部行 `{"type":"piweb_clear_queue","id":…}`。
 *  2. **执行**:第二个读取器截获该行 → 调 **当前绑定 session** 的 `clearQueue()`(同步返回被清文本)。
 *     取 `runtime.session` 于调用时求值,以覆盖进程内 `new_session`/`switchSession`/`fork` 换 session 的情形。
 *  3. **结果(runner→server)**:经 `fs.writeSync(1)` 写回 `{"type":"piweb_clear_queue_result","id",steering,followUp}`。
 *     ⚠ 不能用 process.stdout.write:pi 的 `runRpcMode` `takeOverStdout()` 会把它重定向到 stderr;
 *     RPC 帧经 pi 内部原始 fd1 写出,server 的 PiRpcProcess 读的是子进程 fd1,故本桥也必须直写 fd1。
 *
 * pi 自身 stdin 读取器亦见该请求行并回无害 `Unknown command`(id 不匹配 server 端 RPC pending → 丢弃),
 * 不影响本路径。优雅降级(对齐 `wireStateBridge`):挂载失败 → 记诊断、能力降级、**不抛**。
 */
import { writeSync } from "node:fs";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { ClearQueueLineSchema } from "@blksails/pi-web-protocol";
import { JsonlLineReader } from "../rpc-channel/jsonl-reader.js";

/** data 监听器签名。 */
type DataListener = (chunk: string | Buffer) => void;
type ListenerOp = (event: "data", listener: DataListener) => unknown;

/** 可读流的最小视图(便于测试注入)。 */
interface ReadableLike {
  on(event: "data", listener: DataListener): unknown;
  off?: ListenerOp;
  removeListener?: ListenerOp;
  setEncoding?(encoding: string): unknown;
}

/** 可写流的最小视图。 */
interface WritableLike {
  write(s: string): unknown;
}

export interface WireClearQueueBridgeInput {
  /** 当前会话 id(诊断维度)。 */
  readonly sessionId: string;
  /** 请求行入口(默认 process.stdin)。 */
  readonly stdin?: ReadableLike;
  /** 结果行出口(默认真实 fd1)。 */
  readonly stdout?: WritableLike;
  /** 诊断输出(默认 process.stderr)。 */
  readonly stderr?: WritableLike;
}

export interface ClearQueueBridgeWiring {
  /** stdin 请求读取器是否挂上。 */
  readonly installed: boolean;
  /** 卸载 stdin 读取器(幂等)。 */
  cleanup(): void;
}

/**
 * 装配「取回」桥。在 runner `startRunner` 内、`runRpcMode(runtime)` **之前**调用。
 */
export function wireClearQueueBridge(
  runtime: AgentSessionRuntime,
  input: WireClearQueueBridgeInput,
): ClearQueueBridgeWiring {
  const stderr = input.stderr ?? process.stderr;

  // 结果行写出:默认直写 fd1(绕 takeOverStdout);测试可经 input.stdout 注入捕获。
  const writeLine: (s: string) => void =
    input.stdout !== undefined
      ? (s) => {
          input.stdout!.write(s);
        }
      : (s) => {
          writeSync(1, s);
        };

  const stdin = input.stdin ?? process.stdin;
  let installed = false;
  let onData: ((chunk: string | Buffer) => void) | undefined;
  try {
    stdin.setEncoding?.("utf8");
    const reader = new JsonlLineReader();
    onData = (chunk: string | Buffer): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const line of reader.push(text)) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue; // 非 JSON(或 pi 命令的部分)— 与本桥无关,忽略
        }
        const res = ClearQueueLineSchema.safeParse(parsed);
        if (!res.success) continue; // 非本桥请求行 — 交由 pi 处理,不干预
        let steering: string[] = [];
        let followUp: string[] = [];
        try {
          const cleared = runtime.session.clearQueue();
          steering = cleared.steering;
          followUp = cleared.followUp;
        } catch (err) {
          stderr.write(
            `runner: clear-queue bridge clearQueue error: ${String(err)}\n`,
          );
          // 抛错时回空结果(不吞语义):UI 侧编辑器不变、队列面板保持。
        }
        try {
          writeLine(
            JSON.stringify({
              type: "piweb_clear_queue_result",
              id: res.data.id,
              steering,
              followUp,
            }) + "\n",
          );
        } catch (err) {
          stderr.write(
            `runner: clear-queue bridge result-line error: ${String(err)}\n`,
          );
        }
      }
    };
    stdin.on("data", onData);
    installed = true;
  } catch (err) {
    stderr.write(
      `runner: clear-queue bridge stdin reader install error: ${String(err)}\n`,
    );
  }

  let cleanedUp = false;
  return {
    installed,
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      if (onData !== undefined) {
        if (stdin.off !== undefined) stdin.off("data", onData);
        else if (stdin.removeListener !== undefined)
          stdin.removeListener("data", onData);
      }
    },
  };
}
