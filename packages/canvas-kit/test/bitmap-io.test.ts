/**
 * bitmap-io 语义锚定测试(task 1.2,Req 5.2 / 1.3)。
 *
 * Golden 纪律:全部期望值取自**迁移前**实现的行为 ——
 * `git show HEAD:packages/ui/src/canvas/client-image-ops.ts`(与既有
 * `packages/ui/test/canvas/client-image-ops.test.ts` 的黄金断言同源);
 * 不从迁移后代码反推。
 *
 * 覆盖:核心位图函数(旋转/裁剪/拍平/掩码光栅化/合成/扩图)+ 导出清单
 * 与原 client-image-ops 逐一对应(显式枚举断言)。
 * jsdom 无真实 Canvas:沿用 ui 既有先例 —— 几何纯函数直接断言,光栅化函数
 * 经注入 fake CanvasFactory 验证调用语义(尺寸/绘制序列/composite 切换)。
 */
import { describe, it, expect, vi } from "vitest";
import * as bitmapIo from "../src/bitmap-io.js";
import {
  ANNOTATION_COLOR,
  annotationsToImage,
  clampRect,
  compositeByMask,
  cropImage,
  createMask,
  drawAnnotations,
  expandedSize,
  flattenLayers,
  hasExpand,
  hasMaskContent,
  outpaintImage,
  outpaintMask,
  parseDataUri,
  rotateImage,
  rotatedSize,
  strokesToMask,
  uploadDataUri,
  type Annotation,
  type CanvasFactory,
  type CanvasLike,
  type ClientImageOpsDeps,
  type Ctx2DLike,
  type ExpandEdges,
  type FlattenLayer,
  type ImageSourceLike,
  type MaskStroke,
  type Rect,
  type UploadDataUriInput,
  type UploadFn,
} from "../src/bitmap-io.js";
import type { CanvasOp, LoadedImage, WorkLayer } from "../src/types.js";

// ── 导出清单:与原 client-image-ops 逐一对应 ─────────────────────────────────────

describe("bitmap-io 导出清单(与原 client-image-ops 逐一对应)", () => {
  it("值导出 19 项逐一对应(清单转录自 HEAD 的 client-image-ops.ts)", () => {
    // Golden:`git show HEAD:packages/ui/src/canvas/client-image-ops.ts` 的全部
    // 运行时(值)导出,按字母序显式枚举 —— 缺一/多一都 fail。
    expect(Object.keys(bitmapIo).sort()).toEqual([
      "ANNOTATION_COLOR",
      "ANNOTATION_PALETTE",
      "annotationsToImage",
      "clampRect",
      "compositeByMask",
      "createMask",
      "cropImage",
      "drawAnnotations",
      "expandedSize",
      "flattenLayers",
      "hasExpand",
      "hasMaskContent",
      "outpaintImage",
      "outpaintMask",
      "parseDataUri",
      "rotateImage",
      "rotatedSize",
      "strokesToMask",
      "uploadDataUri",
    ]);
  });

  it("类型导出 12 项可从 bitmap-io 解析(顶部 import type 即编译期断言);此处锚定形状抽样", () => {
    // 类型导出(Annotation/CanvasFactory/CanvasLike/ClientImageOpsDeps/Ctx2DLike/
    // ExpandEdges/FlattenLayer/ImageSourceLike/MaskStroke/Rect/UploadDataUriInput/UploadFn)
    // 由本文件顶部 import type 清单在 typecheck 期逐一守护;运行时抽样锚定字段形状。
    const rect: Rect = { x: 0, y: 0, width: 1, height: 1 };
    const stroke: MaskStroke = { mode: "paint", size: 4, points: [{ x: 0, y: 0 }] };
    const anno: Annotation = { kind: "line", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, size: 2 };
    const edges: ExpandEdges = { top: 0, right: 0, bottom: 0, left: 0 };
    expect([rect.width, stroke.mode, anno.kind, edges.top]).toEqual([1, "paint", "line", 0]);
  });

  it("canonical 家:bitmap-io 的 Annotation/MaskStroke/ExpandEdges 与 types.ts 同源(双向可赋值)", () => {
    // types.ts 是 canonical 家;bitmap-io 转发同一声明 —— 双向赋值在编译期成立。
    const fromTypes: import("../src/types.js").Annotation = {
      kind: "arrow",
      from: { x: 0, y: 0 },
      to: { x: 5, y: 5 },
      size: 3,
    };
    const viaBitmapIo: Annotation = fromTypes;
    const back: import("../src/types.js").Annotation = viaBitmapIo;
    expect(back.kind).toBe("arrow");
  });
});

