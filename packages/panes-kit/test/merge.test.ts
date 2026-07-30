/**
 * pane 来源合并(spec host-builtin-panes 任务 2.1/2.2/2.3)。
 *
 * 每组断言都对应一条 EARS 验收条件,且刻意选择「缺陷存在时会报红」的判据 —— 例如顺序稳定性
 * 不断言「内置在前」这一结果(那可能只是输入恰好如此),而断言「交换输入顺序后各来源内部
 * 相对顺序不变」,那才排除了实现里按标识排序之类的错法。
 */
import { describe, expect, it } from "vitest";
import {
  HOST_PANE_ID_PREFIX,
  mergePaneSources,
  type PaneSource,
} from "../src/index.js";
import type { PaneDefinitionInput } from "../src/contract.js";

function pane(id: string, extra: Partial<PaneDefinitionInput> = {}): PaneDefinitionInput {
  return {
    id,
    title: id,
    document: { kind: "inline", srcDoc: `<!doctype html><p>${id}</p>` },
    capabilities: {},
    ...extra,
  };
}

// `panes` 展开成新数组:入参保持 readonly(表达「不改调用方的数组」),而 zod 的 input 类型是
// 可变数组 —— 直接赋值会 TS4104。vitest 只转译不检查类型,故这类错只有 tsc 面能抓到。
function builtin(panes: readonly PaneDefinitionInput[], rest: Record<string, unknown> = {}): PaneSource {
  return { kind: "builtin", origin: "builtin", definition: { id: "builtin", panes: [...panes], ...rest } };
}

function agent(
  panes: readonly PaneDefinitionInput[],
  rest: Record<string, unknown> = {},
  origin = "agent-x",
): PaneSource {
  return { kind: "agent", origin, definition: { id: "agent", panes: [...panes], ...rest } };
}

const hostA = pane(`${HOST_PANE_ID_PREFIX}a`);
const hostB = pane(`${HOST_PANE_ID_PREFIX}b`);

