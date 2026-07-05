/**
 * kernel-facade 单测(task 4.1,Req 1.3/2.3/5.1)。
 *
 * 装配门面 createCanvasKernel:把 stage/history/layers 实例创建收进一个 L2 出口
 * (Req 1.3:ui 侧不得从 kernel/ 内部路径拿件,装配经门面);per-instance
 * (同页多画布互不串扰,6.5 同族纪律);env 访问器(rect/naturalSize)由装配层
 * 注入 —— DOM 量取留在装配层,kernel 零 DOM 依赖(2.1 StageEnv 先例)。
 *
 * 门面是**收口的装配 API**(返回能力面),不是 kernel/* 的 re-export ——
 * 出口纪律快照见 index-exports.test.ts。
 */
import { describe, it, expect } from "vitest";
import { createCanvasKernel, type CanvasKernelEnv } from "../src/kernel-facade.js";
import * as pub from "../src/index.js";

const env = (
  rect: { left: number; top: number; width: number; height: number } | null,
  natural: { w: number; h: number } | null,
): CanvasKernelEnv => ({
  getRect: () => rect,
  getNaturalSize: () => natural,
});

describe("kernel-facade createCanvasKernel(装配门面)", () => {
  it("自包根出口可达(Req 1.3:装配走门面,不走 kernel 内部路径)", () => {
    expect(pub.createCanvasKernel).toBe(createCanvasKernel);
  });

  it("返回 stage/history/layers 三能力面(4.1 状态搬家的宿主消费面)", () => {
    const k = createCanvasKernel(env(null, null));
    // stage 面(视口初值 = workbench :520-:521)。
    expect(k.stage.getViewport()).toEqual({ scale: 1, offset: { x: 0, y: 0 } });
    expect(typeof k.stage.zoomBy).toBe("function");
    expect(typeof k.stage.setOffset).toBe("function");
    expect(typeof k.stage.reset).toBe("function");
    expect(typeof k.stage.subscribe).toBe("function");
    // history 面(HistoryApi + prune/clear/快照适配)。
    expect(k.history.ops).toEqual([]);
    expect(typeof k.history.commit).toBe("function");
    expect(typeof k.history.undo).toBe("function");
    expect(typeof k.history.redo).toBe("function");
    expect(typeof k.history.prune).toBe("function");
    expect(typeof k.history.clear).toBe("function");
    expect(typeof k.history.getSnapshot).toBe("function");
    // layers 面(增删改/命中/手势 reducer/快照适配)。
    expect(k.layers.layers).toEqual([]);
    expect(typeof k.layers.add).toBe("function");
    expect(typeof k.layers.markLoaded).toBe("function");
    expect(typeof k.layers.remove).toBe("function");
    expect(typeof k.layers.select).toBe("function");
    expect(typeof k.layers.applyGesture).toBe("function");
    expect(typeof k.layers.getSnapshot).toBe("function");
  });

  it("stage.toNatural 经注入 env 换算(:852-:861 语义;rect/natural 不可得 → null)", () => {
    const k = createCanvasKernel(
      env({ left: 10, top: 20, width: 100, height: 50 }, { w: 200, h: 100 }),
    );
    expect(k.stage.toNatural(60, 45)).toEqual({ x: 100, y: 50 });
    // rect 缺失 / 零尺寸 / natural 缺失 → null(手势不启动,现状语义)。
    expect(createCanvasKernel(env(null, { w: 200, h: 100 })).stage.toNatural(0, 0)).toBeNull();
    expect(
      createCanvasKernel(env({ left: 0, top: 0, width: 0, height: 0 }, { w: 200, h: 100 }))
        .stage.toNatural(0, 0),
    ).toBeNull();
    expect(
      createCanvasKernel(env({ left: 0, top: 0, width: 100, height: 50 }, null))
        .stage.toNatural(0, 0),
    ).toBeNull();
  });

  it("per-instance:两次创建互不串扰(视口/历史/图层/id 序列)", () => {
    const k1 = createCanvasKernel(env(null, null));
    const k2 = createCanvasKernel(env(null, null));
    k1.stage.zoomBy(2);
    k1.history.commit({ kind: "stroke", item: null });
    const id = k1.layers.add({ attachmentId: "att_1", displayUrl: "/a" }, null, {
      w: 100,
      h: 100,
    });
    expect(id).toBe("layer-1");
    expect(k2.stage.getViewport().scale).toBe(1);
    expect(k2.history.ops).toEqual([]);
    expect(k2.layers.layers).toEqual([]);
    // 两实例的 id 序列独立(per-store,:499 layerSeq 语义)。
    expect(k2.layers.add({ attachmentId: "att_2", displayUrl: "/b" }, null, null)).toBe("layer-1");
  });
});

