/**
 * image_edit ToolSpec 集成测试。
 *
 * 覆盖:
 *  - imageEdit 工具声明基本字段(OpenAI 化:prompt/image/mask/reference_images)
 *  - DashScope mask-aware model: prompt + image(att_id) → resolve → edit → persist → image ref
 *  - buildAigcTools() 含 image_edit 工具
 *  - include filter 仅返回指定工具
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { imageEdit } from "../../../src/aigc/tools/image-edit.js";
import { compileTool } from "../../../src/engine/compile-tool.js";
import { buildAigcTools } from "../../../src/aigc/index.js";
import type { CompileDeps } from "../../../src/engine/compile-tool.js";
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

describe("imageEdit 工具声明", () => {
  it("name === 'image_edit'", () => {
    expect(imageEdit.name).toBe("image_edit");
  });

  it("inputSchema 含 prompt / image / mask / reference_images", () => {
    const props = imageEdit.inputSchema.properties;
    expect(props).toHaveProperty("prompt");
    expect(props).toHaveProperty("image");
    expect(props).toHaveProperty("mask");
    expect(props).toHaveProperty("reference_images");
  });

  it("image 和 mask 有 mediaKind:image", () => {
    const props = imageEdit.inputSchema.properties;
    expect(props["image"]?.mediaKind).toBe("image");
    expect(props["mask"]?.mediaKind).toBe("image");
  });

  it("reference_images.items 有 mediaKind:image", () => {
    const refProp = imageEdit.inputSchema.properties["reference_images"];
    expect(refProp?.items?.mediaKind).toBe("image");
  });

  it("required 包含 image 和 prompt", () => {
    expect(imageEdit.inputSchema.required).toContain("image");
    expect(imageEdit.inputSchema.required).toContain("prompt");
  });

  it("models 非空，含 DashScope 和 NewAPI 路由", () => {
    expect(imageEdit.models.length).toBeGreaterThan(1);
    const names = imageEdit.models.map((m) => m.model);
    // 至少有一个 DashScope model 和一个 NewAPI(gpt-image)model
    const hasDashscope = names.some((n) => n.includes("qwen") || n.includes("dashscope"));
    const hasNewapi = names.some((n) => n.includes("gpt"));
    expect(hasDashscope).toBe(true);
    expect(hasNewapi).toBe(true);
  });

  it("defaultModel 存在于 models", () => {
    const modelNames = imageEdit.models.map((m) => m.model);
    expect(modelNames).toContain(imageEdit.defaultModel);
  });
});

describe("imageEdit 执行(DashScope)", () => {
  beforeEach(() => {
    process.env.DASHSCOPE_API_KEY = "test-dashscope-key";
  });

  afterEach(() => {
    delete process.env.DASHSCOPE_API_KEY;
    vi.restoreAllMocks();
  });

  it("prompt + image(att_id) → resolve → edit → persist → ok:true + asset", async () => {
    const ctx = makeMockCtx();
    const resolveSpy = vi.spyOn(ctx, "resolve");
    const fetchImpl = makeDashScopeFetch() as typeof fetch;
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };

    // 选 DashScope qwen-image-edit 路由作默认
    const dashscopeModel = imageEdit.models.find((m) => m.model.includes("qwen"));
    const toolWithDashscope = dashscopeModel
      ? { ...imageEdit, defaultModel: dashscopeModel.model }
      : imageEdit;

    const compiled = compileTool(toolWithDashscope, deps);
    const result = await compiled.execute(
      "call-edit-1",
      {
        prompt: "add stars to the sky",
        image: "att_main123",
      },
      undefined,
      undefined,
      {} as never,
    );

    // image att_id 应被 resolve
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

  it("buildAigcTools({ include: ['image_generation'] }) 不含 image_edit", () => {
    const tools = buildAigcTools({ include: ["image_generation"] });
    expect(tools.find((t) => t.name === "image_edit")).toBeUndefined();
  });

  it("buildAigcTools() 含 image_generation 和 image_edit 两个工具", () => {
    const tools = buildAigcTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("image_generation");
    expect(names).toContain("image_edit");
  });
});
