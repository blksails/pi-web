/**
 * registry 动作面(registerAction / actions)单测(task 1.2,Req 1.4/1.6/3.3)。
 *
 * 覆盖(design「canvas-kit · registry 动作面(扩展)」+ registerTool 先例同构):
 * - 同 id 冲突拒绝(先注册者保持)+ 记 diagnostics(条目带 kind:"action",1.6);
 * - 被拒注册返回的退订为 no-op(不误删先注册者);
 * - 退订移除该动作且幂等;移除后同 id 可再注册;
 * - actions 按注册序稳定枚举(resolveAction 候选源,1.4);
 * - per-instance 隔离:两 registry 的 actions/diagnostics 互不串扰(1.6);
 * - 共享收集器注入:动作冲突条目落进共享 entries(与 registerTool 同一收集器)。
 */
import { describe, it, expect } from "vitest";
import { createCanvasRegistry } from "../src/registry.js";
import { defineCanvasAction, type CanvasActionPlugin } from "../src/actions.js";
import { createDiagnosticsCollector } from "../src/kernel/tool-runtime.js";

// ── 测试基建 ──────────────────────────────────────────────────────────────────

const makeAction = (id: string, extra: Partial<CanvasActionPlugin> = {}): CanvasActionPlugin =>
  defineCanvasAction({
    id,
    label: id,
    match: () => 10,
    buildArgs: () => ({}),
    execution: { via: "prompt", buildOp: (args) => args },
    ...extra,
  });

// ── per-instance 隔离(1.6)─────────────────────────────────────────────────────

describe("createCanvasRegistry 动作面 per-instance 隔离", () => {
  it("实例间 actions 互不串扰", () => {
    const a = createCanvasRegistry();
    const b = createCanvasRegistry();
    a.registerAction(makeAction("builtin:inpaint"));
    expect(a.actions.map((x) => x.id)).toEqual(["builtin:inpaint"]);
    expect(b.actions).toEqual([]);
  });

  it("实例间 diagnostics 互不串扰(A 的动作冲突不见于 B)", () => {
    const a = createCanvasRegistry();
    const b = createCanvasRegistry();
    a.registerAction(makeAction("builtin:inpaint"));
    a.registerAction(makeAction("builtin:inpaint")); // 冲突 → A 记 1 条
    expect(a.diagnostics).toHaveLength(1);
    expect(b.diagnostics).toHaveLength(0);
  });

  it("动作面与工具面共用同一收集器:工具冲突不带 kind、动作冲突带 kind:\"action\"", () => {
    const r = createCanvasRegistry();
    r.registerTool({ id: "builtin:draw", label: "draw", icon: null });
    r.registerTool({ id: "builtin:draw", label: "draw", icon: null }); // 工具冲突
    r.registerAction(makeAction("builtin:inpaint"));
    r.registerAction(makeAction("builtin:inpaint")); // 动作冲突
    expect(r.diagnostics).toHaveLength(2);
    const toolEntry = r.diagnostics.find((d) => d.toolId === "builtin:draw")!;
    const actionEntry = r.diagnostics.find((d) => d.toolId === "builtin:inpaint")!;
    expect(toolEntry.kind).toBeUndefined(); // 既有工具语义:不写 kind(additive 兼容)
    expect(actionEntry.kind).toBe("action");
  });
});

// ── 注册与冲突拒绝 ─────────────────────────────────────────────────────────────

describe("registerAction 注册与冲突拒绝", () => {
  it("actions 按注册序稳定枚举", () => {
    const r = createCanvasRegistry();
    r.registerAction(makeAction("builtin:outpaint"));
    r.registerAction(makeAction("builtin:inpaint"));
    r.registerAction(makeAction("ext:style"));
    expect(r.actions.map((x) => x.id)).toEqual([
      "builtin:outpaint",
      "builtin:inpaint",
      "ext:style",
    ]);
  });

  it("同 id 后注册者被拒:先注册者保持 + diagnostics 记录(toolId/error/at/kind:\"action\")", () => {
    const r = createCanvasRegistry();
    const first = makeAction("builtin:inpaint", { label: "first" });
    const second = makeAction("builtin:inpaint", { label: "second" });
    r.registerAction(first);
    r.registerAction(second);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]).toBe(first); // 先注册者保持(不覆盖)
    expect(r.diagnostics).toHaveLength(1);
    const d = r.diagnostics[0]!;
    expect(d.toolId).toBe("builtin:inpaint");
    expect(d.error).toContain("builtin:inpaint");
    expect(typeof d.at).toBe("number");
    expect(d.kind).toBe("action");
  });

  it("被拒注册返回的退订函数是 no-op(不误删先注册者)", () => {
    const r = createCanvasRegistry();
    const first = makeAction("builtin:inpaint");
    r.registerAction(first);
    const disposeRejected = r.registerAction(makeAction("builtin:inpaint"));
    disposeRejected();
    expect(r.actions).toEqual([first]);
  });

  it("退订移除该动作且幂等;移除后同 id 可再注册", () => {
    const r = createCanvasRegistry();
    const dispose = r.registerAction(makeAction("builtin:inpaint"));
    r.registerAction(makeAction("builtin:outpaint"));
    dispose();
    dispose(); // 幂等
    expect(r.actions.map((x) => x.id)).toEqual(["builtin:outpaint"]);
    r.registerAction(makeAction("builtin:inpaint"));
    expect(r.actions.map((x) => x.id)).toEqual(["builtin:outpaint", "builtin:inpaint"]);
    expect(r.diagnostics).toHaveLength(0); // 全程无冲突
  });

  it("共享收集器注入:动作冲突条目落进共享 entries(kind:\"action\")", () => {
    const collector = createDiagnosticsCollector();
    const r = createCanvasRegistry({ diagnostics: collector });
    r.registerAction(makeAction("builtin:inpaint"));
    r.registerAction(makeAction("builtin:inpaint"));
    expect(collector.entries).toHaveLength(1);
    expect(collector.entries[0]!.kind).toBe("action");
    expect(r.diagnostics).toBe(collector.entries); // 直读同一列表引用
  });
});

// ── 工具面与动作面互不干扰(同一 registry 双面并存)────────────────────────────

describe("registerTool 与 registerAction 双面并存", () => {
  it("同一 id 在工具面与动作面各自独立(不跨面冲突)", () => {
    const r = createCanvasRegistry();
    r.registerTool({ id: "builtin:x", label: "x", icon: null });
    r.registerAction(makeAction("builtin:x")); // 与工具同 id 但属不同注册面
    expect(r.tools.map((t) => t.id)).toEqual(["builtin:x"]);
    expect(r.actions.map((a) => a.id)).toEqual(["builtin:x"]);
    expect(r.diagnostics).toHaveLength(0); // 跨面同名不构成冲突
  });
});
