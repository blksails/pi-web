/**
 * compile-category 单元测试。
 *
 * 覆盖:
 *  - 默认变体选取(无 model 参数)
 *  - LLM model 参数覆盖变体
 *  - 参数越界返回 ok:false(不抛)
 *  - checkRequiredVars 失败 → 降级 ok:false
 *  - ctx.available===false → 降级 ok:false
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { compileCategory } from "../../src/engine/compile-category.js";
import type { CompileDeps } from "../../src/engine/compile-category.js";
import type { Category, PickedResult } from "../../src/engine/types.js";
import type { AttachmentToolContext } from "@pi-web/agent-kit";

// ── Mock AttachmentToolContext ────────────────────────────────────────────────

function makeMockCtx(available = true): AttachmentToolContext {
  if (!available) {
    return {
      available: false,
      resolve: async () => { throw new Error("unavailable"); },
      putOutput: async () => { throw new Error("unavailable"); },
    };
  }
  return {
    available: true,
    resolve: async () => { throw new Error("not needed in this test"); },
    putOutput: vi.fn().mockResolvedValue({
      attachmentId: "att_test01",
      displayUrl: "http://localhost/att/test01",
      mimeType: "image/png",
      name: "aigc-0.png",
    }),
  };
}

// ── Mock fetch ────────────────────────────────────────────────────────────────

/** 构造一个返回单张图 URL 的同步 provider mock fetch。 */
function makeImageFetch(imageUrl = "https://example.com/img.png") {
  return vi.fn().mockImplementation(async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    // provider 端点 → 返回同步 image-set 响应
    if (u.includes("multimodal-generation") || u.includes("dashscope")) {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            output: {
              choices: [
                {
                  message: {
                    content: [{ image: imageUrl }],
                  },
                },
              ],
            },
          }),
        json: async () => ({
          output: {
            choices: [{ message: { content: [{ image: imageUrl }] } }],
          },
        }),
        headers: { get: () => "application/json" },
        status: 200,
      };
    }
    // 产物 fetch(persistPicked 里 fetch 图片字节)
    return {
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
      headers: { get: () => "image/png" },
      status: 200,
    };
  });
}

// ── 最简测试用 Category ───────────────────────────────────────────────────────

const MOCK_CATEGORY: Category = {
  name: "test_tool",
  description: "test",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "prompt" },
    },
    required: ["prompt"],
  },
  userParams: [
    { name: "n", label: "N", type: "integer", default: 1, min: 1, max: 4 },
  ],
  defaultVariant: "variant-a",
  variants: [
    {
      name: "variant-a",
      label: "Variant A",
      description: "First",
      url: "https://example.com/multimodal-generation",
      headers: { authorization: "Bearer ${TEST_KEY}" },
      requiredVars: ["TEST_KEY"],
      buildBody: (args) => ({ prompt: (args as { prompt: string }).prompt }),
      pickResult: () => ({
        kind: "image",
        url: "https://example.com/img.png",
      } as PickedResult),
    },
    {
      name: "variant-b",
      label: "Variant B",
      description: "Second",
      url: "https://example.com/multimodal-generation",
      headers: { authorization: "Bearer ${TEST_KEY}" },
      requiredVars: ["TEST_KEY"],
      buildBody: (args) => ({ prompt: (args as { prompt: string }).prompt }),
      pickResult: () => ({
        kind: "image",
        url: "https://example.com/img-b.png",
      } as PickedResult),
    },
  ],
};

// ── 辅助:调用 execute ─────────────────────────────────────────────────────────

async function callExecute(
  category: Category,
  params: Record<string, unknown>,
  deps: CompileDeps,
) {
  const tool = compileCategory(category, deps);
  return tool.execute("call-id", params, undefined, undefined, {} as never);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("compileCategory", () => {
  beforeEach(() => {
    // 注入 TEST_KEY 环境变量
    process.env.TEST_KEY = "test-secret";
  });

  afterEach(() => {
    delete process.env.TEST_KEY;
    vi.restoreAllMocks();
  });

  it("默认选取 defaultVariant 执行", async () => {
    const ctx = makeMockCtx(true);
    const fetchImpl = makeImageFetch();
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };

    const result = await callExecute(MOCK_CATEGORY, { prompt: "hello" }, deps);
    expect(result.details).toMatchObject({ ok: true });
    const details = result.details as { ok: true; variant: string };
    expect(details.variant).toBe("variant-a");
  });

  it("LLM model 参数覆盖选取对应变体", async () => {
    const ctx = makeMockCtx(true);
    const fetchImpl = makeImageFetch("https://example.com/img-b.png");
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };

    const result = await callExecute(
      MOCK_CATEGORY,
      { prompt: "hello", model: "variant-b" },
      deps,
    );
    expect(result.details).toMatchObject({ ok: true });
    const details = result.details as { ok: true; variant: string };
    expect(details.variant).toBe("variant-b");
  });

  it("userParam n 越界(>max)返回 ok:false 不抛", async () => {
    const ctx = makeMockCtx(true);
    const fetchImpl = makeImageFetch();
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };

    const result = await callExecute(
      MOCK_CATEGORY,
      { prompt: "hello", n: 99 },
      deps,
    );
    expect(result.details).toMatchObject({ ok: false });
    expect((result.details as { ok: false; error: string }).error).toContain("4");
  });

  it("userParam n 越界(<min)返回 ok:false 不抛", async () => {
    const ctx = makeMockCtx(true);
    const fetchImpl = makeImageFetch();
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };

    const result = await callExecute(
      MOCK_CATEGORY,
      { prompt: "hello", n: 0 },
      deps,
    );
    expect(result.details).toMatchObject({ ok: false });
  });

  it("checkRequiredVars 失败 → 降级 ok:false(不抛)", async () => {
    delete process.env.TEST_KEY; // 缺少密钥
    const ctx = makeMockCtx(true);
    const fetchImpl = makeImageFetch();
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };

    const result = await callExecute(
      MOCK_CATEGORY,
      { prompt: "hello" },
      deps,
    );
    expect(result.details).toMatchObject({ ok: false });
    const error = (result.details as { ok: false; error: string }).error;
    expect(error).toMatch(/TEST_KEY/);
  });

  it("ctx.available===false → 降级 ok:false(不抛)", async () => {
    const ctx = makeMockCtx(false);
    const fetchImpl = makeImageFetch();
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };

    const result = await callExecute(
      MOCK_CATEGORY,
      { prompt: "hello" },
      deps,
    );
    expect(result.details).toMatchObject({ ok: false });
    const error = (result.details as { ok: false; error: string }).error;
    expect(error).toMatch(/attachment/);
  });

  it("成功路径返回 ok:true 含 assets", async () => {
    const ctx = makeMockCtx(true);
    const fetchImpl = makeImageFetch();
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };

    const result = await callExecute(
      MOCK_CATEGORY,
      { prompt: "test prompt" },
      deps,
    );
    const details = result.details as {
      ok: true;
      variant: string;
      assets: { attachmentId: string }[];
    };
    expect(details.ok).toBe(true);
    expect(details.assets.length).toBeGreaterThan(0);
    expect(details.assets[0]?.attachmentId).toBe("att_test01");
  });
});
