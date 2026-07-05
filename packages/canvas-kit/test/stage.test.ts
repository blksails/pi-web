/**
 * kernel/stage 单测(task 2.1,Req 2.1;design.md「Testing Strategy / Unit Tests #1」)。
 *
 * - toNatural 纯函数芯:workbench :867(现树 :852-:861)逻辑原样迁移 —— golden 期望值
 *   全部按**旧实现公式**手算(x = ((clientX - rect.left) / rect.width) * natural.w),
 *   不从新实现反推;
 * - 缩放/平移矩阵下往返换算:rect 即 CSS `translate(offset) scale(scale)`(origin=中心)
 *   作用后的 getBoundingClientRect 投影,forward(自然→客户端)后 toNatural 应还原;
 * - rect 不可得(null / 零尺寸)与 natural 不可得 → 返回 null(现状语义,手势不启动);
 * - 视口边界钳制:clampZoom 于 [ZOOM_MIN, ZOOM_MAX](workbench :92-:94 原样迁移);
 * - createStageController:视口 scale/offset 状态容器(getter/订阅/钳制;平移**手势**
 *   不在本模块 —— 只提供 panBy/setOffset 状态原语)。
 *
 * 注意:kernel/ 是 L1,不从包根出口导出 —— 本测试走内部路径 import(出口纪律见
 * index-exports.test.ts 快照)。
 */
import { describe, it, expect, vi } from "vitest";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  createStageController,
  toNatural,
  type RectLike,
} from "../src/kernel/stage.js";

/** 模拟 CSS `translate(offset) scale(scale)`(transform-origin 默认=元素中心)后的 rect 投影。 */
const transformedRect = (
  base: RectLike,
  scale: number,
  offset: { x: number; y: number },
): RectLike => {
  const cx = base.left + base.width / 2;
  const cy = base.top + base.height / 2;
  return {
    left: cx - (base.width * scale) / 2 + offset.x,
    top: cy - (base.height * scale) / 2 + offset.y,
    width: base.width * scale,
    height: base.height * scale,
  };
};

/** forward 映射(自然 → 客户端):toNatural 的逆,用于往返验证。 */
const toClient = (
  p: { x: number; y: number },
  rect: RectLike,
  natural: { w: number; h: number },
): { x: number; y: number } => ({
  x: rect.left + (p.x / natural.w) * rect.width,
  y: rect.top + (p.y / natural.h) * rect.height,
});

describe("kernel/stage toNatural(纯函数芯)", () => {
  const natural = { w: 1000, h: 800 };
  const baseRect: RectLike = { left: 100, top: 50, width: 500, height: 400 };

  it("恒等视口(scale=1, offset=0)下线性映射:golden 值按旧公式手算", () => {
    // 旧公式:x = ((350-100)/500)*1000 = 500;y = ((250-50)/400)*800 = 400
    expect(toNatural(350, 250, baseRect, natural)).toEqual({ x: 500, y: 400 });
    // 角点:rect 左上 → (0,0);右下 → (natural.w, natural.h)
    expect(toNatural(100, 50, baseRect, natural)).toEqual({ x: 0, y: 0 });
    expect(toNatural(600, 450, baseRect, natural)).toEqual({ x: 1000, y: 800 });
  });

  it("缩放矩阵(scale=2)下换算:golden 值按旧公式手算", () => {
    const rect = transformedRect(baseRect, 2, { x: 0, y: 0 });
    // rect' = { left: -150, top: -150, width: 1000, height: 800 }
    expect(rect).toEqual({ left: -150, top: -150, width: 1000, height: 800 });
    // 旧公式:x = ((130 - -150)/1000)*1000 = 280;y = ((250 - -150)/800)*800 = 400
    expect(toNatural(130, 250, rect, natural)).toEqual({ x: 280, y: 400 });
  });

  it("缩放+平移矩阵(scale=2, offset=(30,-20))下往返换算恒等", () => {
    const rect = transformedRect(baseRect, 2, { x: 30, y: -20 });
    for (const p of [
      { x: 0, y: 0 },
      { x: 250, y: 600 },
      { x: 999.5, y: 1 },
      { x: natural.w, y: natural.h },
    ]) {
      const client = toClient(p, rect, natural);
      const back = toNatural(client.x, client.y, rect, natural);
      expect(back).not.toBeNull();
      expect(back!.x).toBeCloseTo(p.x, 9);
      expect(back!.y).toBeCloseTo(p.y, 9);
    }
  });

  it("缩小+负向平移(scale=0.5, offset=(-40,60))下往返换算恒等", () => {
    const rect = transformedRect(baseRect, 0.5, { x: -40, y: 60 });
    const p = { x: 640, y: 128 };
    const client = toClient(p, rect, natural);
    const back = toNatural(client.x, client.y, rect, natural);
    expect(back!.x).toBeCloseTo(p.x, 9);
    expect(back!.y).toBeCloseTo(p.y, 9);
  });

  it("rect 不可得(null/undefined)→ null(现状:overlay 未挂载手势不启动)", () => {
    expect(toNatural(10, 10, null, natural)).toBeNull();
    expect(toNatural(10, 10, undefined, natural)).toBeNull();
  });

  it("natural 不可得(null/undefined)→ null(现状:自然尺寸未量到)", () => {
    expect(toNatural(10, 10, baseRect, null)).toBeNull();
    expect(toNatural(10, 10, baseRect, undefined)).toBeNull();
  });

  it("rect 零/负尺寸 → null(现状 :856 语义:width<=0 || height<=0)", () => {
    expect(toNatural(10, 10, { left: 0, top: 0, width: 0, height: 400 }, natural)).toBeNull();
    expect(toNatural(10, 10, { left: 0, top: 0, width: 500, height: 0 }, natural)).toBeNull();
    expect(toNatural(10, 10, { left: 0, top: 0, width: -1, height: 400 }, natural)).toBeNull();
  });
});

