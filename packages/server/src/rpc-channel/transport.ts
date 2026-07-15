/**
 * RpcTransport — 传输无关的底层双向 JSONL 通道端口。
 *
 * 只承载「发送一行 / 逐行接收(stdout 协议帧) / stderr 分流 / 退出 / 就绪重生 /
 * 关闭 / 健康」,**不含任何命令封装或分帧分发知识**——那属于会话核心 `PiRpcSession`。
 * local(child_process)与 e2b(沙盒内进程)各自实现此端口,`PiRpcSession` 复用同一
 * 会话核心。
 *
 * fd1 铁律:`onLine` 只承载子进程 stdout 的协议帧;stderr 必须经 `onStderr` 分流,
 * 绝不混入 `onLine`,否则云沙盒下会污染上行帧通道(掉 log 黑洞)。
 */
import type { ChannelHealth, Unsubscribe } from "./pi-rpc-channel.js";
import type { ExitInfo } from "./pi-rpc-process.js";

export type { ChannelHealth, Unsubscribe, ExitInfo };

export interface RpcTransport {
  /** 写入一行原始 JSONL 到下游进程 stdin。 */
  send(line: string): void;
  /** 订阅子进程 stdout 的**逐行协议帧**(仅 fd1)。 */
  onLine(cb: (line: string) => void): Unsubscribe;
  /** 订阅子进程 stderr 原始文本块(分流,绝不混入 `onLine`)。 */
  onStderr(cb: (chunk: string) => void): Unsubscribe;
  /** 订阅进程/沙盒退出。 */
  onExit(cb: (info: ExitInfo) => void): Unsubscribe;
  /** 订阅进程就绪/重生(首次 spawn 与后续重启均触发)。 */
  onSpawn(cb: () => void): Unsubscribe;
  /** 关闭传输并干净退出。 */
  close(): Promise<void>;
  /** 查询传输健康状态。 */
  health(): ChannelHealth;
}
