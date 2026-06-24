/**
 * PiRpcChannel — 传输无关 RPC 通道端口(Ports & Adapters 的端口)。
 *
 * 定义后端会话引擎与 agent 子进程之间唯一的双向 JSONL 通信契约:
 * 发送一行、订阅行、关闭、健康查询。签名仅使用字符串与协议无关的原始类型,
 * 不出现 ChildProcess / Stream / 管道等本地传输概念(Req 1.3),使本地
 * (PiRpcProcess)与未来 e2b/ssh/device/websocket 实现共享同一契约,并可被
 * 最小 mock 替换以单测命令封装层(Req 1.5)。
 *
 * SpawnSpec 不在此定义,而是由 protocol-contract 拥有并导出
 * (`import type { SpawnSpec } from "@blksails/protocol"`,单一事实来源)。
 */

/** 通道健康状态(Req 6.4)。 */
export interface ChannelHealth {
  /** 子进程/连接是否存活。 */
  readonly alive: boolean;
  /** 已退出时的退出码(未退出或被信号终止为 null)。 */
  readonly exitCode: number | null;
  /** 被信号终止时的信号名(否则为 null)。 */
  readonly signal: string | null;
}

/** 按行接收回调:每收到一条完整 stdout 行调用一次(Req 1.2)。 */
export type LineListener = (line: string) => void;

/** 取消订阅句柄:调用后不再回调。 */
export type Unsubscribe = () => void;

/**
 * 传输无关 RPC 通道端口(Req 1.1–1.5, 6.4)。
 *
 * Preconditions:`send` / `onLine` 仅在通道未关闭时有意义。
 * Postconditions:`onLine` 返回的 Unsubscribe 调用后不再回调;`close` resolve
 * 后 `health().alive === false`。
 * Invariants:签名不泄漏进程/管道类型(Req 1.3)。
 */
export interface PiRpcChannel {
  /** 写入一行原始 JSONL 文本到下游(local 即子进程 stdin)。 */
  send(line: string): void;
  /** 注册按行接收回调,返回取消订阅句柄(Req 1.2)。 */
  onLine(cb: LineListener): Unsubscribe;
  /** 关闭通道并干净退出(Req 6.3 / 6.6)。 */
  close(): Promise<void>;
  /** 查询通道健康状态(Req 6.4)。 */
  health(): ChannelHealth;
}
