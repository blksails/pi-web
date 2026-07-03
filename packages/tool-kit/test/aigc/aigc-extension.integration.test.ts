/**
 * aigcExtension 注册与 execute 集成测试(detoolspec-unify-builtin-tools task 4.3)。
 *
 * 用 fake pi 收集 `aigcExtension` 注册的工具,经 globalThis attachment seam + 全局 fetch stub
 * 跑真实 execute 链路:验证注册(Req 2.1/2.5)、成功 result 形态(Req 1.2/1.4/6.3)、
 * image_edit 主图+mask+参考图 ≤3 限制(超限降级)。
 *
 * 注:`noTools:"builtin"` 不影响 extension 工具(Req 2.4)由真实 agent 装配,放浏览器/节点 e2e 验证。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { aigcExtension } from "../../src/aigc/extension.js";
import { SEAM_KEY } from "../../src/attachment/seam.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";

interface CollectedTool {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  execute: (
    id: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ) => Promise<{ content: { type: string; text: string }[]; details: unknown }>;
}

function collectAigcTools(): CollectedTool[] {
  const tools: CollectedTool[] = [];
  const pi = {
    registerTool: (def: CollectedTool) => tools.push(def),
    registerCommand: () => {},
  } as unknown as ExtensionAPI;
  aigcExtension(pi);
  return tools;
}

function installSeam(): AttachmentToolContext {
  let n = 0;
  const ctx = {
    available: true,
    resolve: vi.fn(async () => ({
      bytes: async () => new Uint8Array([1, 2, 3]),
      meta: { mimeType: "image/png" },
    })),
    putOutput: vi.fn(async (o: { name: string; mimeType: string }) => {
      const id = `att_out${++n}`;
      return { attachmentId: id, displayUrl: `http://localhost/att/${id}`, mimeType: o.mimeType, name: o.name };
    }),
  } as unknown as AttachmentToolContext;
  (globalThis as Record<string, unknown>)[SEAM_KEY] = ctx;
  return ctx;
}

const noUI = { hasUI: false } as unknown as ExtensionContext;

describe("aigcExtension integration", () => {
  beforeEach(() => {
    process.env.DASHSCOPE_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.DASHSCOPE_API_KEY;
    delete (globalThis as Record<string, unknown>)[SEAM_KEY];
    vi.restoreAllMocks();
  });

  it("注册 image_generation 与 image_edit 两个工具(Req 2.1/2.5)", () => {
    const tools = collectAigcTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["image_edit", "image_generation"]);
    for (const t of tools) {
      expect(typeof t.execute).toBe("function");
      expect(t.parameters).toBeDefined();
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it("image_generation execute 成功:落库 + result 形态不变(Req 1.2/1.4/6.3)", async () => {
    installSeam();
    const urls = ["https://dash/g1.png"];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const u = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
        if (urls.some((iu) => u === iu)) {
          return { ok: true, arrayBuffer: async () => new ArrayBuffer(8), headers: { get: () => "image/png" }, status: 200 } as unknown as Response;
        }
        return {
          ok: true,
          text: async () => JSON.stringify({ output: { choices: urls.map((image) => ({ message: { content: [{ image }] } })) } }),
          headers: { get: () => "application/json" },
          status: 200,
        } as unknown as Response;
      }),
    );

    const gen = collectAigcTools().find((t) => t.name === "image_generation")!;
    const result = await gen.execute("c1", { prompt: "雪山", model: "wan2.7-image-pro" }, undefined, undefined, noUI);
    const d = result.details as { ok: boolean; model?: string; assets?: { attachmentId: string }[] };
    expect(d.ok).toBe(true);
    expect(d.model).toBe("wan2.7-image-pro");
    expect(d.assets?.[0]?.attachmentId).toMatch(/^att_/);
    expect(result.content[0]?.text).toContain("![");
  });

  it("image_generation 暴露 gpt-5.4-image-2(OpenRouter)路由并可路由执行", async () => {
    process.env.OPENROUTER_API_KEY = "or-test-key";
    installSeam();
    // gpt-5.4-image-2 走 /api/v1/images(streamKind:images);stub 返回非 SSE 整包 → 走同步回退,
    // 形态为 OpenAI Images `{data:[{b64_json}]}`。
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const u = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
        if (u === "https://openrouter.ai/api/v1/images") {
          return {
            ok: true,
            text: async () => JSON.stringify({ data: [{ b64_json: "AAAA" }] }),
            headers: { get: () => "application/json" },
            status: 200,
          } as unknown as Response;
        }
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8), headers: { get: () => "image/png" }, status: 200 } as unknown as Response;
      }),
    );

    const OPENROUTER_KEYS = [
      "gemini-3.1-flash-image",
      "gemini-3-pro-image",
      "gemini-2.5-flash-image",
      "gpt-5-image",
      "gpt-5-image-mini",
      "gpt-5.4-image-2",
    ];
    const tools = collectAigcTools();
    const gen = tools.find((t) => t.name === "image_generation")!;
    const edit = tools.find((t) => t.name === "image_edit")!;
    // 全部 OpenRouter 路由键出现在两个工具的 description(buildModelsDescription 列出每个 model)。
    for (const k of OPENROUTER_KEYS) {
      expect(gen.description).toContain(k);
      expect(edit.description).toContain(k);
    }
    // 取一个可路由执行的 OpenRouter 模型跑通全链路。
    const result = await gen.execute("c3", { prompt: "a red apple", model: "gpt-5.4-image-2" }, undefined, undefined, noUI);
    const d = result.details as { ok: boolean; model?: string; assets?: { attachmentId: string }[] };
    expect(d.ok).toBe(true);
    expect(d.model).toBe("gpt-5.4-image-2");
    expect(d.assets?.[0]?.attachmentId).toMatch(/^att_/);
    delete process.env.OPENROUTER_API_KEY;
  });

  it("image_edit 主图+mask+参考图>3 → 超限降级(ok:false)", async () => {
    installSeam();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "{}", headers: { get: () => "application/json" }, status: 200 } as unknown as Response)));

    const edit = collectAigcTools().find((t) => t.name === "image_edit")!;
    const result = await edit.execute(
      "c2",
      {
        image: "https://a/main.png",
        mask: "https://a/mask.png",
        reference_images: ["https://a/r1.png", "https://a/r2.png"],
        prompt: "改背景",
        model: "qwen-image-edit-max",
      },
      undefined,
      undefined,
      noUI,
    );
    const d = result.details as { ok: boolean; error?: string };
    expect(d.ok).toBe(false);
    expect(d.error).toMatch(/上限|超过/);
  });
});
