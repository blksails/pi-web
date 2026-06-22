/**
 * NewAPI provider 单元测试。
 *
 * 覆盖:
 *  - createNewApiImage: buildBody 形态 + pickResult 提取
 *  - createNewApiImageEdit: buildBody 含 FormData + pickResult
 */

import { describe, it, expect } from "vitest";
import {
  createNewApiImage,
  createNewApiImageEdit,
} from "../../../src/aigc/providers/newapi.js";
import type { BuildBodyContext } from "../../../src/engine/types.js";

const ctx: BuildBodyContext = {};

describe("createNewApiImage", () => {
  it("返回正确的 variant 元数据", () => {
    const v = createNewApiImage({
      name: "newapi-test",
      label: "NewAPI Test",
      description: "desc",
      model: "gpt-image-1",
    });
    expect(v.name).toBe("newapi-test");
    expect(v.requiredVars).toContain("NEWAPI_API_KEY");
    expect(v.headers?.["authorization"]).toContain("${NEWAPI_API_KEY}");
    // NewAPI 不挂 proxy
    expect(v.proxy).toBeUndefined();
  });

  it("buildBody 含 model、prompt、n 字段", async () => {
    const v = createNewApiImage({
      name: "newapi-t2i",
      label: "NewAPI T2I",
      description: "desc",
      model: "gpt-image-1",
    });
    const body = await v.buildBody?.(
      { prompt: "a mountain", n: 2 },
      ctx,
    ) as Record<string, unknown>;
    expect(body.model).toBe("gpt-image-1");
    expect((body.prompt as string)).toContain("a mountain");
    expect(body.n).toBe(2);
    expect(body.response_format).toBe("url");
  });

  it("negative_prompt 拼入 prompt", async () => {
    const v = createNewApiImage({
      name: "newapi-t2i",
      label: "L",
      description: "d",
      model: "gpt-image-1",
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
      name: "newapi-t2i",
      label: "L",
      description: "d",
      model: "gpt-image-1",
    });
    const body = await v.buildBody?.(
      { prompt: "test", size: "1024*1024" },
      ctx,
    ) as Record<string, unknown>;
    expect(body.size).toBe("1024x1024");
  });

  it("pickResult 从 data[].url 提取(单张)", () => {
    const v = createNewApiImage({
      name: "newapi-t2i",
      label: "L",
      description: "d",
      model: "gpt-image-1",
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
      name: "newapi-t2i",
      label: "L",
      description: "d",
      model: "gpt-image-1",
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
      name: "newapi-t2i",
      label: "L",
      description: "d",
      model: "gpt-image-1",
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
      name: "newapi-t2i",
      label: "L",
      description: "d",
      model: "gpt-image-1",
    });
    const err = v.detectError!({ error: { message: "quota exceeded" } });
    expect(err).toBe("quota exceeded");
  });

  it("detectError: 无错误 → undefined", () => {
    const v = createNewApiImage({
      name: "newapi-t2i",
      label: "L",
      description: "d",
      model: "gpt-image-1",
    });
    expect(v.detectError!({ data: [] })).toBeUndefined();
  });
});

describe("createNewApiImageEdit", () => {
  it("返回正确的 variant 元数据", () => {
    const v = createNewApiImageEdit({
      name: "newapi-edit",
      label: "NewAPI Edit",
      description: "desc",
      model: "gpt-image-2",
    });
    expect(v.name).toBe("newapi-edit");
    expect(v.requiredVars).toContain("NEWAPI_API_KEY");
  });

  it("buildBody 返回 FormData 含 model、prompt、n 字段", async () => {
    const v = createNewApiImageEdit({
      name: "newapi-edit",
      label: "L",
      description: "d",
      model: "gpt-image-2",
    });
    // image_url 已是 data URI
    const dataUri = "data:image/png;base64,aGVsbG8=";
    const body = await v.buildBody?.(
      { instruction: "add stars", image_url: dataUri, n: 1 },
      ctx,
    ) as FormData;
    expect(body instanceof FormData).toBe(true);
    expect(body.get("model")).toBe("gpt-image-2");
    expect(body.get("prompt")).toBe("add stars");
    expect(body.get("n")).toBe("1");
    // 检查 image[] part 存在
    expect(body.getAll("image[]").length).toBeGreaterThan(0);
  });
});