describe("kernel/stage 视口边界钳制(clampZoom)", () => {
  it("常量与钳制语义 = workbench :92-:94 原样迁移", () => {
    expect(ZOOM_MIN).toBe(0.2);
    expect(ZOOM_MAX).toBe(8);
    expect(clampZoom(0.05)).toBe(ZOOM_MIN);
    expect(clampZoom(100)).toBe(ZOOM_MAX);
    expect(clampZoom(1.5)).toBe(1.5);
  });
});

describe("kernel/stage createStageController(视口状态容器)", () => {
  const env = (
    rect: RectLike | null,
    natural: { w: number; h: number } | null,
  ): Parameters<typeof createStageController>[0] => ({
    getRect: () => rect,
    getNaturalSize: () => natural,
  });

  it("初始视口:scale=1, offset=(0,0)(workbench :520-:521 初值)", () => {
    const stage = createStageController(env(null, null));
    expect(stage.getViewport()).toEqual({ scale: 1, offset: { x: 0, y: 0 } });
  });

  it("setScale/zoomBy 钳制于 [ZOOM_MIN, ZOOM_MAX]", () => {
    const stage = createStageController(env(null, null));
    stage.setScale(100);
    expect(stage.getViewport().scale).toBe(ZOOM_MAX);
    stage.setScale(0.001);
    expect(stage.getViewport().scale).toBe(ZOOM_MIN);
    stage.setScale(1);
    stage.zoomBy(1.12); // 滚轮放大一档(:594 语义:clampZoom(s * factor))
    expect(stage.getViewport().scale).toBeCloseTo(1.12, 9);
    stage.zoomBy(1e9);
    expect(stage.getViewport().scale).toBe(ZOOM_MAX);
  });

  it("panBy 累加偏移;setOffset 直设(:1248 状态语义,手势本身不在本模块)", () => {
    const stage = createStageController(env(null, null));
    stage.panBy(10, -5);
    stage.panBy(2, 3);
    expect(stage.getViewport().offset).toEqual({ x: 12, y: -2 });
    stage.setOffset({ x: 7, y: 8 });
    expect(stage.getViewport().offset).toEqual({ x: 7, y: 8 });
  });

  it("reset 复位视图(scale=1, offset=0;workbench resetView :549-:552)", () => {
    const stage = createStageController(env(null, null));
    stage.setScale(3);
    stage.panBy(40, 40);
    stage.reset();
    expect(stage.getViewport()).toEqual({ scale: 1, offset: { x: 0, y: 0 } });
  });

  it("订阅:变更通知;快照引用稳定(不变则同引用,useSyncExternalStore 适配前提)", () => {
    const stage = createStageController(env(null, null));
    const listener = vi.fn();
    const off = stage.subscribe(listener);
    const snap0 = stage.getViewport();
    expect(stage.getViewport()).toBe(snap0); // 未变更 → 同引用
    stage.panBy(1, 1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(stage.getViewport()).not.toBe(snap0);
    // 无实效变更不通知(钳制后等值)
    stage.setScale(1);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    stage.panBy(1, 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("controller.toNatural 经 env 取 rect/natural;rect 不可得 → null", () => {
    const rect: RectLike = { left: 100, top: 50, width: 500, height: 400 };
    const withRect = createStageController(env(rect, { w: 1000, h: 800 }));
    expect(withRect.toNatural(350, 250)).toEqual({ x: 500, y: 400 });
    const noRect = createStageController(env(null, { w: 1000, h: 800 }));
    expect(noRect.toNatural(350, 250)).toBeNull();
    const noNatural = createStageController(env(rect, null));
    expect(noNatural.toNatural(350, 250)).toBeNull();
  });
});