// ── types.ts canonical 家(WorkLayer / CanvasOp)────────────────────────────────

describe("types.ts canonical 家", () => {
  it("WorkLayer 形状与迁移前 workbench 私有声明一致(id/attachmentId/displayUrl/x/y/w/h/loaded?)", () => {
    const loaded: LoadedImage = { source: {} as CanvasImageSource, width: 8, height: 6 };
    const layer: WorkLayer = {
      id: "layer_1",
      attachmentId: "att_1",
      displayUrl: "/att/att_1",
      x: 10,
      y: 20,
      w: 100,
      h: 50,
      loaded,
    };
    expect(layer.w).toBe(100);
    // loaded 可缺省(异步填充前)。
    const bare: WorkLayer = { id: "l2", attachmentId: "a2", displayUrl: "/a2", x: 0, y: 0, w: 1, h: 1 };
    expect(bare.loaded).toBeUndefined();
  });

  it("CanvasOp 开放形状:{kind: string, item: unknown}(内置 stroke/anno 与自定义 kind 一视同仁)", () => {
    const strokeOp: CanvasOp = {
      kind: "stroke",
      item: { mode: "paint", size: 4, points: [] } satisfies MaskStroke,
    };
    const annoOp: CanvasOp = {
      kind: "anno",
      item: { kind: "text", from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, size: 8 } satisfies Annotation,
    };
    const customOp: CanvasOp = { kind: "sticker", item: { emoji: "🔥" } };
    expect([strokeOp.kind, annoOp.kind, customOp.kind]).toEqual(["stroke", "anno", "sticker"]);
  });
});

// ── fake canvas(照 ui 既有测试先例)────────────────────────────────────────────

function fakeCanvas(): { canvas: CanvasLike; ctx: Ctx2DLike; fills: number[][] } {
  const fills: number[][] = [];
  const ctx: Ctx2DLike = {
    fillStyle: "",
    fillRect: (x, y, w, h) => fills.push([x, y, w, h]),
    drawImage: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
  };
  const canvas: CanvasLike = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: () => "data:image/png;base64,ZZZZ",
  };
  return { canvas, ctx, fills };
}

// ── 几何纯函数 ─────────────────────────────────────────────────────────────────

describe("bitmap-io 几何纯函数", () => {
  it("clampRect 钳制到边界内", () => {
    expect(clampRect({ x: -5, y: -5, width: 100, height: 100 }, { width: 50, height: 40 })).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 40,
    });
    expect(clampRect({ x: 10, y: 10, width: 100, height: 100 }, { width: 50, height: 50 })).toEqual({
      x: 10,
      y: 10,
      width: 40,
      height: 40,
    });
  });

  it("rotatedSize 90/270 交换宽高;180/360 不变", () => {
    expect(rotatedSize({ width: 800, height: 600 }, 90)).toEqual({ width: 600, height: 800 });
    expect(rotatedSize({ width: 800, height: 600 }, 270)).toEqual({ width: 600, height: 800 });
    expect(rotatedSize({ width: 800, height: 600 }, 180)).toEqual({ width: 800, height: 600 });
    expect(rotatedSize({ width: 800, height: 600 }, -90)).toEqual({ width: 600, height: 800 });
  });

  it("hasExpand / expandedSize:四边扩展量语义", () => {
    expect(hasExpand({ top: 0, right: 0, bottom: 0, left: 0 })).toBe(false);
    expect(hasExpand({ top: 0, right: 0, bottom: 1, left: 0 })).toBe(true);
    expect(expandedSize({ width: 800, height: 600 }, { top: 10, right: 20, bottom: 30, left: 40 })).toEqual({
      width: 860,
      height: 640,
    });
  });

  it("hasMaskContent:仅 paint 且有点才算有效重绘内容", () => {
    const paint: MaskStroke = { mode: "paint", size: 48, points: [{ x: 1, y: 1 }] };
    const erase: MaskStroke = { mode: "erase", size: 48, points: [{ x: 1, y: 1 }] };
    expect(hasMaskContent([])).toBe(false);
    expect(hasMaskContent([erase])).toBe(false);
    expect(hasMaskContent([{ mode: "paint", size: 48, points: [] }])).toBe(false);
    expect(hasMaskContent([erase, paint])).toBe(true);
  });

  it("parseDataUri 提取 mimeType + base64;非法输入回退 octet-stream", () => {
    expect(parseDataUri("data:image/png;base64,QUJD")).toEqual({
      mimeType: "image/png",
      base64: "QUJD",
    });
    expect(parseDataUri("garbage")).toEqual({
      mimeType: "application/octet-stream",
      base64: "garbage",
    });
  });
});

