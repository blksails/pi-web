// [迁移壳层] 源:aigc-agent lib/workspace/iframe-rpc.ts。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。
/**
 * 沙箱 iframe 的宿主侧通信层（零 React 依赖 —— 纯逻辑可被 node e2e 直测）。
 *
 * ⚠️ **上游化进行中**：本文件已整理为基座包 `@blksails/pi-web-frame-rpc` 提给上游
 * （PR https://github.com/blksails/pi-web/pull/9，分支 `feat/frame-rpc`）。上游版是**超集**，
 * 补齐了这里缺的两块：
 *  1. **`req` 的服务端**（`handlers` 映射）—— 本文件的 `createRpcEndpoint` 只处理
 *     `ack`/`res`/`evt`，收到 `req` 走 `default: return` 丢弃，即**只能发不能收**；
 *  2. **guest 侧库** —— 这里没有，子帧逻辑只以内联脚本存在于 `public/sandbox/preview.html`。
 * 另加：入站并发上限、handler 错误不外泄、握手驱动抽出为 `connectSandboxFrame`。
 *
 * PR 合并并发版后，本文件**删除**，`SandboxModuleFrame` 改 import 上游包；在那之前
 * submodule 仍钉 `a56ea0a`，本文件是本仓库的运行时来源，勿提前删。
 *
 * 落地的是 `docs/webext-digest/01-postMessage与iframe安全.md` §14 检查清单与
 * `02-微前端与iframe-RPC实践.md` §8 的 12 条清单，逐条对应：
 *
 *  1. **握手用 ping-pong 轮询**，不是单向 ready（子比父先就绪时单向会静默丢包）。
 *  2. **握手包是唯一的裸 `postMessage`**：`sandbox="allow-scripts"`（不含 `allow-same-origin`）
 *     ⇒ 子帧是**不透明 origin**，`targetOrigin` 只能写 `"*"`（MDN 对 opaque origin 的规定），
 *     故握手包**不得携带任何机密**。
 *  3. **身份锚换成 `event.source` 引用相等**（origin 在此链路上报废）：`event.origin` 从「拒收
 *     条件」变为「**期望值断言** `=== "null"`」——收到别的 origin 反而说明不是我们那个沙箱。
 *  4. 握手一完成即经 transfer list 交付 **`MessagePort`**，此后业务流量走点对点私有管道，
 *     `window` 上的 `message` 监听器只留握手用途。
 *  5. RPC 内核 = `requestId` + pending 注册表 + resolve/reject。
 *  6. **ack + timeout**：MDN 明言发送方无法感知对端处理器抛错，短 ack 是唯一已验证的解法。
 *  7. **载荷形状校验 + 固定 type 词表**，未知 type 直接丢弃；一并监听 `messageerror`。
 *  8. **后台静音**（Luigi `skipEventsWhenInactive` 范式）：非活跃期来自子帧的高权限事件
 *     单方面丢弃，否则被隐藏的面板可随时抢占导航/模态 —— 既是 UX bug 也是 UI 劫持面。
 *  9. **不跨边界传函数**：函数代理 = 向不可信侧永久授予能力，沙箱场景反模式。
 *
 * 可见性通知走**窗口通道**而非 port：port 随 `<Activity>` 隐藏时的 effect 清理一起销毁，
 * 「先通知再关管道」有投递竞态；窗口通道则始终可用（子页的 window 监听器常驻）。
 */

/** 不透明 origin 序列化后的字面量。 */
export const OPAQUE_ORIGIN = "null";

/** 宿主 → 子帧（窗口通道，裸 postMessage，无机密）。 */
export type HostHandshakeMessage =
  | { readonly t: "ping"; readonly v: 1 }
  | { readonly t: "init"; readonly v: 1; readonly instanceId: string }
  | { readonly t: "visibility"; readonly v: 1; readonly visible: boolean };

/** 子帧 → 宿主（窗口通道）——只此一种，其余一律丢弃。 */
export interface FrameReadyMessage {
  readonly t: "ready";
  readonly v: 1;
}

