/**
 * 双向 RPC 端点 —— transport 无关（浏览器 `MessagePort` / Node `MessageChannel` 皆可）。
 *
 * 设计要点（每条都是踩过的坑，别精简掉）：
 *  1. **ack + timeout**：MDN 明言 `postMessage` 的发送方**感知不到**对端处理器抛错。
 *     故请求先挂**短 ack 计时**（区分「对端没收到」与「对端在慢慢算」），收到 ack 后换成
 *     更长的响应计时，两段独立。
 *  2. **对称双向**：同一实现既发 `req` 也**服务** `req`（`handlers`）。缺了服务端，
 *     子帧就只能被动应答、无法向宿主要数据——这是「地基未完成」的典型表现。
 *  3. **错误不外泄**：handler 抛出时**不**把 message/stack 送过边界（对不可信子帧而言那是
 *     宿主内部信息泄漏）。只回固定文案；method 名仅在字符集受控时回显。
 *  4. **入站并发上限**：不可信对端可以用 `req` 洪水把宿主 handler 打满。超限立即回结构化错误，
 *     不排队、不 spawn。
 *  5. **后台静音**（Luigi `skipEventsWhenInactive` 范式）：非活跃期来自对端的**高权限**事件
 *     单方面丢弃 —— 既是 UX bug，也是被隐藏 frame 发起 UI 劫持的攻击面。
 *  6. **不跨边界传函数**：函数代理 = 向不可信侧永久授予能力，沙箱场景反模式。
 *  7. 未知 `t` / 畸形载荷一律**丢弃**；一并监听 `messageerror`（structured clone 失败）。
 */
import {
  isRecord,
  isSafeMethodName,
  type PortMessage,
} from "./protocol.js";

/** 传输层抽象（Penpal v7 的 `WindowMessenger` 分层思想：同一 RPC 语义可换底座）。 */
export interface PortLike {
  postMessage(data: unknown): void;
  addEventListener(
    type: "message" | "messageerror",
    listener: (ev: { data?: unknown }) => void,
  ): void;
  removeEventListener(
    type: "message" | "messageerror",
    listener: (ev: { data?: unknown }) => void,
  ): void;
  start?(): void;
  close?(): void;
}

/** 入站方法处理器。返回值经 structured clone 送回，故**必须**是可克隆数据。 */
export type RpcHandler = (params: unknown) => unknown | Promise<unknown>;

export interface RpcEndpointOptions {
  /** 本端对外提供的方法表。未声明的 method 一律回结构化错误。 */
  readonly handlers?: Readonly<Record<string, RpcHandler>>;
  /** 对端推来的事件。未知形状 / 静音期的高权限事件不会到达这里。 */
  readonly onEvent?: (name: string, data: unknown) => void;
  /** 非活跃期一律丢弃的事件名（后台面板不得抢占导航 / 模态 / 打开模块）。 */
  readonly privilegedEvents?: readonly string[];
  /** 响应超时，默认 15000ms（对齐 pi-web ui-rpc）。 */
  readonly requestTimeoutMs?: number;
  /** ack 超时，默认 2000ms。 */
  readonly ackTimeoutMs?: number;
  /** 同时在跑的入站请求上限，默认 32。超限立即回错误。 */
  readonly maxConcurrentInbound?: number;
  /** 反序列化失败（structured clone）时的回调；默认静默。 */
  readonly onMessageError?: () => void;
}

export interface RpcEndpoint {
  /** 向对端发起请求。 */
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  /** 向对端推事件（无回执）。 */
  notify(name: string, data?: unknown): void;
  /** 本端是否活跃（可见）；false 时对**入站**高权限事件静音。 */
  setActive(active: boolean): void;
  /** 未决出站请求数（测试用：断言超时后 pending 表被清空，不泄漏）。 */
  pendingCount(): number;
  /** 在跑的入站请求数。 */
  inboundCount(): number;
  destroy(): void;
}

