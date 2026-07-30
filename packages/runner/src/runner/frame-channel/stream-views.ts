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
  /** 暂停流动(可选;假 stdin 无此能力时通过可选链跳过,不抛)。 */
  pause?(): unknown;
  /** 恢复流动(可选;stdin-resume-gate 的 resume 判据/兜底所需)。 */
  resume?(): unknown;
  /** 查询某事件当前监听器数(可选;stdin-resume-gate 的 baseline/命中判据所需)。 */
  listenerCount?(event: string): number;
}

/** 可写流的最小视图(便于测试注入捕获写出)。 */
export interface WritableLike {
  write(s: string): unknown;
}

/**
 * `newListener` 事件监听器签名(Node EventEmitter 标准语义:回调参数为 `(event, listener)`,
 * 且在监听器实际加入**之前**触发)。stdin-resume-gate 据此判定是否有新的 `"data"` 监听器
 * 加入(如 pi `runRpcMode` 的读取器)。
 */
export type NewListenerListener = (event: string, listener: DataListener) => void;

/**
 * stdin-resume-gate 所需的完整流视图:`pause`/`resume`/`listenerCount` 均为必备,
 * 并可挂 `"newListener"` 事件监听器(EventEmitter 标准事件,用于探测后续挂载的
 * `"data"` 读取器)。
 *
 * ⚠ 不 extends {@link ReadableLike}:基接口的 `on` 是单签名 `(event: "data", …)`,
 *   本接口的 `on` 重载集与之不兼容(TS2430)。独立声明,`process.stdin` 结构性满足。
 */
export interface GateReadableLike {
  on(event: "data", listener: DataListener): unknown;
  on(event: "newListener", listener: NewListenerListener): unknown;
  off?(event: "newListener", listener: NewListenerListener): unknown;
  pause(): unknown;
  resume(): unknown;
  listenerCount(event: string): number;
}
