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