// ── 裁剪 / 旋转 ────────────────────────────────────────────────────────────────

describe("bitmap-io 裁剪与旋转", () => {
  it("cropImage 输出尺寸=钳制后的裁剪框;负偏移把源区域对齐到 (0,0)", () => {
    const f = fakeCanvas();
    cropImage(
      { width: 200, height: 200, source: {} as CanvasImageSource },
      { x: 50, y: 50, width: 100, height: 100 },
      { canvasFactory: () => f.canvas },
    );
    expect(f.canvas.width).toBe(100);
    expect(f.canvas.height).toBe(100);
    // Golden(HEAD cropImage):ctx.drawImage(source, -clamped.x, -clamped.y)。
    expect(f.ctx.drawImage).toHaveBeenCalledWith(expect.anything(), -50, -50);
  });

  it("rotateImage 90°:画布取 rotatedSize;绕中心 translate/rotate 后以 -w/2,-h/2 绘源", () => {
    const f = fakeCanvas();
    rotateImage(
      { width: 800, height: 600, source: {} as CanvasImageSource },
      90,
      { canvasFactory: () => f.canvas },
    );
    // Golden(HEAD rotateImage):out=600×800;translate(out.w/2,out.h/2);
    // rotate(90π/180);drawImage(src,-800/2,-600/2);save/restore 包裹。
    expect(f.canvas.width).toBe(600);
    expect(f.canvas.height).toBe(800);
    expect(f.ctx.save).toHaveBeenCalledTimes(1);
    expect(f.ctx.translate).toHaveBeenCalledWith(300, 400);
    expect(f.ctx.rotate).toHaveBeenCalledWith((90 * Math.PI) / 180);
    expect(f.ctx.drawImage).toHaveBeenCalledWith(expect.anything(), -400, -300);
    expect(f.ctx.restore).toHaveBeenCalledTimes(1);
  });
});

// ── 掩码光栅化 ─────────────────────────────────────────────────────────────────

