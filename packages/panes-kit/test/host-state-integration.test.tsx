// @vitest-environment jsdom
/**
 * 共享状态在 `PanesHost` 层的集成(spec panes-only-right-panel;2.2/3.1 受阻的定位测试)。
 *
 * ## 为什么把这条链从 e2e 摘下来
 *
 * 2.2/3.1 在真机上表现为「pane 渲染正常,但 agent 写入后 pane 收不到新值」。在 e2e 里查
 * 一次要 3–5 分钟,且链路太长(stub agent → 服务端 → 控制流 → 宿主访问器 → 绑定 → 帧),
 * 每一段都可能是断点。这里用假的状态源把中间全部摘掉,只验**宿主侧绑定与重绑的生命周期**
 * —— 若这里绿,断点就在 `PanesHost` 之外(访问器或控制流);若这里红,就找到了。
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { definePanes } from "../src/index.js";
import { PanesHost, type PanesStateAccess } from "../src/react/index.js";

afterEach(cleanup);

/** 录制宿主发给 iframe 的所有消息(含转移的 MessagePort)。必须在 render 前装。 */
function recordFrames(): {
  readonly ports: MessagePort[];
  restore(): void;
} {
  const ports: MessagePort[] = [];
  const original = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
  Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
    configurable: true,
    get(this: HTMLIFrameElement) {
      const win = original?.get?.call(this) as (Window & { __rec?: true }) | null;
      if (win !== null && win !== undefined && win.__rec !== true) {
        win.__rec = true;
        (win as unknown as { postMessage: unknown }).postMessage = (
          _m: unknown, _t: unknown, transfer?: readonly MessagePort[],
        ) => {
          for (const p of transfer ?? []) ports.push(p);
        };
      }
      return win;
    },
  });
  return { ports, restore: () => { if (original !== undefined) Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", original); } };
}

/** 可变的假状态源;`bump()` 换出一个**新身份**但共享同一份数据(复现真实的 useMemo 换身份)。 */
function makeStore() {
  const values = new Map<string, unknown>();
  const listeners = new Map<string, Set<(v: unknown) => void>>();
  const access = (): PanesStateAccess => ({
    get: <T,>(k: string) => values.get(k) as T | undefined,
    subscribe(k, l) {
      const s = listeners.get(k) ?? new Set();
      s.add(l); listeners.set(k, s);
      return () => s.delete(l);
    },
    set: async (k, v) => { write(k, v); },
    delete: async (k) => { values.delete(k); },
  });
  const write = (k: string, v: unknown): void => {
    values.set(k, v);
    for (const l of listeners.get(k) ?? []) l(v);
  };
  return { access, write, values };
}

const definition = definePanes({
  id: "state-host-test",
  initialPaneIds: ["p"],
  panes: [{
    id: "p",
    title: "P",
    document: { kind: "inline", srcDoc: "<!doctype html><p>p</p>" },
    capabilities: { state: { read: ["count"], write: ["count"] } },
  }],
});

/** 收集某条连接上收到的 `pane:state` 帧。 */
function collectStateFrames(port: MessagePort): Array<{ key: string; value: unknown }> {
  const seen: Array<{ key: string; value: unknown }> = [];
  port.onmessage = ({ data }: MessageEvent<unknown>) => {
    const d = data as { type?: string; key?: string; value?: unknown };
    if (d?.type === "pane:state") seen.push({ key: d.key as string, value: d.value });
  };
  port.start();
  return seen;
}

describe("共享状态在宿主层的绑定与重绑", () => {
  // jsdom 的 MessagePort **转移**不保留转移前投递的缓冲消息,而建连时的初值推送恰好发生在
  // 转移之前 —— 故这条在 jsdom 下必然收不到。**不是产品缺陷**:真机探针实测建连时确实收到
  // 了一帧初值(见 tasks.md 2.2 的受阻记录)。该行为由 e2e 覆盖,这里跳过而非放宽断言。
  it.skip("★ 建连即推当前值(jsdom 转移语义所限,由 e2e 覆盖)", async () => {
    const rec = recordFrames();
    try {
      const store = makeStore();
      store.write("count", 7);
      const access = store.access();
      render(<PanesHost definition={definition} state={access} />);
      const port = rec.ports[0];
      expect(port).toBeDefined();
      const seen = collectStateFrames(port!);
      await act(async () => { await Promise.resolve(); });
      expect(seen).toContainEqual({ key: "count", value: 7 });
    } finally { rec.restore(); }
  });

  it("★★ 建连后源数据变化 → pane 收到新帧(这正是真机上失败的那一步)", async () => {
    const rec = recordFrames();
    try {
      const store = makeStore();
      const access = store.access();
      render(<PanesHost definition={definition} state={access} />);
      const seen = collectStateFrames(rec.ports[0]!);
      await act(async () => { await Promise.resolve(); });
      seen.length = 0;

      await act(async () => { store.write("count", 1); await Promise.resolve(); });
      expect(seen).toContainEqual({ key: "count", value: 1 });
    } finally { rec.restore(); }
  });

  it("★★★ 访问器换身份后,后续变化仍能送达(重绑生命周期)", async () => {
    const rec = recordFrames();
    try {
      const store = makeStore();
      const view = render(<PanesHost definition={definition} state={store.access()} />);
      const seen = collectStateFrames(rec.ports[0]!);
      await act(async () => { await Promise.resolve(); });

      // 真实场景:会话就绪握手/控制流重开 → 宿主 useMemo 换出新访问器实例。
      await act(async () => {
        view.rerender(<PanesHost definition={definition} state={store.access()} />);
        await Promise.resolve();
      });
      seen.length = 0;

      await act(async () => { store.write("count", 42); await Promise.resolve(); });
      // 若重绑没做对,这里收不到 —— 而真机症状正是「值永远不更新」。
      expect(seen).toContainEqual({ key: "count", value: 42 });
    } finally { rec.restore(); }
  });

  it("★ 未授权的键不推送", async () => {
    const rec = recordFrames();
    try {
      const store = makeStore();
      render(<PanesHost definition={definition} state={store.access()} />);
      const seen = collectStateFrames(rec.ports[0]!);
      await act(async () => { store.write("secret", "x"); await Promise.resolve(); });
      expect(seen.filter((f) => f.key === "secret")).toEqual([]);
    } finally { rec.restore(); }
  });
});
