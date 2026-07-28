/**
 * Gemini 原生 relay provider 单元测试。
 *
 * 夹具形态取自 2026-07-28 对 NewAPI `v1beta/models/gemini-3.1-flash-image:generateContent`
 * 的**真机响应**(candidates[0].content.parts[0].inlineData.{mimeType:"image/jpeg", data}),
 * 故 pickResult 的断言不是凭空构造的形状,而是实际 wire 格式。
 *
 * 覆盖:
 *  - URL 拼接(`<base>/models/<providerModel>:generateContent`)与 providerModel 区分路由键
 *  - buildBody:文生图 contents/generationConfig;negative_prompt 并入正文;size → aspectRatio
 *  - buildBody(编辑):data URI 拆成 inlineData,图在前指令在后
 *  - pickResult:单图 / 多图 / 仅文本 / 无内容;snake_case inline_data 兼容
 *  - detectError:relay error 与 promptFeedback 拒答
 */

import { describe, it, expect } from "vitest";
import {
  createGeminiRelayImage,
  createGeminiRelayImageEdit,
  toAspectRatio,
  type GeminiRelayConfig,
} from "../../../src/aigc/providers/gemini-relay.js";
import type { BuildBodyContext } from "../../../src/engine/endpoint-types.js";

const ctx: BuildBodyContext = {};

const CFG: GeminiRelayConfig = {
  baseUrl: "https://gw.example.com/v1beta",
  apiKeyVar: "NEWAPI_API_KEY",
  provider: "newapi",
};

const ARGS = { model: "route-key", label: "L", description: "d", providerModel: "gemini-3.1-flash-image" };

describe("createGeminiRelayImage 路由元数据", () => {
  it("URL 拼 /models/<providerModel>:generateContent,路由键与发送 model 分离", () => {
    const v = createGeminiRelayImage(CFG, ARGS);
    expect(v.model).toBe("route-key");
    expect(v.url).toBe("https://gw.example.com/v1beta/models/gemini-3.1-flash-image:generateContent");
    expect(v.provider).toBe("newapi");
    expect(v.requiredVars).toContain("NEWAPI_API_KEY");
    expect(v.headers?.["authorization"]).toBe("Bearer ${NEWAPI_API_KEY}");
  });

  it("providerModel 省略 → 用路由键;base 尾部斜杠不产生 //models", () => {
    const v = createGeminiRelayImage(
      { ...CFG, baseUrl: "https://gw.example.com/v1beta/" },
      { model: "m", label: "L", description: "d" },
    );
    expect(v.url).toBe("https://gw.example.com/v1beta/models/m:generateContent");
  });
});

describe("toAspectRatio", () => {
  it("方形/横版/竖版 → 最接近的比值", () => {
    expect(toAspectRatio("1024x1024")).toBe("1:1");
    expect(toAspectRatio("1536x1024")).toBe("3:2");
    expect(toAspectRatio("1024x1536")).toBe("2:3");
    expect(toAspectRatio("1920x1080")).toBe("16:9");
    expect(toAspectRatio("1080x1920")).toBe("9:16");
  });

  it("* 与 × 分隔同样识别", () => {
    expect(toAspectRatio("1024*1024")).toBe("1:1");
    expect(toAspectRatio("1024×768")).toBe("4:3");
  });

  it("auto / 空 / 非法 → undefined(交给模型默认)", () => {
    expect(toAspectRatio("auto")).toBeUndefined();
    expect(toAspectRatio(undefined)).toBeUndefined();
    expect(toAspectRatio("0x0")).toBeUndefined();
  });
});

describe("buildBody(文生图)", () => {
  it("contents 单 text part + responseModalities 含 IMAGE", async () => {
    const v = createGeminiRelayImage(CFG, ARGS);
    const body = (await v.buildBody?.({ prompt: "一只猫" }, ctx)) as Record<string, any>;
    expect(body.contents).toEqual([{ parts: [{ text: "一只猫" }] }]);
    expect(body.generationConfig.responseModalities).toEqual(["TEXT", "IMAGE"]);
  });

  it("size → imageConfig.aspectRatio;auto 时不发 imageConfig", async () => {
    const v = createGeminiRelayImage(CFG, ARGS);
    const withSize = (await v.buildBody?.({ prompt: "x", size: "1920x1080" }, ctx)) as Record<string, any>;
    expect(withSize.generationConfig.imageConfig).toEqual({ aspectRatio: "16:9" });
    const autoSize = (await v.buildBody?.({ prompt: "x", size: "auto" }, ctx)) as Record<string, any>;
    expect(autoSize.generationConfig.imageConfig).toBeUndefined();
  });

  it("negative_prompt 并入正文(Gemini 无原生负向字段)", async () => {
    const v = createGeminiRelayImage(CFG, ARGS);
    const body = (await v.buildBody?.({ prompt: "猫", negative_prompt: "模糊" }, ctx)) as Record<string, any>;
    expect(body.contents[0].parts[0].text).toBe("猫\n\nAvoid: 模糊");
  });
});