describe("bitmap-io 掩码光栅化", () => {
  it("createMask 输出画布尺寸=源图(坐标系对齐)+ region 涂白", () => {
    const f = fakeCanvas();
    const uri = createMask(
      { width: 512, height: 384 },
      [{ x: 10, y: 20, width: 100, height: 50 }],
      { canvasFactory: () => f.canvas },
    );
    expect(f.canvas.width).toBe(512);
    expect(f.canvas.height).toBe(384);
    // 黑底 fillRect(0,0,512,384) + region(clamped) fillRect(10,20,100,50)。
    expect(f.fills[0]).toEqual([0, 0, 512, 384]);
    expect(f.fills[1]).toEqual([10, 20, 100, 50]);
    expect(uri.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("strokesToMask:alpha 语义 —— 不透明底;paint 抠透明洞(destination-out)/erase 重涂(source-over)", () => {
    const f = fakeCanvas();
    const composites: string[] = [];
    Object.defineProperty(f.ctx, "globalCompositeOperation", {
      get: () => composites[composites.length - 1] ?? "source-over",
      set: (v: string) => composites.push(v),
    });
    const strokes: readonly MaskStroke[] = [
      { mode: "paint", size: 40, points: [{ x: 100, y: 100 }] },
      { mode: "erase", size: 20, points: [{ x: 100, y: 100 }] },
    ];
    const uri = strokesToMask({ width: 512, height: 384 }, strokes, {
      canvasFactory: () => f.canvas,
    });
    expect(f.canvas.width).toBe(512);
    expect(f.canvas.height).toBe(384);
    // 不透明底 + paint 方点(40)+ erase 方点(20)按序回放(fake 退化路径)。
    expect(f.fills[0]).toEqual([0, 0, 512, 384]);
    expect(f.fills[1]).toEqual([80, 80, 40, 40]);
    expect(f.fills[2]).toEqual([90, 90, 20, 20]);
    // OpenAI alpha 标准:paint=destination-out / erase=source-over;收尾复位。
    expect(composites).toEqual(["destination-out", "source-over", "source-over"]);
    expect(uri.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("strokesToMask:有路径原语时走 stroke 折线(round cap + destination-out 抠洞)", () => {
    const calls: string[] = [];
    const ctx: Ctx2DLike = {
      fillStyle: "",
      fillRect: () => calls.push("fillRect"),
      drawImage: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      clearRect: vi.fn(),
      globalCompositeOperation: "source-over",
      beginPath: () => calls.push("beginPath"),
      moveTo: () => calls.push("moveTo"),
      lineTo: () => calls.push("lineTo"),
      stroke: () => {
        calls.push(`stroke:${ctx.globalCompositeOperation ?? ""}`);
      },
    };
    const canvas: CanvasLike = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toDataURL: () => "data:image/png;base64,ZZZZ",
    };
    strokesToMask(
      { width: 100, height: 100 },
      [{ mode: "paint", size: 30, points: [{ x: 1, y: 1 }, { x: 50, y: 50 }] }],
      { canvasFactory: () => canvas },
    );
    expect(calls).toEqual(["fillRect", "beginPath", "moveTo", "lineTo", "stroke:destination-out"]);
    expect(ctx.lineWidth).toBe(30);
    expect(ctx.lineCap).toBe("round");
    expect(ctx.globalCompositeOperation).toBe("source-over");
  });
});

// ── 合成(掩码回贴)─────────────────────────────────────────────────────────────

describe("bitmap-io 合成", () => {
  it("compositeByMask:shape 裁 patch(destination-in)后叠回原图(掩码外像素=原图)", () => {
    // 三块画布按工厂调用顺序:shape → patch → out;每块记录 drawImage/composite 序列。
    const made: { label: string; ops: string[]; canvas: CanvasLike }[] = [];
    const factory: CanvasFactory = () => {
      const ops: string[] = [];
      let composite = "source-over";
      const ctx: Ctx2DLike = {
        fillStyle: "",
        fillRect: () => ops.push("fillRect"),
        drawImage: (img) =>
          ops.push(
            `drawImage:${
              (made.find((m) => m.canvas === (img as unknown)) ?? { label: "src" }).label
            }:${composite}`,
          ),
        translate: vi.fn(),
        rotate: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        clearRect: vi.fn(),
        get globalCompositeOperation() {
          return composite;
        },
        set globalCompositeOperation(v: string) {
          composite = v;
        },
        beginPath: () => ops.push("beginPath"),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: () => ops.push(`stroke:${composite}`),
      };
      const canvas: CanvasLike = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toDataURL: () => "data:image/png;base64,OUT",
      };
      made.push({ label: `c${made.length}`, ops, canvas });
      return canvas;
    };
    const baseSource = {} as CanvasImageSource;
    const patchSource = {} as CanvasImageSource;
    const uri = compositeByMask(
      { width: 200, height: 100, source: baseSource },
      patchSource,
      [{ mode: "paint", size: 20, points: [{ x: 50, y: 50 }] }],
      { canvasFactory: factory },
    );
    expect(made).toHaveLength(3);
    const [shape, patch, out] = made;
    // shape(c0):透明底(无 fillRect 底)+ 笔迹 stroke(source-over)。
    expect(shape!.ops).toEqual(["beginPath", "stroke:source-over"]);
    // patch(c1):画模型结果(src)→ destination-in 裁 shape(c0)。
    expect(patch!.ops).toEqual(["drawImage:src:source-over", "drawImage:c0:destination-in"]);
    // out(c2):原图打底(src)→ 叠裁剪后的 patch(c1)。
    expect(out!.ops).toEqual(["drawImage:src:source-over", "drawImage:c1:source-over"]);
    expect(out!.canvas.width).toBe(200);
    expect(out!.canvas.height).toBe(100);
    expect(uri).toBe("data:image/png;base64,OUT");
  });
});

// ── 拍平(图层)─────────────────────────────────────────────────────────────────

describe("bitmap-io 拍平", () => {
  it("flattenLayers:底图打底 + 依序绘制各层(位置/尺寸透传,后加的在上)", () => {
    const draws: (string | number)[][] = [];
    const ctx: Ctx2DLike = {
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: (img, dx, dy, dw, dh) =>
        draws.push([(img as { tag?: string }).tag ?? "?", dx, dy, dw ?? -1, dh ?? -1]),
      translate: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      clearRect: vi.fn(),
    };
    const canvas: CanvasLike = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toDataURL: () => "data:image/png;base64,FLAT",
    };
    const layers: readonly FlattenLayer[] = [
      { source: { tag: "l1" } as unknown as CanvasImageSource, x: 10, y: 20, w: 100, h: 50 },
      { source: { tag: "l2" } as unknown as CanvasImageSource, x: 200, y: 300, w: 80, h: 80 },
    ];
    const uri = flattenLayers(
      { width: 800, height: 600, source: { tag: "base" } as unknown as CanvasImageSource },
      layers,
      { canvasFactory: () => canvas },
    );
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(draws).toEqual([
      ["base", 0, 0, 800, 600],
      ["l1", 10, 20, 100, 50],
      ["l2", 200, 300, 80, 80],
    ]);
    expect(uri).toBe("data:image/png;base64,FLAT");
  });
});

// ── 扩图(outpaint)────────────────────────────────────────────────────────────

describe("bitmap-io 扩图", () => {
  const edges: ExpandEdges = { top: 10, right: 20, bottom: 30, left: 40 };

  it("outpaintImage:大画布=扩展后尺寸;原图绘于 (left,top),扩展区留透明", () => {
    const f = fakeCanvas();
    const uri = outpaintImage(
      { width: 800, height: 600, source: {} as CanvasImageSource },
      edges,
      { canvasFactory: () => f.canvas },
    );
    // Golden(HEAD outpaintImage):expandedSize=860×640;drawImage(src, e.left, e.top, w, h)。
    expect(f.canvas.width).toBe(860);
    expect(f.canvas.height).toBe(640);
    expect(f.ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 40, 10, 800, 600);
    // 扩展区不做任何底色填充(透明 = 生成区)。
    expect(f.fills).toEqual([]);
    expect(uri.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("outpaintMask:扩展后尺寸;仅原图区涂不透明(保留),扩展区保持透明(alpha=0=生成)", () => {
    const f = fakeCanvas();
    const uri = outpaintMask({ width: 800, height: 600 }, edges, { canvasFactory: () => f.canvas });
    // Golden(HEAD outpaintMask):画布 860×640;唯一 fillRect(e.left, e.top, base.w, base.h)。
    expect(f.canvas.width).toBe(860);
    expect(f.canvas.height).toBe(640);
    expect(f.fills).toEqual([[40, 10, 800, 600]]);
    expect(uri.startsWith("data:image/png;base64,")).toBe(true);
  });
});

// ── 标注 ──────────────────────────────────────────────────────────────────────

describe("bitmap-io 标注", () => {
  it("drawAnnotations:画笔(draw)按 points 折线回放,单点成圆点,per-annotation 颜色", () => {
    const calls: string[] = [];
    const ctx: Ctx2DLike = {
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      clearRect: vi.fn(),
      beginPath: () => calls.push("beginPath"),
      moveTo: (x, y) => calls.push(`moveTo:${x},${y}`),
      lineTo: (x, y) => calls.push(`lineTo:${x},${y}`),
      stroke: () => calls.push(`stroke:${ctx.strokeStyle ?? ""}`),
    };
    drawAnnotations(ctx, [
      {
        kind: "draw",
        from: { x: 1, y: 1 },
        to: { x: 30, y: 30 },
        points: [
          { x: 1, y: 1 },
          { x: 10, y: 12 },
          { x: 30, y: 30 },
        ],
        size: 5,
        color: "#22c55e",
      },
      { kind: "draw", from: { x: 7, y: 7 }, to: { x: 7, y: 7 }, points: [{ x: 7, y: 7 }], size: 5 },
    ]);
    expect(calls).toEqual([
      "beginPath",
      "moveTo:1,1",
      "lineTo:10,12",
      "lineTo:30,30",
      "stroke:#22c55e",
      "beginPath",
      "moveTo:7,7",
      "lineTo:7.01,7",
      `stroke:${ANNOTATION_COLOR}`,
    ]);
  });

  it("annotationsToImage:原图打底 + 线/箭头(带头两短线)/文本 依序绘制", () => {
    const calls: string[] = [];
    let composite = "source-over";
    const ctx: Ctx2DLike = {
      fillStyle: "",
      fillRect: () => calls.push("fillRect"),
      drawImage: () => calls.push("drawImage"),
      translate: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      clearRect: vi.fn(),
      get globalCompositeOperation() {
        return composite;
      },
      set globalCompositeOperation(v: string) {
        composite = v;
      },
      beginPath: () => calls.push("beginPath"),
      moveTo: () => calls.push("moveTo"),
      lineTo: () => calls.push("lineTo"),
      stroke: () => calls.push("stroke"),
      fillText: (t) => calls.push(`fillText:${t}`),
    };
    const canvas: CanvasLike = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toDataURL: () => "data:image/png;base64,ANNO",
    };
    const annos: readonly Annotation[] = [
      { kind: "line", from: { x: 0, y: 0 }, to: { x: 50, y: 50 }, size: 4 },
      { kind: "arrow", from: { x: 10, y: 10 }, to: { x: 90, y: 10 }, size: 4 },
      { kind: "text", from: { x: 20, y: 20 }, to: { x: 20, y: 20 }, text: "改成红色", size: 8 },
    ];
    const uri = annotationsToImage(
      { width: 100, height: 100, source: {} as CanvasImageSource },
      annos,
      { canvasFactory: () => canvas },
    );
    expect(calls[0]).toBe("drawImage");
    expect(calls.filter((c) => c === "stroke")).toHaveLength(2);
    // arrow 比 line 多 2 组箭头头折线(moveTo+lineTo ×2)。
    expect(calls.filter((c) => c === "moveTo")).toHaveLength(1 + 3);
    expect(calls.at(-1)).toBe("fillText:改成红色");
    expect(uri).toBe("data:image/png;base64,ANNO");
  });
});

// ── 上传接缝 ──────────────────────────────────────────────────────────────────

describe("bitmap-io 上传接缝", () => {
  it("uploadDataUri:data URI → File → upload,回传 att_id(二进制不进 payload)", async () => {
    const upload: UploadFn = vi.fn(async (_b, _s, file) => ({
      attachment: { id: "att_up" },
      displayUrl: `/att/att_up?name=${file.name}`,
    }));
    const input: UploadDataUriInput = {
      dataUri: "data:image/png;base64,QUJD",
      name: "x.png",
      baseUrl: "/api",
      sessionId: "s1",
      upload,
      fileFactory: (bytes, name, mimeType) =>
        ({ name, type: mimeType, size: bytes.length } as unknown as File),
    };
    const res = await uploadDataUri(input);
    expect(res.attachmentId).toBe("att_up");
    expect(res.displayUrl).toBe("/att/att_up?name=x.png");
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("无注入 canvasFactory 且无 document 语义:注入 deps 缺省字段仍可用(ClientImageOpsDeps 可选面)", () => {
    const f = fakeCanvas();
    const deps: ClientImageOpsDeps = { canvasFactory: () => f.canvas, mimeType: "image/webp" };
    const src: ImageSourceLike = { width: 10, height: 10 };
    const uri = cropImage(src, { x: 0, y: 0, width: 5, height: 5 }, deps);
    expect(uri.startsWith("data:image/png;base64,")).toBe(true); // fake toDataURL 固定值
  });
});