interface Pending {
  readonly resolve: (v: unknown) => void;
  readonly reject: (e: Error) => void;
  acked: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** 跨边界的固定错误文案（不含任何本端内部信息）。 */
const ERR_HANDLER = "handler error";
const ERR_UNKNOWN_METHOD = "unknown method";
const ERR_BUSY = "too many inflight requests";

export function createRpcEndpoint(
  port: PortLike,
  opts: RpcEndpointOptions = {},
): RpcEndpoint {
  const handlers = opts.handlers ?? {};
  const privileged = new Set(opts.privilegedEvents ?? []);
  const reqTimeout = opts.requestTimeoutMs ?? 15_000;
  const ackTimeout = opts.ackTimeoutMs ?? 2_000;
  const maxInbound = opts.maxConcurrentInbound ?? 32;
  const pending = new Map<string, Pending>();
  let inbound = 0;
  let active = true;
  let seq = 0;
  let destroyed = false;

  const settle = (id: string, fn: (p: Pending) => void): void => {
    const p = pending.get(id);
    if (p === undefined) return;
    if (p.timer !== undefined) clearTimeout(p.timer);
    pending.delete(id);
    fn(p);
  };

  const reply = (msg: PortMessage): void => {
    if (destroyed) return;
    port.postMessage(msg);
  };

  const serve = (id: string, method: string, params: unknown): void => {
    // 先 ack —— 让对端把短计时换成长计时，避免「handler 慢」被误判成「没收到」。
    reply({ t: "ack", id });
    if (inbound >= maxInbound) {
      reply({ t: "res", id, ok: false, error: ERR_BUSY });
      return;
    }
    // 只在字符集受控时回显 method 名（回显不可信输入是日志注入 / 转义放大面）。
    const named = isSafeMethodName(method) ? `${ERR_UNKNOWN_METHOD}: ${method}` : ERR_UNKNOWN_METHOD;
    const handler = Object.prototype.hasOwnProperty.call(handlers, method)
      ? handlers[method]
      : undefined;
    if (handler === undefined) {
      reply({ t: "res", id, ok: false, error: named });
      return;
    }
    inbound += 1;
    void (async () => {
      try {
        const result = await handler(params);
        reply(
          result === undefined
            ? { t: "res", id, ok: true }
            : { t: "res", id, ok: true, result },
        );
      } catch {
        // 刻意不透传 message/stack：对不可信对端而言那是本端内部信息泄漏。
        reply({ t: "res", id, ok: false, error: ERR_HANDLER });
      } finally {
        inbound -= 1;
      }
    })();
  };

  const onMessage = (ev: { data?: unknown }): void => {
    const msg = ev.data;
    if (!isRecord(msg)) return; // 形状不合法 → 丢弃
    switch (msg["t"]) {
      case "req": {
        const id = msg["id"];
        const method = msg["method"];
        if (typeof id !== "string" || typeof method !== "string") return;
        serve(id, method, msg["params"]);
        return;
      }
      case "ack": {
        const id = msg["id"];
        if (typeof id !== "string") return;
        const p = pending.get(id);
        if (p === undefined || p.acked) return;
        p.acked = true;
        if (p.timer !== undefined) clearTimeout(p.timer);
        p.timer = setTimeout(() => {
          settle(id, (q) => q.reject(new Error(`rpc timeout: ${id}`)));
        }, reqTimeout);
        return;
      }
      case "res": {
        const id = msg["id"];
        if (typeof id !== "string") return;
        if (msg["ok"] === true) {
          settle(id, (p) => p.resolve(msg["result"]));
        } else {
          const err = msg["error"];
          settle(id, (p) =>
            p.reject(new Error(typeof err === "string" ? err : "rpc error")),
          );
        }
        return;
      }
      case "evt": {
        const name = msg["name"];
        if (typeof name !== "string") return;
        // 后台静音：非活跃期的高权限事件单方面丢弃。
        if (!active && privileged.has(name)) return;
        opts.onEvent?.(name, msg["data"]);
        return;
      }
      default:
        return; // 未知 type → 丢弃（不 eval、不据消息执行特权动作）
    }
  };

  const onMessageError = (): void => {
    opts.onMessageError?.();
  };

  port.addEventListener("message", onMessage);
  port.addEventListener("messageerror", onMessageError);
  port.start?.();

  return {
    request(method, params, timeoutMs): Promise<unknown> {
      if (destroyed) return Promise.reject(new Error("rpc endpoint destroyed"));
      seq += 1;
      const id = `r${seq}`;
      return new Promise<unknown>((resolve, reject) => {
        const p: Pending = { resolve, reject, acked: false, timer: undefined };
        // 先挂 ack 计时；收到 ack 后换成（更长的）响应计时。
        p.timer = setTimeout(
          () => {
            settle(id, (q) => q.reject(new Error(`rpc no ack: ${id}`)));
          },
          Math.min(ackTimeout, timeoutMs ?? reqTimeout),
        );
        pending.set(id, p);
        const req: PortMessage =
          params === undefined
            ? { t: "req", id, method }
            : { t: "req", id, method, params };
        port.postMessage(req);
      });
    },
    notify(name, data): void {
      if (destroyed) return;
      const evt: PortMessage =
        data === undefined ? { t: "evt", name } : { t: "evt", name, data };
      port.postMessage(evt);
    },
    setActive(next): void {
      active = next;
    },
    pendingCount(): number {
      return pending.size;
    },
    inboundCount(): number {
      return inbound;
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      for (const id of [...pending.keys()]) {
        settle(id, (p) => p.reject(new Error("rpc endpoint destroyed")));
      }
      port.removeEventListener("message", onMessage);
      port.removeEventListener("messageerror", onMessageError);
      port.close?.();
    },
  };
}
