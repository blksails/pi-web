import { describe, expect, it, vi } from "vitest";
import {
  acceptsFrameMessage,
  connectSandboxFrame,
  type ChannelLike,
  type MessageEventLike,
} from "../host.js";
import { connectToHost, type GuestMessageEventLike } from "../guest.js";
import type { PortLike } from "../endpoint.js";

/** 可手工投递的 window 桩（宿主侧与子帧侧共用形状）。 */
function makeWindow(): {
  addEventListener(t: "message", l: (ev: never) => void): void;
  removeEventListener(t: "message", l: (ev: never) => void): void;
  emit(ev: unknown): void;
  count(): number;
} {
  const ls = new Set<(ev: never) => void>();
  return {
    addEventListener: (_t, l) => void ls.add(l),
    removeEventListener: (_t, l) => void ls.delete(l),
    emit: (ev) => {
      for (const l of [...ls]) l(ev as never);
    },
    count: () => ls.size,
  };
}

/** 内存 MessageChannel：port1/port2 互通。 */
function makeChannel(): ChannelLike {
  const mk = (): PortLike & { ls: Set<(ev: { data?: unknown }) => void>; peer?: { ls: Set<(ev: { data?: unknown }) => void> } } => {
    const ls = new Set<(ev: { data?: unknown }) => void>();
    const self = {
      ls,
      peer: undefined as never,
      postMessage(data: unknown): void {
        const target = self.peer as unknown as { ls: Set<(ev: { data?: unknown }) => void> } | undefined;
        if (target === undefined) return;
        for (const l of [...target.ls]) l({ data });
      },
      addEventListener: (_t: string, l: (ev: { data?: unknown }) => void) => void ls.add(l),
      removeEventListener: (_t: string, l: (ev: { data?: unknown }) => void) => void ls.delete(l),
    };
    return self as never;
  };
  const port1 = mk();
  const port2 = mk();
  (port1 as { peer?: unknown }).peer = port2;
  (port2 as { peer?: unknown }).peer = port1;
  return { port1, port2 };
}

describe("acceptsFrameMessage · 三道闸", () => {
  const contentWindow = { postMessage: (): void => {} };
  const ok: MessageEventLike = {
    origin: "null",
    source: contentWindow,
    data: { t: "ready", v: 1 },
  };

  it("放行合法握手包", () => {
    expect(acceptsFrameMessage(ok, { expectedSource: contentWindow })).toBe(true);
  });

  it("非不透明 origin → 丢弃(收到别的 origin 说明不是那个沙箱)", () => {
    expect(
      acceptsFrameMessage({ ...ok, origin: "https://evil.example" }, { expectedSource: contentWindow }),
    ).toBe(false);
  });

  it("source 非引用相等 → 丢弃(伪造者拿不到那个 contentWindow 引用)", () => {
    expect(
      acceptsFrameMessage({ ...ok, source: { postMessage: (): void => {} } }, { expectedSource: contentWindow }),
    ).toBe(false);
  });

  it("expectedSource 尚未就绪(null/undefined) → 一律丢弃,不退化成放行", () => {
    expect(acceptsFrameMessage(ok, { expectedSource: null })).toBe(false);
    expect(acceptsFrameMessage(ok, { expectedSource: undefined })).toBe(false);
  });

  it("形状/版本不符 → 丢弃", () => {
    expect(acceptsFrameMessage({ ...ok, data: { t: "ready", v: 2 } }, { expectedSource: contentWindow })).toBe(false);
    expect(acceptsFrameMessage({ ...ok, data: { t: "init", v: 1 } }, { expectedSource: contentWindow })).toBe(false);
    expect(acceptsFrameMessage({ ...ok, data: "ready" }, { expectedSource: contentWindow })).toBe(false);
  });
});