describe("buildBody(编辑)", () => {
  const v = createGeminiRelayImageEdit(CFG, ARGS);

  it("data URI 拆成 inlineData,图在前、指令在后", async () => {
    const body = (await v.buildBody?.(
      { prompt: "变成蓝色", image: "data:image/png;base64,AAAB" },
      ctx,
    )) as Record<string, any>;
    expect(body.contents[0].parts).toEqual([
      { inlineData: { mimeType: "image/png", data: "AAAB" } },
      { text: "变成蓝色" },
    ]);
  });

  it("参考图一并进 parts,顺序在主图之后", async () => {
    const body = (await v.buildBody?.(
      {
        prompt: "合成",
        image: "data:image/png;base64,MAIN",
        reference_images: ["data:image/jpeg;base64,REF1"],
      },
      ctx,
    )) as Record<string, any>;
    expect(body.contents[0].parts).toEqual([
      { inlineData: { mimeType: "image/png", data: "MAIN" } },
      { inlineData: { mimeType: "image/jpeg", data: "REF1" } },
      { text: "合成" },
    ]);
  });

  it("非 data URI(如 https 直链)静默跳过,不拖垮整次调用", async () => {
    const body = (await v.buildBody?.(
      { prompt: "p", image: "https://example.com/a.png" },
      ctx,
    )) as Record<string, any>;
    expect(body.contents[0].parts).toEqual([{ text: "p" }]);
  });
});

describe("pickResult(夹具取自真机响应)", () => {
  const v = createGeminiRelayImage(CFG, ARGS);

  it("单图 → kind:image,inlineData 转 data URI(保 mimeType)", () => {
    const r = v.pickResult?.({
      candidates: [
        { content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: "/9j/4AAQ" } }] }, finishReason: "STOP" },
      ],
    });
    expect(r).toEqual({ kind: "image", url: "data:image/jpeg;base64,/9j/4AAQ" });
  });

  it("多图 → kind:image-set", () => {
    const r = v.pickResult?.({
      candidates: [
        { content: { parts: [{ inlineData: { mimeType: "image/png", data: "A" } }] } },
        { content: { parts: [{ inlineData: { mimeType: "image/png", data: "B" } }] } },
      ],
    });
    expect(r).toEqual({
      kind: "image-set",
      urls: ["data:image/png;base64,A", "data:image/png;base64,B"],
    });
  });

  it("snake_case inline_data 同样识别(部分 relay 原样透传)", () => {
    const r = v.pickResult?.({
      candidates: [{ content: { parts: [{ inline_data: { mimeType: "image/png", data: "X" } }] } }],
    });
    expect(r).toEqual({ kind: "image", url: "data:image/png;base64,X" });
  });

  it("只回文字(拒答/追问)→ kind:text,如实透出而非报无结果", () => {
    const r = v.pickResult?.({
      candidates: [{ content: { parts: [{ text: "我不能生成该内容" }] } }],
    });
    expect(r).toEqual({ kind: "text", text: "我不能生成该内容" });
  });

  it("无 candidates → kind:raw(保留原响应供排查)", () => {
    const r = v.pickResult?.({});
    expect(r).toEqual({ kind: "raw", value: {} });
  });

  it("mimeType 缺失 → 回落 image/png", () => {
    const r = v.pickResult?.({ candidates: [{ content: { parts: [{ inlineData: { data: "Y" } }] } }] });
    expect(r).toEqual({ kind: "image", url: "data:image/png;base64,Y" });
  });
});

describe("detectError", () => {
  const v = createGeminiRelayImage(CFG, ARGS);

  it("relay error.message 直出(真机形态:no access / not supported)", () => {
    expect(v.detectError?.({ error: { message: "This token has no access to model X" } })).toBe(
      "This token has no access to model X",
    );
  });

  it("只有 code 时回落 code 文案", () => {
    expect(v.detectError?.({ error: { code: 429 } })).toBe("code 429");
  });

  it("promptFeedback 拒答 → 可读原因", () => {
    expect(v.detectError?.({ promptFeedback: { blockReason: "SAFETY" } })).toBe(
      "blocked by safety filter: SAFETY",
    );
  });

  it("正常响应 → undefined", () => {
    expect(v.detectError?.({ candidates: [] })).toBeUndefined();
  });
});