/** port 通道消息（双向）。 */
export type PortMessage =
  | { readonly t: "req"; readonly id: string; readonly method: string; readonly params?: unknown }
  | { readonly t: "ack"; readonly id: string }
  | { readonly t: "res"; readonly id: string; readonly ok: true; readonly result?: unknown }
  | { readonly t: "res"; readonly id: string; readonly ok: false; readonly error: string }
  | { readonly t: "evt"; readonly name: string; readonly data?: unknown };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 子帧 → 宿主的握手包形状校验（词表固定，版本必须匹配）。 */
export function isFrameReadyMessage(data: unknown): data is FrameReadyMessage {
  return isRecord(data) && data["t"] === "ready" && data["v"] === 1;
}

export interface HandshakeGuardOptions {
  /** 握手时保存的 `iframe.contentWindow`；**引用相等**是此链路唯一可用的身份锚。 */
  readonly expectedSource: unknown;
  /** 期望的 origin；沙箱不透明 origin 场景为 `"null"`。 */
  readonly expectedOrigin?: string;
}

/**
 * 接收侧三道闸，顺序不可换：① origin 断言 → ② source 引用相等 → ③ 形状校验。
 * 任一不过一律 **丢弃**（不抛、不记录内容——记录即把不可信数据带进日志）。
 */
export function acceptsFrameMessage(
  event: { readonly origin?: unknown; readonly source?: unknown; readonly data?: unknown },
  opts: HandshakeGuardOptions,
): boolean {
  const expectedOrigin = opts.expectedOrigin ?? OPAQUE_ORIGIN;
  if (event.origin !== expectedOrigin) return false;
  if (opts.expectedSource === undefined || opts.expectedSource === null) return false;
  if (event.source !== opts.expectedSource) return false;
  return isFrameReadyMessage(event.data);
}

// ── RPC 端点（transport 无关：浏览器 MessagePort / Node MessageChannel 皆可） ──────

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

export interface RpcEndpointOptions {
  /** 子帧推来的事件。未知形状/静音期的高权限事件不会到达这里。 */
  readonly onEvent?: (name: string, data: unknown) => void;
  /** 非活跃期一律丢弃的事件名（后台面板不得抢占导航/模态/打开模块）。 */
  readonly privilegedEvents?: readonly string[];
  /** 响应超时，默认 15000ms（对齐 vendor ui-rpc）。 */
  readonly requestTimeoutMs?: number;
  /** ack 超时，默认 2000ms —— 用于区分「对端没收到」与「对端在慢慢算」。 */
  readonly ackTimeoutMs?: number;
  /** 反序列化失败（structured clone）时的回调；默认静默。 */
  readonly onMessageError?: () => void;
}

export interface RpcEndpoint {
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  notify(name: string, data?: unknown): void;
  /** 面板是否处于活跃（可见）态；false 时对高权限事件静音。 */
  setActive(active: boolean): void;
  /** 未决请求数（测试用：断言超时后 pending 表被清空，不泄漏）。 */
  pendingCount(): number;
  destroy(): void;
}

interface Pending {
  readonly resolve: (v: unknown) => void;
  readonly reject: (e: Error) => void;
  acked: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export function createRpcEndpoint(
  port: PortLike,
  opts: RpcEndpointOptions = {},
): RpcEndpoint {
  const privileged = new Set(opts.privilegedEvents ?? []);
  const reqTimeout = opts.requestTimeoutMs ?? 15_000;
  const ackTimeout = opts.ackTimeoutMs ?? 2_000;
  const pending = new Map<string, Pending>();
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

  const onMessage = (ev: { data?: unknown }): void => {
    const msg = ev.data;
    if (!isRecord(msg)) return; // 形状不合法 → 丢弃
    switch (msg["t"]) {
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
        // 后台静音：非活跃面板的高权限事件单方面丢弃。
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
        p.timer = setTimeout(() => {
          settle(id, (q) => q.reject(new Error(`rpc no ack: ${id}`)));
        }, Math.min(ackTimeout, timeoutMs ?? reqTimeout));
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
