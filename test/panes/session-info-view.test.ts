/**
 * `host:session-info` 视图层(spec host-builtin-panes 任务 3.1)。
 *
 * 重点不是「能渲染」,而是**畸形载荷不把 pane 打死**。既有教训:通道返回值的泛型是断言不是
 * 校验,宿主把 404 错误体当正常结果 resolve 回来时,直接解构会在渲染期崩溃、整个 pane 被卸载。
 * 所以这里逐一喂入非对象、null、缺字段、类型不符的载荷,断言每一种都产出可见内容且不抛错。
 */
import { describe, expect, it } from "vitest";
import { readFacts, render, SESSION_SIGNAL } from "../../panes/session-info/view.js";

const FULL = { sessionId: "s-1", agentSource: "builtin:default-agent", cwd: "/tmp/work" };

function mount(): HTMLElement {
  const root = document.createElement("div");
  document.body.append(root);
  return root;
}

describe("readFacts — 载荷运行期校验", () => {
  it("完整载荷:三个字段全部取到", () => {
    expect(readFacts(FULL)).toEqual(FULL);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["字符串", "not-an-object"],
    ["数字", 42],
    ["数组", []],
    // ★ 这一条模拟真实事故形态:route 未声明时宿主把错误体当正常结果 resolve 回来。
    ["错误体", { code: "ROUTE_NOT_FOUND", message: "no such route" }],
  ])("畸形载荷(%s)→ 空对象,不抛错", (_label, raw) => {
    expect(() => readFacts(raw)).not.toThrow();
    expect(readFacts(raw)).toEqual({});
  });

  it("字段类型不符或空串一律按缺失处理(不产出空白值)", () => {
    expect(readFacts({ sessionId: 1, agentSource: "", cwd: null })).toEqual({});
  });

  it("★ 部分缺失只丢那一个字段,其余照常取到", () => {
    expect(readFacts({ sessionId: "s-1", cwd: "/w" })).toEqual({ sessionId: "s-1", cwd: "/w" });
  });

  it("多余字段被忽略(宿主加字段不影响既有 pane)", () => {
    expect(readFacts({ ...FULL, extra: "x" })).toEqual(FULL);
  });
});

describe("render — 任何载荷都产出可见内容", () => {
  it("完整载荷:三行值都渲染出来", () => {
    const root = mount();
    render(root, readFacts(FULL), "meta");
    expect(root.querySelector("[data-pi-session-field=sessionId]")?.textContent).toBe("s-1");
    expect(root.querySelector("[data-pi-session-field=agentSource]")?.textContent).toBe(
      "builtin:default-agent",
    );
    expect(root.querySelector("[data-pi-session-field=cwd]")?.textContent).toBe("/tmp/work");
    expect(root.querySelector("[data-pi-session-info-empty]")).toBeNull();
  });

  it("★ 全部字段缺失 → 空态提示,而不是白屏", () => {
    const root = mount();
    render(root, readFacts(null), "meta");
    const empty = root.querySelector("[data-pi-session-info-empty]");
    expect(empty).not.toBeNull();
    // 空态文案要能把人指向下一步,而不只是「无数据」。
    expect(empty?.textContent).toContain(SESSION_SIGNAL);
    // 白屏与「pane 根本没装上」观察上同形,故必须有可见节点。
    expect(root.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("★ 部分缺失:已有字段照常显示,缺的那一行显示占位符(便于定位漏推了哪个)", () => {
    const root = mount();
    render(root, readFacts({ sessionId: "s-1" }), "meta");
    expect(root.querySelector("[data-pi-session-field=sessionId]")?.textContent).toBe("s-1");
    expect(root.querySelector("[data-pi-session-field=cwd]")?.textContent).toBe("—");
    // 部分缺失不该退化成整体空态。
    expect(root.querySelector("[data-pi-session-info-empty]")).toBeNull();
  });

  it("重复渲染是替换而非追加(信号变更会反复调用)", () => {
    const root = mount();
    render(root, readFacts(FULL), "meta");
    render(root, readFacts(FULL), "meta");
    expect(root.querySelectorAll("[data-pi-session-field=sessionId]")).toHaveLength(1);
  });

  it("实例元信息始终渲染(即便处于空态,也要能看出连的是哪个实例)", () => {
    const root = mount();
    render(root, {}, "实例 abc · epoch 3");
    expect(root.querySelector("[data-pi-session-info-meta]")?.textContent).toBe(
      "实例 abc · epoch 3",
    );
  });

  it("值按文本插入,不解析为标记(载荷来自宿主,但不该有解析歧义)", () => {
    const root = mount();
    render(root, readFacts({ ...FULL, cwd: "<img src=x>" }), "meta");
    const cell = root.querySelector("[data-pi-session-field=cwd]");
    expect(cell?.textContent).toBe("<img src=x>");
    expect(cell?.querySelector("img")).toBeNull();
  });
});
