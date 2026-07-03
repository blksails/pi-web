import { describe, it, expect, vi } from "vitest";
import {
  ANNOTATION_COLOR,
  annotationsToImage,
  clampRect,
  drawAnnotations,
  compositeByMask,
  flattenLayers,
  rotatedSize,
  createMask,
  cropImage,
  hasMaskContent,
  strokesToMask,
  uploadDataUri,
  parseDataUri,
  type Annotation,
  type CanvasLike,
  type Ctx2DLike,
  type MaskStroke,
  type UploadFn,
} from "../../src/canvas/client-image-ops.js";

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

describe("client-image-ops 几何", () => {
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

  it("rotatedSize 90/270 交换宽高", () => {
    expect(rotatedSize({ width: 800, height: 600 }, 90)).toEqual({ width: 600, height: 800 });
    expect(rotatedSize({ width: 800, height: 600 }, 270)).toEqual({ width: 600, height: 800 });
    expect(rotatedSize({ width: 800, height: 600 }, 180)).toEqual({ width: 800, height: 600 });
  });

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

  it("cropImage 输出尺寸=钳制后的裁剪框", () => {
    const f = fakeCanvas();
    cropImage(
      { width: 200, height: 200 },
      { x: 50, y: 50, width: 100, height: 100 },
      { canvasFactory: () => f.canvas },
    );
    expect(f.canvas.width).toBe(100);
    expect(f.canvas.height).toBe(100);
  });

  it("hasMaskContent:仅 paint 且有点才算有效重绘内容", () => {
    const paint: MaskStroke = { mode: "paint", size: 48, points: [{ x: 1, y: 1 }] };
    const erase: MaskStroke = { mode: "erase", size: 48, points: [{ x: 1, y: 1 }] };
    expect(hasMaskContent([])).toBe(false);
    expect(hasMaskContent([erase])).toBe(false);
    expect(hasMaskContent([{ mode: "paint", size: 48, points: [] }])).toBe(false);
    expect(hasMaskContent([erase, paint])).toBe(true);
  });

  it("strokesToMask:alpha 语义 —— 不透明底;paint 抠透明洞(destination-out)/erase 重涂(source-over)", () => {
    const f = fakeCanvas();
    const composites: string[] = [];
    // fake 上记录 composite 切换序列(fillRect 前的语义)。
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
    // OpenAI alpha 标准:paint=destination-out(抠洞=编辑区)/erase=source-over(收回);收尾复位。
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
    // 不透明底 fillRect → beginPath → moveTo → lineTo → stroke(此刻 composite=destination-out 抠洞)。
    expect(calls).toEqual(["fillRect", "beginPath", "moveTo", "lineTo", "stroke:destination-out"]);
    expect(ctx.lineWidth).toBe(30);
    expect(ctx.lineCap).toBe("round");
    // 收尾复位,避免注入 canvas 复用污染。
    expect(ctx.globalCompositeOperation).toBe("source-over");
  });

  it("compositeByMask:shape 裁 patch(destination-in)后叠回原图(掩码外像素=原图)", () => {
    // 三块画布按工厂调用顺序:shape → patch → out;每块记录 drawImage/composite 序列。
    const made: { label: string; ops: string[]; canvas: CanvasLike }[] = [];
    const factory = (): CanvasLike => {
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
    // 原图 drawImage → line(beginPath/moveTo/lineTo/stroke)→ arrow(多两组 moveTo/lineTo 箭头头)→ 文本。
    expect(calls[0]).toBe("drawImage");
    expect(calls.filter((c) => c === "stroke")).toHaveLength(2);
    // arrow 比 line 多 2 组箭头头折线(moveTo+lineTo ×2)。
    expect(calls.filter((c) => c === "moveTo")).toHaveLength(1 + 3);
    expect(calls.at(-1)).toBe("fillText:改成红色");
    expect(uri).toBe("data:image/png;base64,ANNO");
  });

  it("drawAnnotations:每条标注可自带 color(缺省回落批注红),线与文本分别生效", () => {
    const strokeColors: string[] = [];
    const fillColors: string[] = [];
    let strokeStyle = "";
    let fillStyle = "";
    const ctx: Ctx2DLike = {
      get fillStyle() {
        return fillStyle;
      },
      set fillStyle(v: string) {
        fillStyle = v;
        fillColors.push(v);
      },
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      clearRect: vi.fn(),
      get strokeStyle() {
        return strokeStyle;
      },
      set strokeStyle(v: string) {
        strokeStyle = v;
        strokeColors.push(v);
      },
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
    };
    drawAnnotations(ctx, [
      // 带 color → 用自带色。
      { kind: "line", from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, size: 4, color: "#3b82f6" },
      // 缺省 → 回落整体默认(批注红)。
      { kind: "arrow", from: { x: 0, y: 0 }, to: { x: 9, y: 0 }, size: 4 },
      // 文本带 color → fillStyle 用自带色。
      { kind: "text", from: { x: 1, y: 1 }, to: { x: 1, y: 1 }, text: "白字", size: 8, color: "#ffffff" },
    ]);
    expect(strokeColors).toEqual(["#3b82f6", ANNOTATION_COLOR]);
    expect(fillColors).toEqual(["#ffffff"]);
  });

  it("flattenLayers:底图打底 + 依序绘制各层(位置/尺寸透传)", () => {
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
    const uri = flattenLayers(
      { width: 800, height: 600, source: { tag: "base" } as unknown as CanvasImageSource },
      [
        { source: { tag: "l1" } as unknown as CanvasImageSource, x: 10, y: 20, w: 100, h: 50 },
        { source: { tag: "l2" } as unknown as CanvasImageSource, x: 200, y: 300, w: 80, h: 80 },
      ],
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

  it("parseDataUri 提取 mimeType + base64", () => {
    expect(parseDataUri("data:image/png;base64,QUJD")).toEqual({
      mimeType: "image/png",
      base64: "QUJD",
    });
  });

  it("uploadDataUri:data URI → File → upload,回传 att_id(二进制不进 payload)", async () => {
    const upload: UploadFn = vi.fn(async (_b, _s, file) => ({
      attachment: { id: "att_up" },
      displayUrl: `/att/att_up?name=${file.name}`,
    }));
    const res = await uploadDataUri({
      dataUri: "data:image/png;base64,QUJD",
      name: "x.png",
      baseUrl: "/api",
      sessionId: "s1",
      upload,
      fileFactory: (bytes, name, mimeType) =>
        ({ name, type: mimeType, size: bytes.length } as unknown as File),
    });
    expect(res.attachmentId).toBe("att_up");
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
