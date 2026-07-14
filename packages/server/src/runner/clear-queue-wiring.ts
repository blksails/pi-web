/**
 * message-queue-ui「取回」· runner 子进程装配接线 `wireClearQueueBridge`。
 *
 * pi 的 `AgentSession.clearQueue()` 不在 pi 的 RPC 命令集内,故经父子 IPC 帧通道在 pi-web 内闭环:
 *
 *  1. **请求(server→runner)**:server 经 stdin 下发内部行 `{"type":"piweb_clear_queue","id":…}`;
 *     帧通道按 type 派发本桥 handler。
 *  2. **执行**:调 **当前绑定 session** 的 `clearQueue()`(同步返回被清文本)。取 `runtime.session`
 *     于调用时求值,以覆盖进程内 `new_session`/`switchSession`/`fork` 换 session 的情形。
 *  3. **结果(runner→server)**:经帧通道 `ctx.send` 写回
 *     `{"type":"piweb_clear_queue_result","id",steering,followUp}`(fd1)。
 *
 * 上行 fd1 直写、单一 stdin 读取器、优雅降级由帧通道统一承担。
 */
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import {
  ClearQueueLineSchema,
  type ClearQueueLine,
} from "@blksails/pi-web-protocol";
import type { FrameChannel, WritableLike } from "./frame-channel/index.js";

export interface WireClearQueueBridgeInput {
  /** 当前会话 id(诊断维度)。 */
  readonly sessionId: string;
  /** 诊断输出(默认 process.stderr)。 */
  readonly stderr?: WritableLike;
}

export interface ClearQueueBridgeWiring {
  /** 是否已接入帧通道。 */
  readonly installed: boolean;
  /** 解绑注册(幂等)。 */
  cleanup(): void;
}

/**
 * 装配「取回」桥。在 runner `startRunner` 内、`runRpcMode(runtime)` **之前**调用。
 *
 * @param channel 单一入站帧通道。
 * @param runtime 运行时(`runtime.session.clearQueue` 于调用时求值)。
 * @param input   会话 id(+ 可选 stderr)。
 */
export function wireClearQueueBridge(
  channel: FrameChannel,
  runtime: AgentSessionRuntime,
  input: WireClearQueueBridgeInput,
): ClearQueueBridgeWiring {
  const stderr = input.stderr ?? process.stderr;

  const unregister = channel.register(
    "piweb_clear_queue",
    ClearQueueLineSchema,
    (line: ClearQueueLine, ctx) => {
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
      ctx.send({
        type: "piweb_clear_queue_result",
        id: line.id,
        steering,
        followUp,
      });
    },
  );

  let cleanedUp = false;
  return {
    installed: channel.installed,
    cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      unregister();
    },
  };
}
