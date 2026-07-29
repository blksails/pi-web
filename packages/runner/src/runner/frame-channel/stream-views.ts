/**
 * frame-channel · 流最小视图接口(单一权威)。
 *
 * 原先 `state-wiring` / `surface-wiring` / `clear-queue-wiring` / `agent-routes-wiring`
 * 四个入站桥各自重复声明了同一套 `DataListener` / `ListenerOp` / `ReadableLike` /
 * `WritableLike`。此处集中声明一份,供帧通道与各桥统一引用(Req 7.1)。
 */

/** stdin data 事件监听器签名。 */
export type DataListener = (chunk: string | Buffer) => void;

/** 增删监听器的统一签名(规避 EventEmitter 泛型重载的 this 不兼容)。 */
export type ListenerOp = (event: "data", listener: DataListener) => unknown;

/** 可读流的最小视图(便于测试注入替代 stdin)。 */
export interface ReadableLike {
  on(event: "data", listener: DataListener): unknown;
  off?: ListenerOp;
  removeListener?: ListenerOp;
  setEncoding?(encoding: string): unknown;
}

/** 可写流的最小视图(便于测试注入捕获写出)。 */
export interface WritableLike {
  write(s: string): unknown;
}