describe("connectSandboxFrame · 握手驱动", () => {
  it("轮询 ping,收到 ready 后停轮询并按「可见性先于 init」的次序交付端口", () => {
    vi.useFakeTimers();
    const posted: Array<{ msg: { t: string }; transfer?: readonly unknown[] }> = [];
    const contentWindow = {
      postMessage: (msg: unknown, _o: string, transfer?: readonly unknown[]) =>
        void posted.push({ msg: msg as { t: string }, ...(transfer !== undefined ? { transfer } : {}) }),
    };
    const win = makeWindow();
    const conn = connectSandboxFrame({
      frame: { contentWindow },
      instanceId: "m1",
      hostWindow: win,
      createChannel: makeChannel,
      pingIntervalMs: 50,
    });
    expect(posted.map((p) => p.msg.t)).toEqual(["ping"]);
    vi.advanceTimersByTime(120);
    expect(posted.filter((p) => p.msg.t === "ping").length).toBe(3);

    win.emit({ origin: "null", source: contentWindow, data: { t: "ready", v: 1 } });
    expect(posted.map((p) => p.msg.t).slice(-2)).toEqual(["visibility", "init"]);
    expect(posted.at(-1)?.transfer).toHaveLength(1);
    expect(conn.endpoint()).not.toBeNull();

    // 停轮询：再走时间不应再发 ping。
    const before = posted.length;
    vi.advanceTimersByTime(500);
    expect(posted.length).toBe(before);
    conn.destroy();
    expect(win.count()).toBe(0);
    vi.useRealTimers();
  });

  it("伪造 ready(source 不符)不建立连接", () => {
    vi.useFakeTimers();
    const contentWindow = { postMessage: (): void => {} };
    const win = makeWindow();
    const conn = connectSandboxFrame({
      frame: { contentWindow },
      instanceId: "m1",
      hostWindow: win,
      createChannel: makeChannel,
    });
    win.emit({ origin: "null", source: { postMessage: (): void => {} }, data: { t: "ready", v: 1 } });
    expect(conn.endpoint()).toBeNull();
    conn.destroy();
    vi.useRealTimers();
  });

  it("超时未握上手 → 回调,并停止轮询", () => {
    vi.useFakeTimers();
    const onHandshakeTimeout = vi.fn();
    const contentWindow = { postMessage: (): void => {} };
    const conn = connectSandboxFrame({
      frame: { contentWindow },
      instanceId: "m1",
      hostWindow: makeWindow(),
      createChannel: makeChannel,
      pingIntervalMs: 50,
      handshakeTimeoutMs: 300,
      onHandshakeTimeout,
    });
    vi.advanceTimersByTime(400);
    expect(onHandshakeTimeout).toHaveBeenCalledTimes(1);
    expect(conn.endpoint()).toBeNull();
    conn.destroy();
    vi.useRealTimers();
  });
});

describe("connectToHost · 子帧侧", () => {
  it("应答 ping、接管端口、透出可见性;非父帧来源一律丢弃", () => {
    const sent: unknown[] = [];
    const parent = { postMessage: (d: unknown) => void sent.push(d) };
    const win = makeWindow();
    const seen: boolean[] = [];
    const guest = connectToHost({
      guestWindow: { ...win, parent } as never,
      onVisibility: (v) => void seen.push(v),
      handlers: { echo: (p) => p },
    });

    // 非父帧来源 → 丢弃。
    win.emit({ source: { postMessage: (): void => {} }, data: { t: "ping", v: 1 } } satisfies GuestMessageEventLike);
    expect(sent).toHaveLength(0);

    win.emit({ source: parent, data: { t: "ping", v: 1 } } satisfies GuestMessageEventLike);
    expect(sent).toEqual([{ t: "ready", v: 1 }]);

    win.emit({ source: parent, data: { t: "visibility", v: 1, visible: false } });
    expect(seen).toEqual([false]);
    expect(guest.isVisible()).toBe(false);

    const ch = makeChannel();
    win.emit({ source: parent, data: { t: "init", v: 1, instanceId: "m1" }, ports: [ch.port2] });
    expect(guest.endpoint()).not.toBeNull();
    guest.destroy();
  });

  it("重复 init 换管道(旧端点销毁),不泄漏", async () => {
    const parent = { postMessage: (): void => {} };
    const win = makeWindow();
    const guest = connectToHost({ guestWindow: { ...win, parent } as never });
    const ch1 = makeChannel();
    win.emit({ source: parent, data: { t: "init", v: 1, instanceId: "m1" }, ports: [ch1.port2] });
    const first = guest.endpoint();
    const ch2 = makeChannel();
    win.emit({ source: parent, data: { t: "init", v: 1, instanceId: "m1" }, ports: [ch2.port2] });
    expect(guest.endpoint()).not.toBe(first);
    // 旧端点已销毁 ⇒ 拒发。
    await expect(first?.request("x")).rejects.toThrow(/destroyed/);
    guest.destroy();
  });
});

describe("host ↔ guest 端到端", () => {
  it("握手完成后子帧可反向调用宿主开放的方法", async () => {
    vi.useFakeTimers();
    const guestWin = makeWindow();
    // 子帧的 contentWindow：宿主 post 过来的包直接喂给子帧的 window 监听器。
    const contentWindow = {
      postMessage: (data: unknown, _o: string, transfer?: readonly unknown[]) =>
        void guestWin.emit({ source: hostParent, data, ports: transfer ?? [] }),
    };
    const hostWin = makeWindow();
    // 子帧眼里的 parent：把 ready 包喂回宿主的 window 监听器。
    const hostParent = {
      postMessage: (data: unknown) =>
        void hostWin.emit({ origin: "null", source: contentWindow, data }),
    };

    const guest = connectToHost({
      guestWindow: { ...guestWin, parent: hostParent } as never,
      handlers: { ping: () => "pong" },
    });
    const conn = connectSandboxFrame({
      frame: { contentWindow },
      instanceId: "m1",
      hostWindow: hostWin,
      createChannel: makeChannel,
      endpoint: { handlers: { hostTime: () => 1234 } },
    });

    vi.advanceTimersByTime(1); // 让首个 ping 走完
    expect(conn.endpoint()).not.toBeNull();
    vi.useRealTimers();

    await expect(conn.endpoint()?.request("ping")).resolves.toBe("pong");
    await expect(guest.endpoint()?.request("hostTime")).resolves.toBe(1234);

    conn.destroy();
    guest.destroy();
  });
});