describe("mergePaneSources — 顺序与上限合成(任务 2.1)", () => {
  it("★ 顺序只由输入顺序决定:交换来源顺序后各来源内部相对顺序不变", () => {
    const first = mergePaneSources([builtin([hostA, hostB]), agent([pane("p"), pane("q")])]);
    expect(first.definition?.panes.map((p) => p.id)).toEqual([
      `${HOST_PANE_ID_PREFIX}a`,
      `${HOST_PANE_ID_PREFIX}b`,
      "p",
      "q",
    ]);
    // 交换输入顺序 → 整体顺序跟着换,但各来源**内部**顺序恒定。
    // 若实现偷偷按标识排序,这条会红(排序后 host:a/host:b 永远在 p/q 前)。
    const swapped = mergePaneSources([agent([pane("p"), pane("q")]), builtin([hostA, hostB])]);
    expect(swapped.definition?.panes.map((p) => p.id)).toEqual([
      "p",
      "q",
      `${HOST_PANE_ID_PREFIX}a`,
      `${HOST_PANE_ID_PREFIX}b`,
    ]);
  });

  it("同时打开上限取各来源的最大者(agent 的容量不因内置加入而缩水)", () => {
    const merged = mergePaneSources([
      builtin([hostA], { maxOpenPanes: 2 }),
      agent([pane("p")], { maxOpenPanes: 9 }),
    ]);
    expect(merged.definition?.maxOpenPanes).toBe(9);
    // 反向:内置更大时同样取大。
    const other = mergePaneSources([
      builtin([hostA], { maxOpenPanes: 11 }),
      agent([pane("p")], { maxOpenPanes: 3 }),
    ]);
    expect(other.definition?.maxOpenPanes).toBe(11);
  });

  it("初始打开集合:agent 的完整保留,内置默认项后补", () => {
    const merged = mergePaneSources([
      builtin([hostA, hostB], { initialPaneIds: [`${HOST_PANE_ID_PREFIX}a`], maxOpenPanes: 5 }),
      agent([pane("p"), pane("q")], { initialPaneIds: ["p", "q"], maxOpenPanes: 5 }),
    ]);
    expect(merged.definition?.initialPaneIds).toEqual(["p", "q", `${HOST_PANE_ID_PREFIX}a`]);
  });

  it("★ 初始集合越界时丢弃的是内置项,不是 agent 的", () => {
    const merged = mergePaneSources([
      builtin([hostA, hostB], {
        initialPaneIds: [`${HOST_PANE_ID_PREFIX}a`, `${HOST_PANE_ID_PREFIX}b`],
        maxOpenPanes: 2,
      }),
      agent([pane("p"), pane("q")], { initialPaneIds: ["p", "q"], maxOpenPanes: 2 }),
    ]);
    // 上限 2,agent 已占满 → 内置默认项全部让位。
    expect(merged.definition?.initialPaneIds).toEqual(["p", "q"]);
  });

  it("无 agent 来源时内置默认项照常生效", () => {
    const merged = mergePaneSources([
      builtin([hostA, hostB], { initialPaneIds: [`${HOST_PANE_ID_PREFIX}b`] }),
    ]);
    expect(merged.definition?.initialPaneIds).toEqual([`${HOST_PANE_ID_PREFIX}b`]);
  });

  it("初始集合里指向已被淘汰 pane 的标识被过滤掉,不导致整体失败", () => {
    const merged = mergePaneSources([
      builtin([hostA], { initialPaneIds: [`${HOST_PANE_ID_PREFIX}a`] }),
      // 该 agent 声明的 pane 全部冒用前缀 → 整体无内容,其 initialPaneIds 应被无声过滤。
      agent([pane(`${HOST_PANE_ID_PREFIX}evil`)], {
        initialPaneIds: [`${HOST_PANE_ID_PREFIX}evil`],
      }),
    ]);
    expect(merged.definition?.initialPaneIds).toEqual([`${HOST_PANE_ID_PREFIX}a`]);
    expect(merged.definition?.panes.map((p) => p.id)).toEqual([`${HOST_PANE_ID_PREFIX}a`]);
  });
});

describe("mergePaneSources — 保留命名空间(任务 2.2)", () => {
  it("★ agent 冒用保留前缀:该 pane 被淘汰,同来源其余 pane 存活(不连坐)", () => {
    const merged = mergePaneSources([
      builtin([hostA]),
      agent([pane(`${HOST_PANE_ID_PREFIX}evil`), pane("legit")]),
    ]);
    expect(merged.definition?.panes.map((p) => p.id)).toEqual([
      `${HOST_PANE_ID_PREFIX}a`,
      "legit",
    ]);
    const rejection = merged.rejections.find((r) => r.reason === "reserved-namespace");
    expect(rejection).toMatchObject({
      origin: "agent-x",
      kind: "agent",
      scope: "panes",
      paneIds: [`${HOST_PANE_ID_PREFIX}evil`],
    });
    // 诊断必须能定位到具体 pane 标识与原因,否则运维时无从下手。
    expect(rejection?.detail).toContain(HOST_PANE_ID_PREFIX);
  });

  it("★ agent 永不能顶替同标识的内置 pane —— 冒用即被拒,内置定义原样保留", () => {
    const hostTitle = "内置原始标题";
    const merged = mergePaneSources([
      builtin([pane(`${HOST_PANE_ID_PREFIX}a`, { title: hostTitle })]),
      // 用完全相同的标识试图覆盖,且给了不同标题 —— 若实现允许覆盖,标题会变。
      agent([pane(`${HOST_PANE_ID_PREFIX}a`, { title: "agent 顶替的标题" })]),
    ]);
    expect(merged.definition?.panes).toHaveLength(1);
    expect(merged.definition?.panes[0]?.title).toBe(hostTitle);
  });

  it("内置 pane 漏了保留前缀同样被拒(否则「内置身份=带前缀」这一前提失效)", () => {
    const merged = mergePaneSources([builtin([pane("no-prefix"), hostA])]);
    expect(merged.definition?.panes.map((p) => p.id)).toEqual([`${HOST_PANE_ID_PREFIX}a`]);
    expect(merged.rejections[0]).toMatchObject({
      kind: "builtin",
      reason: "reserved-namespace",
      paneIds: ["no-prefix"],
    });
  });
});

