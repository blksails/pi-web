/**
 * compile-tool 媒体字段解析测试。
 *
 * 覆盖:
 *  - att_id → resolveInputToDataUri 替换(单值 string 字段)
 *  - att_id 数组字段 → 逐一解析
 *  - 已是 data: URI / https:// → 透传不解析
 *  - resolve 失败 → 返回 { ok:false, error } 不崩溃
 *  - 无 mediaKind:image 字段的工具 → 零解析(回归)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { compileTool } from "../../src/engine/compile-tool.js";
import type { CompileDeps } from "../../src/engine/compile-tool.js";
import type { ToolSpec, PickedResult } from "../../src/engine/types.js";
import type { AttachmentToolContext, AttachmentToolHandle } from "@blksails/agent-kit";

// ── Mock 附件上下文 ────────────────────────────────────────────────────────────

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
    async bytes() {
      // 返回 [0x01, 0x02, 0x03, 0x04] → base64: AQIDBA==
      return new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    },
    async localPath() { return `/tmp/${id}.png`; },
    async url() { return `http://localhost/att/${id}`; },
  };
}

function makeMockCtx(resolveImpl?: (id: string) => Promise<AttachmentToolHandle>): AttachmentToolContext {
  return {
    available: true,
    resolve: resolveImpl ?? (async (id) => makeHandle(id)),
    putOutput: vi.fn().mockImplementation(
      async (opts: { name: string; mimeType: string }) => ({
        attachmentId: `att_out_${opts.name}`,
        displayUrl: `http://localhost/att/out/${opts.name}`,
        mimeType: opts.mimeType,
        name: opts.name,
      }),
    ),
  };
}

// ── 图像编辑 ToolSpec 定义(OpenAI 化字段)──────────────────────────────────────

/**
 * 带 mediaKind:image 字段的 mock 工具。
 * buildBody 把 image 原样包进 body 以便断言是否被解析。
 */
const IMAGE_EDIT_TOOL: ToolSpec = {
  name: "mock_image_edit",
  description: "test",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "prompt" },
      image: {
        type: "string",
        description: "main image",
        mediaKind: "image",
      },
      mask: {
        type: "string",
        description: "optional mask",
        mediaKind: "image",
      },
      reference_images: {
        type: "array",
        description: "reference images",
        items: { type: "string", mediaKind: "image" },
        mediaKind: "image",
      },
    },
    required: ["prompt", "image"],
  },
  defaultModel: "test-edit",
  models: [
    {
      model: "test-edit",
      label: "Test Edit",
      description: "test",
      url: "https://example.com/edit",
      headers: { authorization: "Bearer ${TEST_EDIT_KEY}" },
      requiredVars: ["TEST_EDIT_KEY"],
      buildBody: (args) => ({
        prompt: (args as { prompt: string }).prompt,
        image: (args as { image: string }).image,
        mask: (args as { mask?: string }).mask,
        reference_images: (args as { reference_images?: string[] }).reference_images,
      }),
      pickResult: (): PickedResult => ({
        kind: "image",
        url: "https://example.com/result.png",
      }),
    },
  ],
};

/** 无 mediaKind 字段的 mock 工具(回归测试)。 */
const TEXT_ONLY_TOOL: ToolSpec = {
  name: "mock_text_only",
  description: "test",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "prompt" },
    },
    required: ["prompt"],
  },
  defaultModel: "text-v",
  models: [
    {
      model: "text-v",
      label: "Text V",
      description: "test",
      url: "https://example.com/text",
      headers: { authorization: "Bearer ${TEST_EDIT_KEY}" },
      requiredVars: ["TEST_EDIT_KEY"],
      buildBody: (args) => ({ prompt: (args as { prompt: string }).prompt }),
      pickResult: (): PickedResult => ({
        kind: "image",
        url: "https://example.com/result.png",
      }),
    },
  ],
};

// ── 构造 fetchImpl(provider 端点 + 产物 fetch)────────────────────────────────

