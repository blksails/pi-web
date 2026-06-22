/**
 * text_to_image 集成测试。
 *
 * 覆盖:
 *  - sync 变体:prompt → runEndpoint(mock sync fetch) → persistPicked → details.ok===true 含 2 assets
 *  - async 变体:mock fetch 第一次返回 task_id,polling 返回 SUCCEEDED+results → 同流程
 *  - buildAigcTools() 产出数组含 text_to_image ToolDefinition
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { compileCategory } from "../../src/engine/compile-category.js";
import { buildAigcTools } from "../../src/aigc/index.js";
import { textToImage } from "../../src/aigc/categories/text-to-image.js";
import type { CompileDeps } from "../../src/engine/compile-category.js";
import type { AttachmentToolContext } from "@pi-web/agent-kit";
import type { Category } from "../../src/engine/types.js";

// ── Mock 工具 ────────────────────────────────────────────────────────────────

let putOutputCallCount = 0;

function makeMockCtx(): AttachmentToolContext {
  putOutputCallCount = 0;
  return {
    available: true,
    resolve: async () => { throw new Error("not needed"); },
    putOutput: vi.fn().mockImplementation(async (opts: { name: string; mimeType: string }) => {
      const id = `att_img${++putOutputCallCount}`;
      return {
        attachmentId: id,
        displayUrl: `http://localhost/att/${id}`,
        mimeType: opts.mimeType ?? "image/png",
        name: opts.name,
      };
    }),
  };
}

/**
 * 构造 sync T2I mock fetch:
 *   - provider 端点 → 返回含 N 张图 URL 的 choices 响应
 *   - 产物 fetch → 返回 8 字节 ArrayBuffer
 */
function makeSyncFetch(imageUrls: string[]) {
  return vi.fn().mockImplementation(async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
    // 产物 fetch(persistPicked 里下载图片)
    if (imageUrls.some((iu) => u === iu)) {
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
        headers: { get: () => "image/png" },
        status: 200,
      };
    }
    // provider 端点 → 同步 choices 响应
    const choices = imageUrls.map((imageUrl) => ({
      message: { content: [{ image: imageUrl }] },
    }));
    return {
      ok: true,
      text: async () =>
        JSON.stringify({
          output: { choices },
        }),
      headers: { get: () => "application/json" },
      status: 200,
    };
  });
}

/**
 * 构造 async T2I mock fetch:
 *   - 第一次调用(提交)→ 返回 task_id
 *   - 轮询调用(含 /tasks/)→ 返回 SUCCEEDED + results
 *   - 产物 fetch → 返回 8 字节 ArrayBuffer
 */
function makeAsyncFetch(imageUrls: string[]) {
  let submitDone = false;
  return vi.fn().mockImplementation(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;

    // 产物 fetch
    if (imageUrls.some((iu) => u === iu)) {
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
        headers: { get: () => "image/png" },
        status: 200,
      };
    }

    // 提交端点
    if (u.includes("text2image") && !submitDone) {
      submitDone = true;
      return {
        ok: true,
        text: async () => JSON.stringify({ output: { task_id: "task-abc" } }),
        headers: { get: () => "application/json" },
        status: 200,
      };
    }

    // 轮询端点(/tasks/task-abc)
    if (u.includes("/tasks/")) {
      const results = imageUrls.map((url) => ({ url }));
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            output: {
              task_status: "SUCCEEDED",
              results,
            },
          }),
        headers: { get: () => "application/json" },
        status: 200,
      };
    }

    throw new Error(`Unexpected fetch URL in mock: ${u}`);
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("text_to_image integration", () => {
  beforeEach(() => {
    process.env.DASHSCOPE_API_KEY = "test-dashscope-key";
  });

  afterEach(() => {
    delete process.env.DASHSCOPE_API_KEY;
    vi.restoreAllMocks();
  });

  it("sync 变体 (qwen-image): prompt → 2 images → persistPicked → details.ok true + 2 assets", async () => {
    const imageUrls = [
      "https://dashscope-result.aliyuncs.com/img1.png",
      "https://dashscope-result.aliyuncs.com/img2.png",
    ];
    const ctx = makeMockCtx();
    const fetchImpl = makeSyncFetch(imageUrls) as typeof fetch;
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };

    const tool = compileCategory(textToImage, deps);
    const result = await tool.execute(
      "call-sync",
      { prompt: "mountain lake", model: "qwen-image" },
      undefined,
      undefined,
      {} as never,
    );

    const details = result.details as {
      ok: boolean;
      assets?: { attachmentId: string; mimeType: string }[];
    };
    expect(details.ok).toBe(true);
    expect(details.assets).toBeDefined();
    expect(details.assets?.length).toBe(2);
    expect(details.assets?.[0]?.attachmentId).toMatch(/^att_/);
  });

  it("async 变体 (wanx-turbo): task_id → SUCCEEDED + results → details.ok true", async () => {
    const imageUrls = [
      "https://dashscope-result.aliyuncs.com/wanx1.png",
    ];
    const ctx = makeMockCtx();
    const fetchImpl = makeAsyncFetch(imageUrls) as typeof fetch;

    // 用加速了 pollMs 的变体构造 category,避免测试超时
    const fastAsyncCategory: Category = {
      ...textToImage,
      variants: textToImage.variants.map((v) =>
        v.name === "wanx-turbo" && v.async !== undefined
          ? { ...v, async: { ...v.async, pollMs: 50, timeoutMs: 10_000 } }
          : v,
      ),
    };

    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };
    const tool = compileCategory(fastAsyncCategory, deps);
    const result = await tool.execute(
      "call-async",
      { prompt: "snowy mountains", model: "wanx-turbo" },
      undefined,
      undefined,
      {} as never,
    );

    const details = result.details as {
      ok: boolean;
      variant?: string;
      assets?: { attachmentId: string }[];
    };
    expect(details.ok).toBe(true);
    expect(details.variant).toBe("wanx-turbo");
    expect(details.assets?.length).toBe(1);
  }, 15_000);

  it("buildAigcTools() 返回数组含 text_to_image ToolDefinition", () => {
    const tools = buildAigcTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
    const t2iTool = tools.find((t) => t.name === "text_to_image");
    expect(t2iTool).toBeDefined();
    expect(typeof t2iTool?.execute).toBe("function");
  });

  it("buildAigcTools({ include: ['text_to_image'] }) 精确过滤", () => {
    const tools = buildAigcTools({ include: ["text_to_image"] });
    expect(tools.length).toBe(1);
    expect(tools[0]?.name).toBe("text_to_image");
  });

  it("buildAigcTools({ include: ['nonexistent'] }) 返回空数组", () => {
    const tools = buildAigcTools({ include: ["nonexistent"] });
    expect(tools.length).toBe(0);
  });
});
