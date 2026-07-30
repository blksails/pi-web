/**
 * guest 侧共享状态门面(spec panes-only-right-panel 任务 1.3;Req 2.1/2.2/2.3)。
 *
 * ★ 核心性质是**调用形状与宿主侧既有访问器逐一对应**:迁移方从旧槽搬进 pane 时只改
 * 「从哪拿到它」,`get/subscribe/set/delete` 一个字都不用改。若形状漂了,每个迁移任务都要
 * 额外改一遍调用点 —— 而那正是迁移最容易出错的地方。
 */
import { describe, expect, it } from "vitest";
import { PANE_PROTOCOL_VERSION, connectPaneGuest } from "../src/index.js";
import type { PaneGuestConnection } from "../src/guest.js";
import { FakeGuestWindow } from "./conformance/fake-guest-window.js";

async function connect(
  grantState: { read: string[]; write: string[] } = { read: [], write: [] },
): Promise<{ conn: PaneGuestConnection; host: MessagePort }> {
  const guestWindow = new FakeGuestWindow();
  const pending = connectPaneGuest({ expectedPaneId: "p", window: guestWindow.asWindow() });
  const channel = new MessageChannel();
  guestWindow.postMessage({
    type: "pane:connected",
    protocol: PANE_PROTOCOL_VERSION,
    instance: { instanceId: "p-1", paneId: "p", epoch: 1 },
    grants: {
      routes: [],
      surfaceCommands: [],
      surfaceKeys: [],
      events: { publish: [], subscribe: [] },
      attachments: "none",
      conversation: "none",
      state: grantState,
    },
    interactionMode: "standard",
  }, "*", [channel.port2]);
  const conn = await pending;
  channel.port1.start();
  return { conn, host: channel.port1 };
}

/** 让出一轮宏任务,使 MessagePort 的投递被处理。 */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("门面形状与宿主访问器一致(Req 2.3)", () => {
  it("★ 暴露 get / subscribe / set / delete 四个操作,缺一不可", async () => {
    const { conn } = await connect();
    // 逐项断言而非 toMatchObject:少任何一个都会让某个迁移方的调用点编译不过,
    // 而那时才发现就晚了。
    expect(typeof conn.state.get).toBe("function");
    expect(typeof conn.state.subscribe).toBe("function");
    expect(typeof conn.state.set).toBe("function");
    expect(typeof conn.state.delete).toBe("function");
  });

  it("授权表原样透出,guest 可据此自行降级", async () => {
    const { conn } = await connect({ read: ["counter"], write: ["counter"] });
    expect(conn.grants.state).toEqual({ read: ["counter"], write: ["counter"] });
  });
});

describe("读与订阅(Req 2.1/2.2)", () => {
  it("宿主推送后 get 读到新值", async () => {
    const { conn, host } = await connect({ read: ["counter"], write: [] });
    expect(conn.state.get("counter")).toBeUndefined();
    host.postMessage({ type: "pane:state", key: "counter", value: 7 });
    await flush();
    expect(conn.state.get<number>("counter")).toBe(7);
  });

  it("订阅者收到变化", async () => {
    const { conn, host } = await connect({ read: ["counter"], write: [] });
    const seen: unknown[] = [];
    conn.state.subscribe("counter", (v) => seen.push(v));
    host.postMessage({ type: "pane:state", key: "counter", value: 1 });
    host.postMessage({ type: "pane:state", key: "counter", value: 2 });
    await flush();
    expect(seen).toEqual([1, 2]);
  });

  it("★ 退订后不再收到(否则 pane 卸载后仍在跑回调)", async () => {
    const { conn, host } = await connect({ read: ["counter"], write: [] });
    const seen: unknown[] = [];
    const off = conn.state.subscribe("counter", (v) => seen.push(v));
    host.postMessage({ type: "pane:state", key: "counter", value: 1 });
    await flush();
    off();
    host.postMessage({ type: "pane:state", key: "counter", value: 2 });
    await flush();
    expect(seen).toEqual([1]);
  });

  it("★ 共享状态与 agent 权威快照互不串台(两条通道事实源不同)", async () => {
    const { conn, host } = await connect({ read: ["k"], write: [] });
    // 同名 key 分别经两条帧下行 —— 混用会让「谁是权威」失去意义。
    host.postMessage({ type: "pane:state", key: "k", value: "from-state" });
    host.postMessage({ type: "pane:surface", key: "k", value: "from-surface" });
    await flush();
    expect(conn.state.get("k")).toBe("from-state");
    expect(conn.surface.getState("k")).toBe("from-surface");
  });
});

describe("写回(Req 2.3)", () => {
  it("★ set 发出写回请求,键与值原样带上", async () => {
    const { conn, host } = await connect({ read: [], write: ["draft"] });
    const sent: unknown[] = [];
    host.addEventListener("message", (e) => sent.push((e as MessageEvent).data));
    void conn.state.set("draft", { title: "x" });
    await flush();
    expect(sent).toContainEqual(
      expect.objectContaining({ operation: "state.set", key: "draft", value: { title: "x" } }),
    );
  });

  it("★ delete 发出删除请求(不带 value)", async () => {
    const { conn, host } = await connect({ read: [], write: ["draft"] });
    const sent: Array<Record<string, unknown>> = [];
    host.addEventListener("message", (e) => sent.push((e as MessageEvent).data as Record<string, unknown>));
    void conn.state.delete("draft");
    await flush();
    const del = sent.find((m) => m.operation === "state.delete");
    expect(del).toBeDefined();
    expect(del).toMatchObject({ key: "draft" });
    // 删除没有载荷 —— 带上 value 会让宿主侧的超限校验对着 undefined 算字节。
    expect("value" in (del ?? {})).toBe(false);
  });
});
