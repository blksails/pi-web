/**
 * NewAPI provider 单元测试。
 *
 * 覆盖:
 *  - createNewApiImage: buildBody 形态(含 OpenAI 参数透传)+ pickResult 提取
 *  - createNewApiImageEdit: buildBody 含 FormData(prompt/image/mask)+ pickResult
 *  - providerModel 区分路由键与实际发往网关的 model 名
 */

import { describe, it, expect } from "vitest";
import {
  createNewApiImage,
  createNewApiImageEdit,
} from "../../../src/aigc/providers/newapi.js";
import type { BuildBodyContext } from "../../../src/engine/types.js";

const ctx: BuildBodyContext = {};

describe("createNewApiImage", () => {
  it("返回正确的 model 路由元数据", () => {
    const v = createNewApiImage({
      model: "gpt-image-2",
      label: "NewAPI Test",
      description: "desc",
    });
    expect(v.model).toBe("gpt-image-2");
    expect(v.requiredVars).toContain("NEWAPI_API_KEY");
    expect(v.headers?.["authorization"]).toContain("${NEWAPI_API_KEY}");
    // NewAPI 不挂 proxy
    expect(v.proxy).toBeUndefined();
  });

  it("providerModel 区分路由键与实际发送 model", async () => {
    const v = createNewApiImage({
      model: "route-key",
      label: "L",
      description: "d",
      providerModel: "gpt-image-1",
    });
    expect(v.model).toBe("route-key");
    const body = (await v.buildBody?.({ prompt: "x" }, ctx)) as Record<string, unknown>;
    // 发往网关的是 providerModel,而非路由键
    expect(body.model).toBe("gpt-image-1");
  });

  it("buildBody 含 model、prompt、n 字段", async () => {
    const v = createNewApiImage({
      model: "gpt-image-1",
      label: "NewAPI T2I",
      description: "desc",
    });
    const body = await v.buildBody?.(
      { prompt: "a mountain", n: 2 },
      ctx,
    ) as Record<string, unknown>;
    expect(body.model).toBe("gpt-image-1");
    expect((body.prompt as string)).toContain("a mountain");
    expect(body.n).toBe(2);
    // b64_json:图片字节内联返回,避免 persistPicked 二次下载 CDN url(完成滞后根因)。
    expect(body.response_format).toBe("b64_json");
  });

  it("OpenAI 专属参数 background/quality/moderation 透传", async () => {
    const v = createNewApiImage({
      model: "gpt-image-1",
      label: "L",
      description: "d",
    });
    const body = await v.buildBody?.(
      {
        prompt: "x",
        background: "transparent",
        quality: "high",
        moderation: "low",
      },
      ctx,
    ) as Record<string, unknown>;
    expect(body.background).toBe("transparent");
    expect(body.quality).toBe("high");
    expect(body.moderation).toBe("low");
  });

  it("negative_prompt 拼入 prompt", async () => {
    const v = createNewApiImage({
      model: "gpt-image-1",
      label: "L",
      description: "d",
    });
    const body = await v.buildBody?.(
      { prompt: "landscape", negative_prompt: "blur" },
      ctx,
    ) as Record<string, unknown>;
    expect((body.prompt as string)).toContain("Avoid:");
    expect((body.prompt as string)).toContain("blur");
  });

  it("size 转换 * → x", async () => {
    const v = createNewApiImage({
      model: "gpt-image-1",
      label: "L",
      description: "d",
    });
    const body = await v.buildBody?.(
      { prompt: "test", size: "1024*1024" },
      ctx,
    ) as Record<string, unknown>;
    expect(body.size).toBe("1024x1024");
  });

  it("pickResult 从 data[].url 提取(单张)", () => {
    const v = createNewApiImage({
      model: "gpt-image-1",
      label: "L",
      description: "d",
    });
    const resp = { data: [{ url: "https://example.com/out.png" }] };
    const picked = v.pickResult!(resp);
    expect(picked.kind).toBe("image");
    if (picked.kind === "image") {
      expect(picked.url).toBe("https://example.com/out.png");
    }
  });

  it("pickResult 从 data[].url 提取(多张)→ image-set", () => {
    const v = createNewApiImage({
      model: "gpt-image-1",
      label: "L",
      description: "d",
    });
    const resp = {
      data: [
        { url: "https://example.com/a.png" },
        { url: "https://example.com/b.png" },
      ],
    };
    const picked = v.pickResult!(resp);
    expect(picked.kind).toBe("image-set");
    if (picked.kind === "image-set") {
      expect(picked.urls).toHaveLength(2);
    }
  });

  it("pickResult 从 data[].b64_json 回退", () => {
    const v = createNewApiImage({
      model: "gpt-image-1",
      label: "L",
      description: "d",
    });
    const resp = { data: [{ b64_json: "abc123" }] };
    const picked = v.pickResult!(resp);
    expect(picked.kind).toBe("image");
    if (picked.kind === "image") {
      expect(picked.url).toContain("data:image/png;base64,abc123");
    }
  });

  it("detectError 提取 error.message", () => {
    const v = createNewApiImage({
      model: "gpt-image-1",
      label: "L",
      description: "d",
    });
    const err = v.detectError!({ error: { message: "quota exceeded" } });
    expect(err).toBe("quota exceeded");
  });

  it("detectError: 无错误 → undefined", () => {
    const v = createNewApiImage({
      model: "gpt-image-1",
      label: "L",
      description: "d",
    });
    expect(v.detectError!({ data: [] })).toBeUndefined();
  });
});

describe("createNewApiImageEdit", () => {
  it("返回正确的 model 路由元数据", () => {
    const v = createNewApiImageEdit({
      model: "gpt-image-2",
      label: "NewAPI Edit",
      description: "desc",
    });
    expect(v.model).toBe("gpt-image-2");
    expect(v.requiredVars).toContain("NEWAPI_API_KEY");
  });

  it("buildBody 返回 FormData 含 model、prompt、n、image 字段", async () => {
    const v = createNewApiImageEdit({
      model: "gpt-image-2",
      label: "L",
      description: "d",
    });
    // image 已是 data URI(编译器解析后)
    const dataUri = "data:image/png;base64,aGVsbG8=";
    const body = await v.buildBody?.(
      { prompt: "add stars", image: dataUri, n: 1 },
      ctx,
    ) as FormData;
    expect(body instanceof FormData).toBe(true);
    expect(body.get("model")).toBe("gpt-image-2");
    expect(body.get("prompt")).toBe("add stars");
    expect(body.get("n")).toBe("1");
    // 检查 image[] part 存在
    expect(body.getAll("image[]").length).toBeGreaterThan(0);
  });

  it("buildBody 含 mask / size / response_format 时一并装配", async () => {
    const v = createNewApiImageEdit({
      model: "gpt-image-2",
      label: "L",
      description: "d",
    });
    const dataUri = "data:image/png;base64,aGVsbG8=";
    const maskUri = "data:image/png;base64,bWFzaw==";
    const body = await v.buildBody?.(
      {
        prompt: "edit",
        image: dataUri,
        mask: maskUri,
        size: "1024*1024",
        response_format: "b64_json",
      },
      ctx,
    ) as FormData;
    expect(body.get("size")).toBe("1024x1024");
    expect(body.get("response_format")).toBe("b64_json");
    expect(body.get("mask")).not.toBeNull();
  });
});
