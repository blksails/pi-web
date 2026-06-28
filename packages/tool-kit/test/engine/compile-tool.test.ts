/**
 * compile-tool 单元测试。
 *
 * 覆盖:
 *  - model 入参注入为 models 枚举(1.1)
 *  - 默认 model 选取(无 model 参数,1.3)
 *  - LLM model 参数覆盖路由(1.2)
 *  - 非法 model 回退默认(不抛,1.4)
 *  - 执行明细记录实际 model(1.5)
 *  - checkRequiredVars 失败 → 降级 ok:false(6.2/6.3)
 *  - ctx.available===false → 降级 ok:false(6.2)
 *  - 成功路径返回 ok:true 含 assets
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { compileTool } from "../../src/engine/compile-tool.js";
import type { CompileDeps } from "../../src/engine/compile-tool.js";
import type { ToolSpec, PickedResult } from "../../src/engine/types.js";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";

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

// ── 最简测试用 ToolSpec ───────────────────────────────────────────────────────

const MOCK_TOOL: ToolSpec = {
  name: "test_tool",
  description: "test",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "prompt" },
    },
    required: ["prompt"],
  },
  defaultModel: "model-a",
  models: [
    {
      model: "model-a",
      label: "Model A",
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
      model: "model-b",
      label: "Model B",
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
  tool: ToolSpec,
  params: Record<string, unknown>,
  deps: CompileDeps,
) {
  const compiled = compileTool(tool, deps);
  return compiled.execute("call-id", params, undefined, undefined, {} as never);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("compileTool", () => {
  beforeEach(() => {
    // 注入 TEST_KEY 环境变量
    process.env.TEST_KEY = "test-secret";
  });

  afterEach(() => {
    delete process.env.TEST_KEY;
    vi.restoreAllMocks();
  });

  it("model 入参注入为 models 枚举", () => {
    const tool = compileTool(MOCK_TOOL, {
      getCtx: () => makeMockCtx(true),
      fetchImpl: makeImageFetch(),
    });
    const modelSchema = (
      tool.parameters as { properties: { model: { anyOf?: { const?: unknown }[] } } }
    ).properties.model;
    const consts = (modelSchema.anyOf ?? []).map((s) => s.const);
    expect(consts).toEqual(["model-a", "model-b"]);
  });

  it("默认选取 defaultModel 执行", async () => {
    const ctx = makeMockCtx(true);
    const fetchImpl = makeImageFetch();
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };

    const result = await callExecute(MOCK_TOOL, { prompt: "hello" }, deps);
    expect(result.details).toMatchObject({ ok: true });
    const details = result.details as { ok: true; model: string };
    expect(details.model).toBe("model-a");
  });

  it("LLM model 参数覆盖选取对应路由", async () => {
    const ctx = makeMockCtx(true);
    const fetchImpl = makeImageFetch("https://example.com/img-b.png");
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };

    const result = await callExecute(
      MOCK_TOOL,
      { prompt: "hello", model: "model-b" },
      deps,
    );
    expect(result.details).toMatchObject({ ok: true });
    const details = result.details as { ok: true; model: string };
    expect(details.model).toBe("model-b");
  });

  it("非法 model 回退默认(不抛)", async () => {
    const ctx = makeMockCtx(true);
    const fetchImpl = makeImageFetch();
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };

    const result = await callExecute(
      MOCK_TOOL,
      { prompt: "hello", model: "nonexistent" },
      deps,
    );
    expect(result.details).toMatchObject({ ok: true });
    const details = result.details as { ok: true; model: string };
    expect(details.model).toBe("model-a");
  });

  it("checkRequiredVars 失败 → 降级 ok:false(不抛)", async () => {
    delete process.env.TEST_KEY; // 缺少密钥
    const ctx = makeMockCtx(true);
    const fetchImpl = makeImageFetch();
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };

    const result = await callExecute(
      MOCK_TOOL,
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
      MOCK_TOOL,
      { prompt: "hello" },
      deps,
    );
    expect(result.details).toMatchObject({ ok: false });
    const error = (result.details as { ok: false; error: string }).error;
    expect(error).toMatch(/attachment/);
  });

  it("成功路径返回 ok:true 含 assets 与实际 model", async () => {
    const ctx = makeMockCtx(true);
    const fetchImpl = makeImageFetch();
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };

    const result = await callExecute(
      MOCK_TOOL,
      { prompt: "test prompt" },
      deps,
    );
    const details = result.details as {
      ok: true;
      model: string;
      assets: { attachmentId: string }[];
    };
    expect(details.ok).toBe(true);
    expect(details.model).toBe("model-a");
    expect(details.assets.length).toBeGreaterThan(0);
    expect(details.assets[0]?.attachmentId).toBe("att_test01");
  });

  it("出图后先发乐观预览 preliminary 帧(原始 URL),最终帧用签名 URL 覆盖", async () => {
    const ctx = makeMockCtx(true);
    const fetchImpl = makeImageFetch();
    const deps: CompileDeps = { getCtx: () => ctx, fetchImpl };

    const onUpdate = vi.fn();
    const compiled = compileTool(MOCK_TOOL, deps);
    const result = await compiled.execute(
      "call-id",
      { prompt: "hello" },
      undefined,
      onUpdate,
      {} as never,
    );

    // 预览帧:provider 出图后、落库前发出一次,承载原始网关 URL、attachmentId 为空。
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const preview = onUpdate.mock.calls[0]?.[0] as {
      details: {
        ok: true;
        assets: { attachmentId: string; displayUrl: string }[];
      };
    };
    expect(preview.details.ok).toBe(true);
    expect(preview.details.assets[0]?.attachmentId).toBe("");
    expect(preview.details.assets[0]?.displayUrl).toBe(
      "https://example.com/img.png",
    );

    // 最终帧:真实 attachmentId + 签名 displayUrl 覆盖预览。
    const details = result.details as {
      ok: true;
      assets: { attachmentId: string; displayUrl: string }[];
    };
    expect(details.assets[0]?.attachmentId).toBe("att_test01");
    expect(details.assets[0]?.displayUrl).toBe("http://localhost/att/test01");
  });
});
