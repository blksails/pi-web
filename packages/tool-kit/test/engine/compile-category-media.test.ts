/**
 * compile-category 媒体字段解析测试。
 *
 * 覆盖:
 *  - att_id → resolveInputToDataUri 替换(单值 string 字段)
 *  - att_id 数组字段 → 逐一解析
 *  - 已是 data: URI / https:// → 透传不解析
 *  - resolve 失败 → 返回 { ok:false, error } 不崩溃
 *  - 无 mediaKind:image 字段的工具 → 零解析(回归)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { compileCategory } from "../../src/engine/compile-category.js";
import type { CompileDeps } from "../../src/engine/compile-category.js";
import type { Category, PickedResult } from "../../src/engine/types.js";
import type { AttachmentToolContext, AttachmentToolHandle } from "@pi-web/agent-kit";

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

// ── 图像编辑 Category 定义 ────────────────────────────────────────────────────

/**
 * 带 mediaKind:image 字段的 mock category。
 * buildBody 把 image_url 原样包进 body 以便断言是否被解析。
 */
const IMAGE_EDIT_CATEGORY: Category = {
  name: "mock_image_edit",
  description: "test",
  inputSchema: {
    type: "object",
    properties: {
      instruction: { type: "string", description: "instruction" },
      image_url: {
        type: "string",
        description: "main image",
        mediaKind: "image",
      },
      mask_url: {
        type: "string",
        description: "optional mask",
        mediaKind: "image",
      },
      reference_image_urls: {
        type: "array",
        description: "reference images",
        items: { type: "string", mediaKind: "image" },
        mediaKind: "image",
      },
    },
    required: ["instruction", "image_url"],
  },
  defaultVariant: "test-edit",
  variants: [
    {
      name: "test-edit",
      label: "Test Edit",
      description: "test",
      url: "https://example.com/edit",
      headers: { authorization: "Bearer ${TEST_EDIT_KEY}" },
      requiredVars: ["TEST_EDIT_KEY"],
      buildBody: (args) => ({
        instruction: (args as { instruction: string }).instruction,
        image_url: (args as { image_url: string }).image_url,
        mask_url: (args as { mask_url?: string }).mask_url,
        reference_image_urls: (args as { reference_image_urls?: string[] }).reference_image_urls,
      }),
      pickResult: (): PickedResult => ({
        kind: "image",
        url: "https://example.com/result.png",
      }),
    },
  ],
};

/** 无 mediaKind 字段的 mock category(回归测试)。 */
const TEXT_ONLY_CATEGORY: Category = {
  name: "mock_text_only",
  description: "test",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "prompt" },
    },
    required: ["prompt"],
  },
  defaultVariant: "text-v",
  variants: [
    {
      name: "text-v",
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

describe("compile-category 媒体字段解析", () => {
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

    let capturedImageUrl: unknown;
    const category: Category = {
      ...IMAGE_EDIT_CATEGORY,
      variants: [
        {
          ...IMAGE_EDIT_CATEGORY.variants[0]!,
          buildBody: (args) => {
            capturedImageUrl = (args as { image_url: string }).image_url;
            return { image_url: capturedImageUrl };
          },
        },
      ],
    };

    const fetchImpl = makeEditFetch() as typeof fetch;
    const deps: CompileDeps = { getCtx: () => spyCtx, fetchImpl };
    const tool = compileCategory(category, deps);
    await tool.execute(
      "call-1",
      { instruction: "add stars", image_url: "att_abc123" },
      undefined,
      undefined,
      {} as never,
    );

    expect(spyResolve).toHaveBeenCalledWith("att_abc123");
    // buildBody 收到的 image_url 应该是 data URI
    expect(String(capturedImageUrl)).toMatch(/^data:image\/png;base64,/);
    resolvedValues.push(String(capturedImageUrl));
  });

  it("已是 data: URI → 透传不调用 resolve", async () => {
    const ctx = makeMockCtx();
    const spyResolve = vi.fn().mockImplementation(ctx.resolve.bind(ctx));
    const spyCtx: AttachmentToolContext = { ...ctx, resolve: spyResolve };

    const dataUri = "data:image/png;base64,aGVsbG8=";
    const fetchImpl = makeEditFetch() as typeof fetch;
    const deps: CompileDeps = { getCtx: () => spyCtx, fetchImpl };
    const tool = compileCategory(IMAGE_EDIT_CATEGORY, deps);
    await tool.execute(
      "call-2",
      { instruction: "test", image_url: dataUri },
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
    const tool = compileCategory(IMAGE_EDIT_CATEGORY, deps);
    await tool.execute(
      "call-3",
      { instruction: "test", image_url: "https://cdn.example.com/img.png" },
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
    const category: Category = {
      ...IMAGE_EDIT_CATEGORY,
      variants: [
        {
          ...IMAGE_EDIT_CATEGORY.variants[0]!,
          buildBody: (args) => {
            capturedRefs = (args as { reference_image_urls?: unknown }).reference_image_urls;
            return { instruction: (args as { instruction: string }).instruction };
          },
        },
      ],
    };

    const fetchImpl = makeEditFetch() as typeof fetch;
    const deps: CompileDeps = { getCtx: () => spyCtx, fetchImpl };
    const tool = compileCategory(category, deps);
    await tool.execute(
      "call-4",
      {
        instruction: "test",
        image_url: "https://example.com/main.png",
        reference_image_urls: ["att_ref1", "att_ref2"],
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
    const tool = compileCategory(IMAGE_EDIT_CATEGORY, deps);
    const result = await tool.execute(
      "call-5",
      { instruction: "test", image_url: "att_nonexistent" },
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
    const tool = compileCategory(TEXT_ONLY_CATEGORY, deps);
    await tool.execute(
      "call-6",
      { prompt: "a mountain" },
      undefined,
      undefined,
      {} as never,
    );
    expect(spyResolve).not.toHaveBeenCalled();
  });
});