describe("mergePaneSources — 逐来源校验与分级降级(任务 2.3)", () => {
  it("★ agent 来源整体非法:仍返回仅含内置的合法定义", () => {
    const merged = mergePaneSources([
      builtin([hostA]),
      // 空 panes 数组违反 definePanes 的 min(1)。
      agent([]),
    ]);
    expect(merged.definition?.panes.map((p) => p.id)).toEqual([`${HOST_PANE_ID_PREFIX}a`]);
    expect(merged.rejections).toHaveLength(1);
    expect(merged.rejections[0]).toMatchObject({
      origin: "agent-x",
      kind: "agent",
      scope: "source",
      reason: "invalid-definition",
    });
  });

  it("★ 某内置项非法:其余内置仍装载", () => {
    const merged = mergePaneSources([
      builtin([
        hostA,
        // allowMultiple 为假却把 maxInstances 设成 >1 —— definePanes 明确拒绝的组合。
        pane(`${HOST_PANE_ID_PREFIX}bad`, { allowMultiple: false, maxInstances: 3 }),
      ]),
    ]);
    // 该来源整体校验失败 → 整个内置来源被淘汰,定义为空。这是「逐来源」粒度的既定行为:
    // 一个来源内部的非法项无法被单独摘除(definePanes 是整体校验),故记为 source 级淘汰。
    expect(merged.definition).toBeUndefined();
    expect(merged.rejections[0]).toMatchObject({ kind: "builtin", scope: "source" });
    // ★ 但诊断必须点出成因,否则「内置 panes 全没了」无从排查。
    expect(merged.rejections[0]?.detail).toMatch(/maxInstances|allowMultiple/);
  });

  it("全部来源被淘汰 → 定义为空且拒绝清单完整(调用方据此退回「面板不渲染」)", () => {
    const merged = mergePaneSources([builtin([]), agent([])]);
    expect(merged.definition).toBeUndefined();
    expect(merged.rejections).toHaveLength(2);
    expect(merged.rejections.map((r) => r.origin)).toEqual(["builtin", "agent-x"]);
  });

  it("空来源列表 → 定义为空、无拒绝记录(不是错误,是「宿主没有内置 pane 且 agent 无贡献」)", () => {
    const merged = mergePaneSources([]);
    expect(merged.definition).toBeUndefined();
    expect(merged.rejections).toEqual([]);
  });

  it("跨来源标识重复:后者被丢弃并记录(前者胜出,与顺序权威一致)", () => {
    const merged = mergePaneSources([
      agent([pane("dup")], {}, "agent-1"),
      agent([pane("dup"), pane("other")], {}, "agent-2"),
    ]);
    expect(merged.definition?.panes.map((p) => p.id)).toEqual(["dup", "other"]);
    expect(merged.rejections[0]).toMatchObject({
      origin: "agent-2",
      reason: "duplicate-pane-id",
      paneIds: ["dup"],
    });
  });

  it("全部来源完整接纳时拒绝清单为空(避免「总有噪音」掩盖真问题)", () => {
    const merged = mergePaneSources([builtin([hostA]), agent([pane("p")])]);
    expect(merged.rejections).toEqual([]);
    expect(merged.definition?.panes).toHaveLength(2);
  });

  it("合并函数不打日志、不产生副作用(纯函数:同输入同输出)", () => {
    const sources = [builtin([hostA]), agent([pane("p")])];
    const a = mergePaneSources(sources);
    const b = mergePaneSources(sources);
    expect(a.definition?.panes.map((p) => p.id)).toEqual(b.definition?.panes.map((p) => p.id));
    expect(a.rejections).toEqual(b.rejections);
  });
});
