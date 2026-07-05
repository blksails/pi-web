/**
 * @blksails/pi-web-canvas-kit 包根出口 smoke 测试(task 1.1 脚手架)。
 *
 * 守护出口纪律(Req 1.3/1.4):
 * - src/index.ts 是 L2 唯一出口,可被解析;
 * - kernel/ 内部件(L1)不出现在包根出口 —— 当前为占位空出口,
 *   后续任务填充 L2 面(defineCanvasTool/registry/types/bitmap-io)时更新断言。
 */
import { describe, it, expect } from "vitest";
import * as canvasKit from "../src/index.js";

describe("@blksails/pi-web-canvas-kit public exports", () => {
  it("包根出口(L2 唯一出口)可解析", () => {
    expect(canvasKit).toBeTypeOf("object");
  });

  it("出口纪律:kernel 内部件不泄漏进包根(当前占位为空出口)", () => {
    expect(Object.keys(canvasKit)).toEqual([]);
  });
});
