/**
 * dashscope provider 单元测试(聚焦图像编辑入参契约)。
 *
 * 覆盖:
 *  - createDashscopeImageEdit: `images` 数组(首项主图 / 其余参考图)→ content 块顺序
 *  - mask 局部重绘路径:主图 → mask → 参考图,且 prompt 加「图2」局部重绘提示
 *  - 无图边界:不本地拦截,交由上游报错
 */

import { describe, it, expect } from "vitest";
import { createDashscopeImageEdit } from "../../../src/aigc/providers/dashscope.js";
import type { BuildBodyContext } from "../../../src/engine/endpoint-types.js";

const ctx: BuildBodyContext = {};

const MAIN = "data:image/png;base64,MAIN";
const REF1 = "data:image/png;base64,REF1";
const REF2 = "data:image/png;base64,REF2";
const MASK = "data:image/png;base64,MASK";

/** 取 messages[0].content 里的块数组。 */
function contentOf(body: Record<string, unknown>): Record<string, unknown>[] {
  const input = body.input as { messages: { content: Record<string, unknown>[] }[] };
  return input.messages[0]!.content;
}

const route = createDashscopeImageEdit({
  model: "qwen-image-edit-max",
  label: "L",
  description: "d",
});

describe("createDashscopeImageEdit — images 数组入参", () => {
  it("首项作主图、其余作参考图,仍以原生 { image } 块发出", async () => {
    const body = (await route.buildBody?.(
      { prompt: "改成夜景", images: [MAIN, REF1, REF2] },
      ctx,
    )) as Record<string, unknown>;
    expect(contentOf(body)).toEqual([
      { image: MAIN },
      { image: REF1 },
      { image: REF2 },
      { text: "改成夜景" },
    ]);
  });

  it("单图(仅主图)时只有一个 image 块", async () => {
    const body = (await route.buildBody?.(
      { prompt: "去掉水印", images: [MAIN] },
      ctx,
    )) as Record<string, unknown>;
    expect(contentOf(body)).toEqual([{ image: MAIN }, { text: "去掉水印" }]);
  });

  it("mask 路径:主图来自 images[0],mask 仍排第 2 位并触发局部重绘提示", async () => {
    const body = (await route.buildBody?.(
      { prompt: "换成蓝天", images: [MAIN, REF1], mask: MASK },
      ctx,
    )) as Record<string, unknown>;
    expect(contentOf(body)).toEqual([
      { image: MAIN },
      { image: MASK },
      { image: REF1 },
      { text: "请对图2中白色遮罩区域进行局部重绘:换成蓝天" },
    ]);
  });

  it("无图时不本地拦截(不产出 image 块),由 DashScope 端裁定", async () => {
    const body = (await route.buildBody?.({ prompt: "p" }, ctx)) as Record<string, unknown>;
    expect(contentOf(body)).toEqual([{ text: "p" }]);
  });

  it("size / n / seed 参数照旧透传", async () => {
    const body = (await route.buildBody?.(
      { prompt: "p", images: [MAIN], size: "1024x768", n: 2, seed: 7 },
      ctx,
    )) as Record<string, unknown>;
    expect(body.parameters).toEqual({ size: "1024*768", n: 2, seed: 7 });
  });
});
