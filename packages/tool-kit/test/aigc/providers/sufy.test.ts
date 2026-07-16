/**
 * sufy provider 单元测试。
 *
 * 覆盖:
 *  - createSufyImage: 端点 URL / 鉴权占位 / requiredVars(SUFY_API_KEY)+ buildBody 形态
 *  - createSufyImageEdit: FormData 装配(含多图 image[] + mask)+ providerModel 区分
 *  - 通用 OpenAI 兼容工厂经 sufy config 正确拼出 base URL
 */

import { describe, it, expect } from "vitest";
import {
  createSufyImage,
  createSufyImageEdit,
} from "../../../src/aigc/providers/sufy.js";
import type { BuildBodyContext } from "../../../src/engine/endpoint-types.js";
import { resolveVars } from "../../../src/engine/var-resolver.js";

const ctx: BuildBodyContext = {};

describe("createSufyImage", () => {
  it("返回 sufy 端点 + SUFY_API_KEY 鉴权占位", () => {
    const v = createSufyImage({
      model: "gpt-image-2-sufy",
      label: "GPT Image 2 · sufy",
      description: "desc",
      providerModel: "openai/gpt-image-2",
    });
    expect(v.model).toBe("gpt-image-2-sufy");
    // baseUrl 是 `${SUFY_BASE_URL:-默认值}` 占位(声明期字面量),经 resolveVars(runEndpoint
    // 执行期语义)展开后才是真实请求 URL;未设 SUFY_BASE_URL 时回落默认字面量。
    expect(resolveVars(v.url ?? "")).toBe("https://openai.sufy.com/v1/images/generations");
    expect(v.requiredVars).toContain("SUFY_API_KEY");
    expect(v.headers?.["authorization"]).toContain("${SUFY_API_KEY}");
    // 国内网关不挂 proxy
    expect(v.proxy).toBeUndefined();
  });

  it("providerModel 区分路由键与实际发送 model(带 openai/ 前缀)", async () => {
    const v = createSufyImage({
      model: "gpt-image-2-sufy",
      label: "L",
      description: "d",
      providerModel: "openai/gpt-image-2",
    });
    const body = (await v.buildBody?.({ prompt: "x" }, ctx)) as Record<string, unknown>;
    expect(body.model).toBe("openai/gpt-image-2");
    // sufy 严格拒绝 response_format(400 Unknown parameter),故文生图**不发**该字段;
    // gpt-image 默认已返回 b64_json,persistPicked 仍走 b64 内联。
    expect(body.response_format).toBeUndefined();
  });

  it("size * → x 转换 + gpt-image 专属参数透传", async () => {
    const v = createSufyImage({ model: "m", label: "L", description: "d" });
    const body = (await v.buildBody?.(
      { prompt: "t", size: "1024*1024", background: "transparent", quality: "high", moderation: "low" },
      ctx,
    )) as Record<string, unknown>;
    expect(body.size).toBe("1024x1024");
    expect(body.background).toBe("transparent");
    expect(body.quality).toBe("high");
    expect(body.moderation).toBe("low");
  });

  it("pickResult 从 data[].b64_json 回退为 data URI", () => {
    const v = createSufyImage({ model: "m", label: "L", description: "d" });
    const picked = v.pickResult!({ data: [{ b64_json: "abc123" }] });
    expect(picked.kind).toBe("image");
    if (picked.kind === "image") {
      expect(picked.url).toContain("data:image/png;base64,abc123");
    }
  });

  it("detectError 提取 error.message", () => {
    const v = createSufyImage({ model: "m", label: "L", description: "d" });
    expect(v.detectError!({ error: { message: "no access" } })).toBe("no access");
  });
});

describe("createSufyImageEdit", () => {
  it("返回 sufy edits 端点 + requiredVars", () => {
    const v = createSufyImageEdit({
      model: "gpt-image-2-sufy",
      label: "GPT Image 2 · sufy",
      description: "d",
      providerModel: "openai/gpt-image-2",
    });
    expect(resolveVars(v.url ?? "")).toBe("https://openai.sufy.com/v1/images/edits");
    expect(v.requiredVars).toContain("SUFY_API_KEY");
  });

  it("buildBody 组装 FormData:主图 + 多张参考图 → 多个 image[] part", async () => {
    const v = createSufyImageEdit({
      model: "gpt-image-2-sufy",
      label: "L",
      description: "d",
      providerModel: "openai/gpt-image-2",
    });
    const main = "data:image/png;base64,aGVsbG8=";
    const ref1 = "data:image/png;base64,cmVmMQ==";
    const ref2 = "data:image/png;base64,cmVmMg==";
    const form = (await v.buildBody?.(
      { prompt: "merge", image: main, reference_images: [ref1, ref2], n: 1 },
      ctx,
    )) as FormData;
    expect(form instanceof FormData).toBe(true);
    // 发往网关的 model 是 providerModel
    expect(form.get("model")).toBe("openai/gpt-image-2");
    expect(form.get("prompt")).toBe("merge");
    // 主图 + 2 张参考图 = 3 个 image[] part
    expect(form.getAll("image[]").length).toBe(3);
  });

  it("buildBody 含 mask 时装配 mask part", async () => {
    const v = createSufyImageEdit({ model: "m", label: "L", description: "d" });
    const main = "data:image/png;base64,aGVsbG8=";
    const mask = "data:image/png;base64,bWFzaw==";
    const form = (await v.buildBody?.(
      { prompt: "edit", image: main, mask, size: "1024*1024" },
      ctx,
    )) as FormData;
    expect(form.get("size")).toBe("1024x1024");
    expect(form.get("mask")).not.toBeNull();
    expect(form.getAll("image[]").length).toBe(1);
  });
});
