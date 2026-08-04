/**
 * `reconcilePaneWorkspace` 补齐判定(spec panes-workspace-definition-sync 任务 1.2)。
 *
 * 判据一律选「缺陷存在时会报红」的那一种:
 *  - 「既有 instance 不动」不断言长度或集合(那只要新实例追加在后就自动成立),而断言
 *    instanceId **序列逐一相等** —— 只有这样才能排除「重排」与「换 id 重建」两种错法,
 *    而后者正是桌面原生 WebView 被销毁重建的直接原因。
 *  - 「无可补开」不断言等值(等值新对象照样能通过),而断言 `toBe` 引用相等 —— 调用方
 *    正是靠引用相等跳过 setState 的,等值实现会让每次 definition 变化都白重渲染一轮。
 */
import { describe, expect, it } from "vitest";
import { definePanes, reconcilePaneWorkspace, type PaneWorkspaceState } from "../src/index.js";
import type { PaneDefinitionInput } from "../src/contract.js";

function pane(id: string): PaneDefinitionInput {
  return {
    id,
    title: id,
    document: { kind: "inline", srcDoc: `<!doctype html><p>${id}</p>` },
    capabilities: {},
  };
}

/** `panes` 展开成新数组:zod 的 input 类型是可变数组,直接传 readonly 会 TS4104。 */
function defn(
  ids: readonly string[],
  initialPaneIds: readonly string[],
  maxOpenPanes = 16,
): ReturnType<typeof definePanes> {
  return definePanes({
    id: "test-merged",
    panes: ids.map(pane),
    initialPaneIds: [...initialPaneIds],
    maxOpenPanes,
  });
}

function openState(paneIds: readonly string[]): PaneWorkspaceState {
  const instances = paneIds.map((paneId, index) => ({
    instanceId: `${paneId}-inst`,
    paneId,
    epoch: 1,
    state: index === 0 ? ("connecting" as const) : ("hidden" as const),
  }));
  return { instances, activeInstanceId: instances[0]?.instanceId };
}

const idFactory = (paneId: string): string => `${paneId}-new`;

describe("reconcilePaneWorkspace", () => {
  it("补开清单中新出现且声明为初始打开的 pane", () => {
    // 首帧只有宿主内置 pane,清单补齐后带来三个 agent pane —— 缺陷现场的最小复现。
    const definition = defn(
      ["host:session-info", "search", "materials", "canvas"],
      ["search", "materials", "canvas"],
    );
    const state = openState(["host:session-info"]);

    const next = reconcilePaneWorkspace({ definition, state, knownPaneIds: undefined, idFactory });

    expect(next.instances.map((i) => i.paneId)).toEqual([
      "host:session-info",
      "search",
      "materials",
      "canvas",
    ]);
  });

  it("既有 instance 的 id 序列逐一不变(桌面 WebView 不被重建的机械保证)", () => {
    const definition = defn(["host:session-info", "a", "b"], ["a", "b"]);
    const state = openState(["host:session-info"]);
    const before = state.instances.map((i) => i.instanceId);

    const next = reconcilePaneWorkspace({ definition, state, knownPaneIds: undefined, idFactory });

    // 前缀逐一相等 —— 既排除重排,也排除换 id 重建。
    expect(next.instances.slice(0, before.length).map((i) => i.instanceId)).toEqual(before);
    // 补开不夺焦点。
    expect(next.activeInstanceId).toBe(state.activeInstanceId);
  });

  it("用户见过却未打开的 pane 不被补开", () => {
    // knownPaneIds 含 b 而 state 未打开 b ⇒ 只能是用户主动关掉的,必须尊重。
    const definition = defn(["a", "b", "c"], ["a", "b", "c"]);
    const state = openState(["a"]);

    const next = reconcilePaneWorkspace({
      definition,
      state,
      knownPaneIds: ["a", "b"],
      idFactory,
    });

    expect(next.instances.map((i) => i.paneId)).toEqual(["a", "c"]);
    expect(next.instances.some((i) => i.paneId === "b")).toBe(false);
  });

  it("无可补开时返回入参 state 本身(引用相等,调用方据此跳过 setState)", () => {
    const definition = defn(["a", "b"], ["a", "b"]);
    const state = openState(["a", "b"]);

    const next = reconcilePaneWorkspace({ definition, state, knownPaneIds: ["a", "b"], idFactory });

    expect(next).toBe(state);
  });

  it("超出 maxOpenPanes 时只截断 candidates,既有 instance 一个不动", () => {
    const definition = defn(["a", "b", "c", "d"], ["b", "c", "d"], 3);
    const state = openState(["a"]);

    const next = reconcilePaneWorkspace({ definition, state, knownPaneIds: undefined, idFactory });

    expect(next.instances).toHaveLength(3);
    // 已打开的 a 必须还在,且仍在首位。
    expect(next.instances[0]?.paneId).toBe("a");
    expect(next.instances.map((i) => i.paneId)).toEqual(["a", "b", "c"]);
  });

  it("knownPaneIds 为 undefined 时不推导用户意图,只补未打开的初始 pane", () => {
    // 旧格式快照没有 knownPaneIds。此时无从区分「用户关的」与「没来得及开的」,
    // 按补开处理 —— 该窗口只存在于尚未写出新格式快照的首个会话。
    const definition = defn(["a", "b"], ["a", "b"]);
    const state = openState(["a"]);

    const next = reconcilePaneWorkspace({ definition, state, knownPaneIds: undefined, idFactory });

    expect(next.instances.map((i) => i.paneId)).toEqual(["a", "b"]);
  });

  it("清单里已不存在的初始 pane 不被补开", () => {
    // initialPaneIds 经 merge 后可能残留已被淘汰的来源里的 id;definePanes 会拒绝这种输入,
    // 故此处直接构造已通过校验的 definition 再抽掉 panes,模拟运行期清单收缩。
    const definition = defn(["a", "b"], ["a", "b"]);
    const shrunk = { ...definition, panes: definition.panes.filter((p) => p.id === "a") };
    const state = openState(["a"]);

    const next = reconcilePaneWorkspace({
      definition: shrunk,
      state,
      knownPaneIds: undefined,
      idFactory,
    });

    expect(next).toBe(state);
  });
});