// ── 4.2 注册表驱动装配面(registry/prefs/tools/pointer/renderOverlay)──────────

describe("kernel-facade 4.2 装配面(注册表驱动)", () => {
  /** 与内置 8 工具同形的最小 fake DOM(hitTest 消费 closest/getAttribute)。 */
  interface FakeEl {
    closest(sel: string): FakeEl | null;
    getAttribute(name: string): string | null;
  }
  const el = (attrs: Record<string, string>): FakeEl => ({
    closest(sel: string): FakeEl | null {
      const name = sel.slice(1, -1);
      return name in attrs ? this : null;
    },
    getAttribute: (name: string) => attrs[name] ?? null,
  });

  const pev = (pointerId: number, x: number, y: number, target: FakeEl | null) => ({
    pointerId,
    clientX: x,
    clientY: y,
    target,
  });

  const fullEnv = (): CanvasKernelEnv => ({
    getRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    getNaturalSize: () => ({ w: 100, h: 100 }),
    initialPrefs: { annoColor: "#ef4444", brushRatio: 0.05 },
  });

  it("registry 包装:registerTool 接线 opKinds → renderOverlay 按提交序回放;重复 kind 无损", () => {
    const k = createCanvasKernel(fullEnv());
    const calls: string[] = [];
    k.registry.registerTool({
      id: "ext:a",
      label: "a",
      icon: null,
      opKinds: { alpha: (_c, item) => calls.push(`alpha:${String(item)}`) },
    });
    // 同 kind 二次注册被拒(无损):回放仍走首个注册者。
    k.registry.registerTool({
      id: "ext:b",
      label: "b",
      icon: null,
      opKinds: { alpha: () => calls.push("WRONG"), beta: (_c, item) => calls.push(`beta:${String(item)}`) },
    });
    expect(k.registry.tools.map((t) => t.id)).toEqual(["ext:a", "ext:b"]);
    k.history.commit({ kind: "alpha", item: 1 });
    k.history.commit({ kind: "beta", item: 2 });
    k.history.commit({ kind: "alpha", item: 3 });
    k.history.commit({ kind: "unknown", item: 4 }); // 未注册 kind:跳过
    k.renderOverlay({} as never, { w: 100, h: 100 });
    expect(calls).toEqual(["alpha:1", "beta:2", "alpha:3"]);
  });

  it("同 id 注册冲突:被拒 + 共享收集器条目经 registry.diagnostics 可见;opKinds 不接线", () => {
    const k = createCanvasKernel(fullEnv());
    const calls: string[] = [];
    k.registry.registerTool({ id: "ext:a", label: "a", icon: null });
    k.registry.registerTool({
      id: "ext:a",
      label: "dup",
      icon: null,
      opKinds: { alpha: () => calls.push("WRONG") },
    });
    expect(k.registry.tools).toHaveLength(1);
    expect(k.registry.diagnostics).toHaveLength(1);
    expect(k.registry.diagnostics[0]!.toolId).toBe("ext:a");
    k.history.commit({ kind: "alpha", item: 1 });
    k.renderOverlay({} as never, { w: 100, h: 100 });
    expect(calls).toEqual([]); // 被拒工具的 opKinds 未接线
  });

  it("tools.setActiveTool(id)+pointer 单入口:overlay 命中手势 → 工具回调(坐标已换算)→ commit;draft 期 rasterizeDraft", () => {
    const k = createCanvasKernel(fullEnv());
    const seen: Array<{ phase: string; x: number; y: number }> = [];
    const drawn: unknown[] = [];
    k.registry.registerTool({
      id: "ext:dot",
      label: "dot",
      icon: null,
      overlayInteractive: true,
      onDown: (ev, ctx) => {
        seen.push({ phase: "down", x: ev.natural!.x, y: ev.natural!.y });
        ctx.draft.set({ at: ev.natural });
      },
      onUp: (_ev, ctx) => {
        const d = ctx.draft.get();
        ctx.draft.set(null);
        ctx.history.commit({ kind: "dot", item: d });
      },
      rasterizeDraft: (_c, draft) => drawn.push(draft),
      opKinds: { dot: () => {} },
    });
    k.tools.setActiveTool("ext:dot");
    expect(k.tools.getActiveToolId()).toBe("ext:dot");
    const overlay = el({ "data-canvas-mask-overlay": "" });
    k.pointer.onPointerDown(pev(1, 50, 25, overlay));
    expect(seen).toEqual([{ phase: "down", x: 50, y: 25 }]); // rect=natural 100² → 恒等换算
    expect(k.tools.getSnapshot().draft).toEqual({ at: { x: 50, y: 25 } });
    k.renderOverlay({} as never, { w: 100, h: 100 });
    expect(drawn).toEqual([{ at: { x: 50, y: 25 } }]); // draft 期:激活工具 rasterizeDraft
    k.pointer.onPointerUp(pev(1, 50, 25, overlay));
    expect(k.history.ops).toEqual([{ kind: "dot", item: { at: { x: 50, y: 25 } } }]);
    // 未知 id / null:取消激活。
    k.tools.setActiveTool("ext:nope");
    expect(k.tools.getActiveToolId()).toBeNull();
  });

  it("tools.context 渲染期能力面:draft 槽/prefs 与手势回调同源(选项条/overlayReact 接线前提)", () => {
    const k = createCanvasKernel(fullEnv());
    expect(k.prefs.get<string>("annoColor")).toBe("#ef4444"); // env.initialPrefs 注入
    expect(k.tools.context.prefs.get<string>("annoColor")).toBe("#ef4444"); // 同一 KV
    k.tools.context.prefs.set("annoColor", "#00ff00");
    expect(k.prefs.get<string>("annoColor")).toBe("#00ff00");
    k.tools.context.draft.set({ v: 1 }); // 渲染期写 draft(text 编辑器受控输入通道)
    expect(k.tools.getSnapshot().draft).toEqual({ v: 1 });
    expect(k.tools.context.draft.get()).toEqual({ v: 1 });
    k.tools.context.draft.set(null);
    expect(k.tools.getSnapshot().draft).toBeNull();
  });

  it("capture 接缝:capturePointer 经 env 注入,工具缺省捕获时 down 即调(target+pointerId)", () => {
    const captured: Array<[unknown, number]> = [];
    const k = createCanvasKernel({
      ...fullEnv(),
      capturePointer: (target, pointerId) => captured.push([target, pointerId]),
    });
    k.registry.registerTool({ id: "ext:cap", label: "c", icon: null, onDown: () => {} });
    k.tools.setActiveTool("ext:cap");
    const overlay = el({ "data-canvas-mask-overlay": "" });
    k.pointer.onPointerDown(pev(7, 10, 10, overlay));
    expect(captured).toEqual([[overlay, 7]]);
  });

  it("内置 8 工具自举:registerBuiltinTools(kernel.registry) → 工具轨顺序枚举 + stroke/anno 回放接线", () => {
    const k = createCanvasKernel(fullEnv());
    pub.registerBuiltinTools(k.registry);
    expect(k.registry.tools.map((t) => t.id)).toEqual([
      "builtin:move",
      "builtin:expand",
      "builtin:draw",
      "builtin:line",
      "builtin:arrow",
      "builtin:text",
      "builtin:mask",
      "builtin:erase",
    ]);
    expect(k.registry.diagnostics).toEqual([]); // mask/erase 重复 stroke kind = 无损,零诊断
    // overlay 门控声明化:绘制族 + text 声明 overlayInteractive,move/expand 不声明。
    const interactive = k.registry.tools.filter((t) => t.overlayInteractive === true).map((t) => t.id);
    expect(interactive).toEqual([
      "builtin:draw",
      "builtin:line",
      "builtin:arrow",
      "builtin:text",
      "builtin:mask",
      "builtin:erase",
    ]);
    // stroke/anno 已接线:提交 op 后回放不炸且被消费(fake ctx 缺路径原语 → 光栅化守卫跳过)。
    k.history.commit({ kind: "stroke", item: { mode: "paint", size: 4, points: [{ x: 1, y: 1 }] } });
    k.history.commit({
      kind: "anno",
      item: { kind: "line", from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, size: 3 },
    });
    expect(() => k.renderOverlay({} as never, { w: 100, h: 100 })).not.toThrow();
  });
});