function makeEditFetch() {
  return vi.fn().mockImplementation(async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
    if (u.includes("example.com/result")) {
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
        headers: { get: () => "image/png" },
        status: 200,
      };
    }
    // provider 端点
    return {
      ok: true,
      text: async () => JSON.stringify({
        kind: "image",
        url: "https://example.com/result.png",
      }),
      headers: { get: () => "application/json" },
      status: 200,
    };
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("compileTool 媒体字段解析", () => {
  beforeEach(() => {
    process.env.TEST_EDIT_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.TEST_EDIT_KEY;
    vi.restoreAllMocks();
  });

  it("att_id 字符串字段 → resolveInputToDataUri 替换为 data URI", async () => {
    const resolvedValues: string[] = [];
    const ctx = makeMockCtx();
    // 拦截 resolve 记录调用
    const origResolve = ctx.resolve.bind(ctx);
    const spyResolve = vi.fn().mockImplementation(origResolve);
    const spyCtx: AttachmentToolContext = { ...ctx, resolve: spyResolve };

    let capturedImage: unknown;
    const tool: ToolSpec = {
      ...IMAGE_EDIT_TOOL,
      models: [
        {
          ...IMAGE_EDIT_TOOL.models[0]!,
          buildBody: (args) => {
            capturedImage = (args as { image: string }).image;
            return { image: capturedImage };
          },
        },
      ],
    };

    const fetchImpl = makeEditFetch() as typeof fetch;
    const deps: CompileDeps = { getCtx: () => spyCtx, fetchImpl };
    const compiled = compileTool(tool, deps);
    await compiled.execute(
      "call-1",
      { prompt: "add stars", image: "att_abc123" },
      undefined,
      undefined,
      {} as never,
    );

    expect(spyResolve).toHaveBeenCalledWith("att_abc123");
    // buildBody 收到的 image 应该是 data URI
    expect(String(capturedImage)).toMatch(/^data:image\/png;base64,/);
    resolvedValues.push(String(capturedImage));
  });

  it("已是 data: URI → 透传不调用 resolve", async () => {
    const ctx = makeMockCtx();
    const spyResolve = vi.fn().mockImplementation(ctx.resolve.bind(ctx));
    const spyCtx: AttachmentToolContext = { ...ctx, resolve: spyResolve };

    const dataUri = "data:image/png;base64,aGVsbG8=";
    const fetchImpl = makeEditFetch() as typeof fetch;
    const deps: CompileDeps = { getCtx: () => spyCtx, fetchImpl };
    const compiled = compileTool(IMAGE_EDIT_TOOL, deps);
    await compiled.execute(
      "call-2",
      { prompt: "test", image: dataUri },
      undefined,
      undefined,
      {} as never,
    );
    // resolve 不应被调用(已是 data URI)
    expect(spyResolve).not.toHaveBeenCalled();
  });

  it("已是 https:// URL → 透传不调用 resolve", async () => {
    const ctx = makeMockCtx();
    const spyResolve = vi.fn().mockImplementation(ctx.resolve.bind(ctx));
    const spyCtx: AttachmentToolContext = { ...ctx, resolve: spyResolve };

    const fetchImpl = makeEditFetch() as typeof fetch;
    const deps: CompileDeps = { getCtx: () => spyCtx, fetchImpl };
    const compiled = compileTool(IMAGE_EDIT_TOOL, deps);
    await compiled.execute(
      "call-3",
      { prompt: "test", image: "https://cdn.example.com/img.png" },
      undefined,
      undefined,
      {} as never,
    );
    expect(spyResolve).not.toHaveBeenCalled();
  });

  it("数组字段每个 att_id 元素都被解析", async () => {
    const ctx = makeMockCtx();
    const resolvedIds: string[] = [];
    const spyResolve = vi.fn().mockImplementation(async (id: string) => {
      resolvedIds.push(id);
      return makeHandle(id);
    });
    const spyCtx: AttachmentToolContext = { ...ctx, resolve: spyResolve };

    let capturedRefs: unknown;
    const tool: ToolSpec = {
      ...IMAGE_EDIT_TOOL,
      models: [
        {
          ...IMAGE_EDIT_TOOL.models[0]!,
          buildBody: (args) => {
            capturedRefs = (args as { reference_images?: unknown }).reference_images;
            return { prompt: (args as { prompt: string }).prompt };
          },
        },
      ],
    };

    const fetchImpl = makeEditFetch() as typeof fetch;
    const deps: CompileDeps = { getCtx: () => spyCtx, fetchImpl };
    const compiled = compileTool(tool, deps);
    await compiled.execute(
      "call-4",
      {
        prompt: "test",
        image: "https://example.com/main.png",
        reference_images: ["att_ref1", "att_ref2"],
      },
      undefined,
      undefined,
      {} as never,
    );

    expect(resolvedIds).toContain("att_ref1");
    expect(resolvedIds).toContain("att_ref2");
    // capturedRefs 应该都是 data URI
    const refs = capturedRefs as string[];
    for (const ref of refs) {
      expect(ref).toMatch(/^data:image\/png;base64,/);
    }
  });

  it("resolve 失败 → 返回 ok:false 不崩溃", async () => {
    const ctx = makeMockCtx(async () => {
      throw new Error("attachment not found");
    });

    const fetchImpl = makeEditFetch() as typeof fetch;
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };
    const compiled = compileTool(IMAGE_EDIT_TOOL, deps);
    const result = await compiled.execute(
      "call-5",
      { prompt: "test", image: "att_nonexistent" },
      undefined,
      undefined,
      {} as never,
    );
    expect((result.details as { ok: boolean }).ok).toBe(false);
    expect((result.details as { ok: false; error: string }).error).toContain("attachment not found");
  });

  it("无 mediaKind 字段的工具不调用 resolve(回归)", async () => {
    const ctx = makeMockCtx();
    const spyResolve = vi.fn().mockImplementation(ctx.resolve.bind(ctx));
    const spyCtx: AttachmentToolContext = { ...ctx, resolve: spyResolve };

    const fetchImpl = makeEditFetch() as typeof fetch;
    const deps: CompileDeps = { getCtx: () => spyCtx, fetchImpl };
    const compiled = compileTool(TEXT_ONLY_TOOL, deps);
    await compiled.execute(
      "call-6",
      { prompt: "a mountain" },
      undefined,
      undefined,
      {} as never,
    );
    expect(spyResolve).not.toHaveBeenCalled();
  });
});
