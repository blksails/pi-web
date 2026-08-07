import { describe, expect, it, vi } from "vitest";
import { createRpcEndpoint, type PortLike } from "../endpoint.js";

/** 内存版 `MessagePort` 对：postMessage 同步投递到对端的监听器。 */
function makePortPair(): { a: PortLike & { sent: unknown[] }; b: PortLike & { sent: unknown[] } } {
  const mk = (): PortLike & { sent: unknown[]; peer?: PortLike & { sent: unknown[] } } => {
    const ls = new Set<(ev: { data?: unknown }) => void>();
    const self = {
      sent: [] as unknown[],
      peer: undefined as never,
      postMessage(data: unknown): void {
        self.sent.push(data);
        const target = (self as { peer?: { ls: Set<(ev: { data?: unknown }) => void> } }).peer;
        if (target === undefined) return;
        for (const l of [...target.ls]) l({ data });
      },
      addEventListener(_t: string, l: (ev: { data?: unknown }) => void): void {
        ls.add(l);
      },
      removeEventListener(_t: string, l: (ev: { data?: unknown }) => void): void {
        ls.delete(l);
      },
      ls,
    };
    return self as never;
  };
  const a = mk();
  const b = mk();
  (a as { peer?: unknown }).peer = b;
  (b as { peer?: unknown }).peer = a;
  return { a: a as never, b: b as never };
}

describe("createRpcEndpoint · 出站请求", () => {
  it("无 ack 时短超时 reject,且 pending 表被清空(不泄漏)", async () => {
    vi.useFakeTimers();
    const { a } = makePortPair(); // 无对端端点 ⇒ 永远不会有 ack
    const ep = createRpcEndpoint(a, { ackTimeoutMs: 50, requestTimeoutMs: 5000 });
    const p = ep.request("noop");
    expect(ep.pendingCount()).toBe(1);
    vi.advanceTimersByTime(51);
    await expect(p).rejects.toThrow(/no ack/);
    expect(ep.pendingCount()).toBe(0);
    vi.useRealTimers();
  });

  it("收到 ack 后改用更长的响应计时(两段独立)", async () => {
    vi.useFakeTimers();
    const { a, b } = makePortPair();
    // 对端只 ack、永不 res。
    b.addEventListener("message", (ev) => {
      const m = ev.data as { t?: string; id?: string };
      if (m?.t === "req" && typeof m.id === "string") b.postMessage({ t: "ack", id: m.id });
    });
    const ep = createRpcEndpoint(a, { ackTimeoutMs: 50, requestTimeoutMs: 500 });
    const p = ep.request("slow");
    // 已 ack ⇒ 越过 ack 时限不该 reject。
    vi.advanceTimersByTime(200);
    expect(ep.pendingCount()).toBe(1);
    vi.advanceTimersByTime(400);
    await expect(p).rejects.toThrow(/timeout/);
    expect(ep.pendingCount()).toBe(0);
    vi.useRealTimers();
  });

  it("destroy() 后拒发、且未决请求全部 reject", async () => {
    const { a } = makePortPair();
    const ep = createRpcEndpoint(a, { ackTimeoutMs: 10_000 });
    const p = ep.request("x");
    ep.destroy();
    await expect(p).rejects.toThrow(/destroyed/);
    await expect(ep.request("y")).rejects.toThrow(/destroyed/);
    expect(ep.pendingCount()).toBe(0);
  });
});

