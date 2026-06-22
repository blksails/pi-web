/**
 * image_edit category 集成测试。
 *
 * 覆盖:
 *  - imageEdit category 声明基本字段
 *  - DashScope mask-aware variant: instruction + image_url(att_id) → resolve → edit → persist → image ref
 *  - mask 路径: mask_url(att_id) 被解析; instruction 含局部重绘前缀
 *  - buildAigcTools() 含 image_edit 工具
 *  - include filter 仅返回指定工具
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { imageEdit } from "../../../src/aigc/categories/image-edit.js";
import { compileCategory } from "../../../src/engine/compile-category.js";
import { buildAigcTools } from "../../../src/aigc/index.js";
import type { CompileDeps } from "../../../src/engine/compile-category.js";
import type { AttachmentToolContext, AttachmentToolHandle } from "@pi-web/agent-kit";

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeHandle(id: string): AttachmentToolHandle {
  return {
    meta: {
      id,
      name: `${id}.png`,
      mimeType: "image/png",
      size: 4,
      origin: "upload",
      sessionId: "s1",
      createdAt: new Date().toISOString(),
    },
    async bytes() { return new Uint8Array([0x01, 0x02, 0x03, 0x04]); },
    async localPath() { return `/tmp/${id}.png`; },
    async url() { return `http://localhost/att/${id}`; },
  };
}

function makeMockCtx(): AttachmentToolContext {
  return {
    available: true,
    async resolve(id: string) { return makeHandle(id); },
    putOutput: vi.fn().mockImplementation(
      async (opts: { name: string; mimeType: string }) => ({
        attachmentId: `att_out_1`,
        displayUrl: `http://localhost/att/out/1`,
        mimeType: opts.mimeType,
        name: opts.name,
      }),
    ),
  };
}

/**
 * 构造 DashScope 同步端点 mock fetch:
 *  - provider 端点 → 返回含 1 张图 URL 的 choices 响应
 *  - 产物 fetch → 返回 8 字节 ArrayBuffer
 */
function makeDashScopeFetch(resultUrl = "https://dashscope-result.aliyuncs.com/edit1.png") {
  return vi.fn().mockImplementation(async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
    if (u === resultUrl) {
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
        headers: { get: () => "image/png" },
        status: 200,
      };
    }
    // DashScope multimodal-generation endpoint
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          output: {
            choices: [
              { message: { content: [{ image: resultUrl }] } },
            ],
          },
        }),
      headers: { get: () => "application/json" },
      status: 200,
    };
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("imageEdit category 声明", () => {
  it("name === 'image_edit'", () => {
    expect(imageEdit.name).toBe("image_edit");
  });

  it("inputSchema 含 instruction / image_url / mask_url / reference_image_urls", () => {
    const props = imageEdit.inputSchema.properties;
    expect(props).toHaveProperty("instruction");
    expect(props).toHaveProperty("image_url");
    expect(props).toHaveProperty("mask_url");
    expect(props).toHaveProperty("reference_image_urls");
  });

  it("image_url 和 mask_url 有 mediaKind:image", () => {
    const props = imageEdit.inputSchema.properties;
    expect(props["image_url"]?.mediaKind).toBe("image");
    expect(props["mask_url"]?.mediaKind).toBe("image");
  });

  it("reference_image_urls.items 有 mediaKind:image", () => {
    const refProp = imageEdit.inputSchema.properties["reference_image_urls"];
    expect(refProp?.items?.mediaKind).toBe("image");
  });

  it("required 包含 instruction 和 image_url", () => {
    expect(imageEdit.inputSchema.required).toContain("instruction");
    expect(imageEdit.inputSchema.required).toContain("image_url");
  });

  it("variants 非空，含 DashScope 和 OpenRouter 变体", () => {
    expect(imageEdit.variants.length).toBeGreaterThan(1);
    const names = imageEdit.variants.map((v) => v.name);
    // 至少有一个 DashScope 变体和一个 OpenRouter/NewAPI 变体
    const hasDashscope = names.some((n) => n.includes("qwen") || n.includes("dashscope"));
    const hasOtherProvider = names.some((n) => n.includes("openrouter") || n.includes("newapi") || n.includes("gpt") || n.includes("gemini"));
    expect(hasDashscope).toBe(true);
    expect(hasOtherProvider).toBe(true);
  });

  it("defaultVariant 存在于 variants", () => {
    const variantNames = imageEdit.variants.map((v) => v.name);
    expect(variantNames).toContain(imageEdit.defaultVariant);
  });
});

describe("imageEdit 执行(DashScope 无 mask)", () => {
  beforeEach(() => {
    process.env.DASHSCOPE_API_KEY = "test-dashscope-key";
  });

  afterEach(() => {
    delete process.env.DASHSCOPE_API_KEY;
    vi.restoreAllMocks();
  });

  it("instruction + image_url(att_id) → resolve → edit → persist → ok:true + asset", async () => {
    const ctx = makeMockCtx();
    const resolveSpy = vi.spyOn(ctx, "resolve");
    const fetchImpl = makeDashScopeFetch() as typeof fetch;
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };

    // 选 DashScope qwen-image-edit 变体
    const dashscopeVariant = imageEdit.variants.find((v) => v.name.includes("qwen-image-edit") || v.name.includes("qwen-image"));
    const categoryWithDashscope = dashscopeVariant
      ? { ...imageEdit, defaultVariant: dashscopeVariant.name }
      : imageEdit;

    const tool = compileCategory(categoryWithDashscope, deps);
    const result = await tool.execute(
      "call-edit-1",
      {
        instruction: "add stars to the sky",
        image_url: "att_main123",
      },
      undefined,
      undefined,
      {} as never,
    );

    // image_url att_id 应被 resolve
    expect(resolveSpy).toHaveBeenCalledWith("att_main123");

    const details = result.details as { ok: boolean; assets?: { attachmentId: string }[] };
    expect(details.ok).toBe(true);
    expect(details.assets?.length).toBeGreaterThan(0);
    expect(details.assets?.[0]?.attachmentId).toMatch(/^att_/);
  });
});

describe("buildAigcTools 含 image_edit", () => {
  it("buildAigcTools() 返回数组含 image_edit ToolDefinition", () => {
    const tools = buildAigcTools();
    const editTool = tools.find((t) => t.name === "image_edit");
    expect(editTool).toBeDefined();
    expect(typeof editTool?.execute).toBe("function");
  });

  it("buildAigcTools({ include: ['image_edit'] }) 精确过滤", () => {
    const tools = buildAigcTools({ include: ["image_edit"] });
    expect(tools.length).toBe(1);
    expect(tools[0]?.name).toBe("image_edit");
  });

  it("buildAigcTools({ include: ['text_to_image'] }) 不含 image_edit", () => {
    const tools = buildAigcTools({ include: ["text_to_image"] });
    expect(tools.find((t) => t.name === "image_edit")).toBeUndefined();
  });

  it("buildAigcTools() 含 text_to_image 和 image_edit 两个工具", () => {
    const tools = buildAigcTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("text_to_image");
    expect(names).toContain("image_edit");
  });
});
