/**
 * image_generation 集成测试。
 *
 * 覆盖:
 *  - sync model:prompt → runEndpoint(mock sync fetch) → persistPicked → details.ok===true 含 2 assets
 *  - async model:用 createDashscopeAsyncT2I 自建临时工具,mock fetch 提交 task_id,polling 返回
 *    SUCCEEDED+results → 同流程(覆盖 DashScope 异步形态保留,Req 4.2)
 *  - buildAigcTools() 产出数组含 image_generation ToolDefinition
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { compileTool } from "../../src/engine/compile-tool.js";
import { buildAigcTools } from "../../src/aigc/index.js";
import { imageGeneration } from "../../src/aigc/tools/image-generation.js";
import { createDashscopeAsyncT2I } from "../../src/aigc/providers/dashscope.js";
import type { CompileDeps } from "../../src/engine/compile-tool.js";
import type { AttachmentToolContext } from "@pi-web/agent-kit";
import type { ToolSpec } from "../../src/engine/types.js";

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

describe("image_generation integration", () => {
  beforeEach(() => {
    process.env.DASHSCOPE_API_KEY = "test-dashscope-key";
  });

  afterEach(() => {
    delete process.env.DASHSCOPE_API_KEY;
    vi.restoreAllMocks();
  });

  it("sync model (wan2.7-image-pro): prompt → 2 images → persistPicked → details.ok true + 2 assets", async () => {
    const imageUrls = [
      "https://dashscope-result.aliyuncs.com/img1.png",
      "https://dashscope-result.aliyuncs.com/img2.png",
    ];
    const ctx = makeMockCtx();
    const fetchImpl = makeSyncFetch(imageUrls) as typeof fetch;
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };

    const tool = compileTool(imageGeneration, deps);
    const result = await tool.execute(
      "call-sync",
      { prompt: "mountain lake", model: "wan2.7-image-pro" },
      undefined,
      undefined,
      {} as never,
    );

    const details = result.details as {
      ok: boolean;
      model?: string;
      assets?: { attachmentId: string; mimeType: string }[];
    };
    expect(details.ok).toBe(true);
    expect(details.model).toBe("wan2.7-image-pro");
    expect(details.assets).toBeDefined();
    expect(details.assets?.length).toBe(2);
    expect(details.assets?.[0]?.attachmentId).toMatch(/^att_/);
  });

  it("async model: 自建工具 task_id → SUCCEEDED + results → details.ok true(Req 4.2)", async () => {
    const imageUrls = [
      "https://dashscope-result.aliyuncs.com/wanx1.png",
    ];
    const ctx = makeMockCtx();
    const fetchImpl = makeAsyncFetch(imageUrls) as typeof fetch;

    // 用 createDashscopeAsyncT2I 自建临时工具,加速 pollMs 避免超时。
    const asyncRoute = createDashscopeAsyncT2I({
      model: "wanx-async",
      label: "Wanx Async",
      description: "test async polling",
      providerModel: "wanx2.0-t2i-turbo",
    });
    const fastRoute = {
      ...asyncRoute,
      async: { ...asyncRoute.async!, pollMs: 50, timeoutMs: 10_000 },
    };
    const asyncTool: ToolSpec = {
      name: "async_gen_test",
      description: "async test tool",
      inputSchema: {
        type: "object",
        properties: { prompt: { type: "string", description: "prompt" } },
        required: ["prompt"],
      },
      defaultModel: "wanx-async",
      models: [fastRoute],
    };

    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };
    const tool = compileTool(asyncTool, deps);
    const result = await tool.execute(
      "call-async",
      { prompt: "snowy mountains" },
      undefined,
      undefined,
      {} as never,
    );

    const details = result.details as {
      ok: boolean;
      model?: string;
      assets?: { attachmentId: string }[];
    };
    expect(details.ok).toBe(true);
    expect(details.model).toBe("wanx-async");
    expect(details.assets?.length).toBe(1);
  }, 15_000);

  it("buildAigcTools() 返回数组含 image_generation ToolDefinition", () => {
    const tools = buildAigcTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
    const genTool = tools.find((t) => t.name === "image_generation");
    expect(genTool).toBeDefined();
    expect(typeof genTool?.execute).toBe("function");
  });

  it("buildAigcTools({ include: ['image_generation'] }) 精确过滤", () => {
    const tools = buildAigcTools({ include: ["image_generation"] });
    expect(tools.length).toBe(1);
    expect(tools[0]?.name).toBe("image_generation");
  });

  it("buildAigcTools({ include: ['nonexistent'] }) 返回空数组", () => {
    const tools = buildAigcTools({ include: ["nonexistent"] });
    expect(tools.length).toBe(0);
  });
});