describe("createRpcEndpoint · 入站服务(双向)", () => {
  it("收到 req → ack → 执行 handler → res", async () => {
    const { a, b } = makePortPair();
    const server = createRpcEndpoint(b, {
      handlers: { add: (p) => (p as { n: number }).n + 1 },
    });
    const client = createRpcEndpoint(a, { ackTimeoutMs: 1000 });
    await expect(client.request("add", { n: 41 })).resolves.toBe(42);
    // ack 必须先于 res 发出(否则慢 handler 会被误判成「没收到」)。
    const kinds = (b.sent as Array<{ t: string }>).map((m) => m.t);
    expect(kinds).toEqual(["ack", "res"]);
    server.destroy();
    client.destroy();
  });

  it("未知 method 回结构化错误;method 名仅在字符集受控时回显", async () => {
    const { a, b } = makePortPair();
    const server = createRpcEndpoint(b, { handlers: {} });
    const client = createRpcEndpoint(a, { ackTimeoutMs: 1000 });
    await expect(client.request("nope")).rejects.toThrow("unknown method: nope");
    // 含控制字符/换行的 method 名不回显(日志注入与转义放大面)。
    await expect(client.request("bad\nname[31m")).rejects.toThrow(
      /^unknown method$/,
    );
    server.destroy();
    client.destroy();
  });

  it("handler 抛错不把内部信息送过边界", async () => {
    const { a, b } = makePortPair();
    const server = createRpcEndpoint(b, {
      handlers: {
        boom: () => {
          throw new Error("SECRET /etc/passwd at line 42");
        },
      },
    });
    const client = createRpcEndpoint(a, { ackTimeoutMs: 1000 });
    await expect(client.request("boom")).rejects.toThrow(/^handler error$/);
    expect(JSON.stringify(b.sent)).not.toContain("SECRET");
    server.destroy();
    client.destroy();
  });

  it("入站并发超限立即回错误,不排队", async () => {
    const { a, b } = makePortPair();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const server = createRpcEndpoint(b, {
      maxConcurrentInbound: 2,
      handlers: { hold: async () => await gate },
    });
    const client = createRpcEndpoint(a, { ackTimeoutMs: 1000 });
    const p1 = client.request("hold");
    const p2 = client.request("hold");
    const p3 = client.request("hold");
    await expect(p3).rejects.toThrow(/too many inflight/);
    expect(server.inboundCount()).toBe(2);
    release?.();
    await Promise.all([p1, p2]);
    server.destroy();
    client.destroy();
  });

  it("原型链上的 method 不会被当成 handler(hasOwnProperty 守卫)", async () => {
    const { a, b } = makePortPair();
    const server = createRpcEndpoint(b, { handlers: {} });
    const client = createRpcEndpoint(a, { ackTimeoutMs: 1000 });
    await expect(client.request("toString")).rejects.toThrow(/unknown method/);
    await expect(client.request("constructor")).rejects.toThrow(/unknown method/);
    server.destroy();
    client.destroy();
  });
});

describe("createRpcEndpoint · 事件与丢弃语义", () => {
  it("后台静音:非活跃期高权限事件被丢弃,普通事件照常", () => {
    const { a, b } = makePortPair();
    const seen: string[] = [];
    const ep = createRpcEndpoint(a, {
      privilegedEvents: ["navigate"],
      onEvent: (n) => seen.push(n),
    });
    b.postMessage({ t: "evt", name: "navigate" });
    b.postMessage({ t: "evt", name: "tick" });
    expect(seen).toEqual(["navigate", "tick"]);
    ep.setActive(false);
    b.postMessage({ t: "evt", name: "navigate" });
    b.postMessage({ t: "evt", name: "tick" });
    expect(seen).toEqual(["navigate", "tick", "tick"]);
    ep.destroy();
  });

  it("未知 type / 畸形载荷一律丢弃,不触发任何回调", () => {
    const { a, b } = makePortPair();
    const onEvent = vi.fn();
    const ep = createRpcEndpoint(a, { onEvent });
    b.postMessage("string payload");
    b.postMessage(null);
    b.postMessage({ t: "eval", code: "1+1" });
    b.postMessage({ t: "evt" }); // 缺 name
    b.postMessage({ t: "req", id: 1, method: "x" }); // id 非串
    expect(onEvent).not.toHaveBeenCalled();
    ep.destroy();
  });

  it("messageerror(structured clone 失败)有独立回调", () => {
    const { a } = makePortPair();
    const onMessageError = vi.fn();
    const ep = createRpcEndpoint(a, { onMessageError });
    // 直接驱动监听器：内存桩不区分通道，取端口自身的 messageerror 注册。
    (a as unknown as { ls: Set<(ev: unknown) => void> }).ls.forEach((l) => l({ data: undefined }));
    ep.destroy();
    expect(onMessageError).toHaveBeenCalledTimes(1);
  });
});
