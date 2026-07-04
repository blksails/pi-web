/**
 * 单元:renderSurfaceOp(surface-runtime-facade, Task 1.2)。
 * 覆盖组装器纯函数语义(Req 3.1–3.3):标题行 + 操作代码块、fence 默认/参数化、
 * 空值参数行省略、参数序稳定、同输入同输出无副作用。
 * 不含 canvas golden 对照(逐字节复现 buildToolPrompt 归 ui 侧 Task 4.1)。
 */
import { describe, it, expect } from "vitest";
import { renderSurfaceOp } from "../src/surface-op.js";
import type { SurfaceOp } from "../src/surface-op.js";

describe("renderSurfaceOp", () => {
  it("组装标题行 + 操作代码块,tool 行在首,params 逐行(3.1)", () => {
    const op: SurfaceOp = {
      title: "🎨 生成 · 日落",
      tool: "image_edit",
      params: [
        ["prompt", "日落海面"],
        ["size", "1024x1024"],
      ],
    };
    expect(renderSurfaceOp(op)).toBe(
      "🎨 生成 · 日落\n\n```surface-op\ntool: image_edit\nprompt: 日落海面\nsize: 1024x1024\n```",
    );
  });

  it("标题与 fence 之间恰好一个空行,fence 闭合无尾随内容(3.1)", () => {
    const text = renderSurfaceOp({ title: "T", tool: "x", params: [] });
    expect(text).toBe("T\n\n```surface-op\ntool: x\n```");
    // 标题行后紧跟一个空行(两个换行),再是 fence 起始
    expect(text.startsWith("T\n\n```surface-op\n")).toBe(true);
    expect(text.endsWith("\n```")).toBe(true);
  });

  it("fence 默认 surface-op,可参数化(3.1)", () => {
    const base = { title: "T", tool: "x", params: [] as const };
    expect(renderSurfaceOp(base)).toContain("```surface-op\n");
    expect(renderSurfaceOp({ ...base, fence: "canvas-op" })).toContain("```canvas-op\n");
    expect(renderSurfaceOp({ ...base, fence: "canvas-op" })).not.toContain("surface-op");
  });

  it("值为空串或 undefined 的参数行省略,非空保留(3.2)", () => {
    const op: SurfaceOp = {
      title: "T",
      tool: "x",
      params: [
        ["a", "1"],
        ["b", ""],
        ["c", undefined as unknown as string],
        ["d", "4"],
      ],
    };
    expect(renderSurfaceOp(op)).toBe("T\n\n```surface-op\ntool: x\na: 1\nd: 4\n```");
  });

  it("参数按插入序输出,不重排(3.2)", () => {
    const op: SurfaceOp = {
      title: "T",
      tool: "x",
      params: [
        ["z", "1"],
        ["a", "2"],
        ["m", "3"],
      ],
    };
    expect(renderSurfaceOp(op)).toBe("T\n\n```surface-op\ntool: x\nz: 1\na: 2\nm: 3\n```");
  });

  it("值内领域注解原样透传(不裁剪不 trim)(3.2)", () => {
    const op: SurfaceOp = {
      title: "T",
      tool: "image_edit(请直接调用,勿追问)",
      params: [["reference_images", "att_1, att_2(首张为批注图)"]],
    };
    expect(renderSurfaceOp(op)).toBe(
      "T\n\n```surface-op\ntool: image_edit(请直接调用,勿追问)\nreference_images: att_1, att_2(首张为批注图)\n```",
    );
  });

  it("纯函数:同输入恒同输出,不改动入参(3.3)", () => {
    const params = [
      ["a", "1"],
      ["b", "2"],
    ] as const;
    const op: SurfaceOp = { title: "T", tool: "x", params };
    const first = renderSurfaceOp(op);
    const second = renderSurfaceOp(op);
    expect(second).toBe(first);
    // 无副作用:params 未被就地改动
    expect(op.params).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
    expect(op.params.length).toBe(2);
  });
});
