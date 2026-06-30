/**
 * OpenRouter provider 单元测试。
 *
 * 覆盖:
 *  - createOpenRouterImage: buildBody 形态 + pickResult 提取
 *  - createOpenRouterImageEdit: buildBody 形态(OpenAI 化字段 prompt/image,无 mask inline)+ pickResult
 */

import { describe, it, expect } from "vitest";
import {
  createOpenRouterImage,
  createOpenRouterImageEdit,
} from "../../../src/aigc/providers/openrouter.js";
import type { BuildBodyContext } from "../../../src/engine/endpoint-types.js";

const ctx: BuildBodyContext = {};

describe("createOpenRouterImage", () => {
  it("返回正确的 model 路由元数据", () => {
    const v = createOpenRouterImage({
      model: "google/test-model",
      label: "OR Test",
      description: "desc",
    });
    expect(v.model).toBe("google/test-model");
    expect(v.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(v.requiredVars).toContain("OPENROUTER_API_KEY");
    expect(v.headers?.["authorization"]).toContain("${OPENROUTER_API_KEY}");
    expect(v.proxy).toBe("${OPENROUTER_PROXY}");
  });

  it("buildBody 生成含 modalities 和 messages 的 body", async () => {
    const v = createOpenRouterImage({
      model: "google/gemini-flash",
      label: "OR T2I",
      description: "desc",
    });
    const body = await v.buildBody?.({ prompt: "a sunset", n: 1 }, ctx) as Record<string, unknown>;
    expect(body.model).toBe("google/gemini-flash");
    expect(body.modalities).toEqual(["image", "text"]);
    const messages = body.messages as { role: string; content: unknown }[];
    expect(messages[0]?.role).toBe("user");
    // 纯文本 prompt → string content
    expect(typeof messages[0]?.content).toBe("string");
    expect(messages[0]?.content).toContain("a sunset");
  });

  it("带 negative_prompt 时文本包含 Avoid: 段", async () => {
    const v = createOpenRouterImage({
      model: "google/gemini-flash",
      label: "OR T2I",
      description: "desc",
    });
    const body = await v.buildBody?.(
      { prompt: "mountain lake", negative_prompt: "blur, fog" },
      ctx,
    ) as Record<string, unknown>;
    const messages = body.messages as { role: string; content: unknown }[];
    const text = messages[0]?.content as string;
    expect(text).toContain("Avoid:");
    expect(text).toContain("blur, fog");
  });

  it("pickResult 从 choices[].message.images 提取 URL", () => {
    const v = createOpenRouterImage({
      model: "google/gemini",
      label: "L",
      description: "d",
    });
    const response = {
      choices: [
        {
          message: {
            images: [
              { image_url: { url: "https://example.com/a.png" } },
              { image_url: { url: "https://example.com/b.png" } },
            ],
          },
        },
      ],
    };
    const picked = v.pickResult!(response);
    expect(picked.kind).toBe("image-set");
    if (picked.kind === "image-set") {
      expect(picked.urls).toHaveLength(2);
    }
  });

  it("pickResult: 单张图 → kind:image", () => {
    const v = createOpenRouterImage({
      model: "google/gemini",
      label: "L",
      description: "d",
    });
    const response = {
      choices: [
        { message: { images: [{ image_url: { url: "https://example.com/a.png" } }] } },
      ],
    };
    const picked = v.pickResult!(response);
    expect(picked.kind).toBe("image");
  });

  it("pickResult: 无图 → kind:raw", () => {
    const v = createOpenRouterImage({
      model: "google/gemini",
      label: "L",
      description: "d",
    });
    const picked = v.pickResult!({ choices: [] });
    expect(picked.kind).toBe("raw");
  });

  it("detectError 提取 error.message", () => {
    const v = createOpenRouterImage({
      model: "google/gemini",
      label: "L",
      description: "d",
    });
    const err = v.detectError!({ error: { message: "rate limited", code: 429 } });
    expect(err).toBe("rate limited");
  });

  it("detectError: 无错误 → undefined", () => {
    const v = createOpenRouterImage({
      model: "google/gemini",
      label: "L",
      description: "d",
    });
    const err = v.detectError!({ choices: [] });
    expect(err).toBeUndefined();
  });
});

describe("createOpenRouterImageEdit", () => {
  it("返回正确的 model 路由元数据", () => {
    const v = createOpenRouterImageEdit({
      model: "openai/gpt-5-image",
      label: "OR Edit",
      description: "desc",
    });
    expect(v.model).toBe("openai/gpt-5-image");
    expect(v.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(v.requiredVars).toContain("OPENROUTER_API_KEY");
  });

  it("buildBody 图像编辑: prompt + image → multi-part content", async () => {
    const v = createOpenRouterImageEdit({
      model: "openai/gpt-5-image",
      label: "OR Edit",
      description: "d",
    });
    // image 已经是 data URI(模拟编译器解析后的结果)
    const dataUri = "data:image/png;base64,aGVsbG8=";
    const body = await v.buildBody?.(
      { prompt: "add stars to sky", image: dataUri },
      ctx,
    ) as Record<string, unknown>;
    expect(body.modalities).toEqual(["image", "text"]);
    const messages = body.messages as { role: string; content: unknown[] }[];
    const content = messages[0]?.content ?? [];
    // content 应含 text part + image_url part
    const textPart = (content as { type: string; text?: string }[]).find(
      (p) => p.type === "text",
    );
    const imgPart = (content as { type: string; image_url?: { url: string } }[]).find(
      (p) => p.type === "image_url",
    );
    expect(textPart?.text).toBe("add stars to sky");
    expect(imgPart?.image_url?.url).toBe(dataUri);
  });
});
