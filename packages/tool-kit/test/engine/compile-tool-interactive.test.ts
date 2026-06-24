/**
 * compile-tool 必选项交互补全测试(aigc-tools-interactive-params)。
 *
 * 覆盖:
 *  - 缺 model/size → ctx.ui.select;缺 prompt → ctx.ui.input(R2/R3/R4)
 *  - 用户取消(undefined)→ ok:false 且 provider/putOutput 未被调用(R5)
 *  - hasUI=false 降级:model→defaultModel、size→fallback、prompt→ok:false(R6)
 *  - 必选项已传 → ctx.ui 完全不被调用(R7)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { compileTool } from "../../src/engine/compile-tool.js";
import type { ToolSpec, PickedResult, ModelRoute } from "../../src/engine/types.js";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// ── 捕获 buildBody 收到的参数(验证补全值流入)──────────────────────────────────
let capturedArgs: Record<string, unknown> | undefined;

function mkModel(model: string): ModelRoute {
  return {
    model,
    label: model,
    url: "https://example.com/multimodal-generation",
    headers: { authorization: "Bearer ${TEST_KEY}" },
    requiredVars: ["TEST_KEY"],
    buildBody: (args) => {
      capturedArgs = args;
      return { prompt: (args as { prompt?: string }).prompt };
    },
    pickResult: () =>
      ({ kind: "image", url: "https://example.com/img.png" } as PickedResult),
  };
}

function makeInteractiveTool(): ToolSpec {
  capturedArgs = undefined;
  return {
    name: "interactive_tool",
    description: "test",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "p" },
        size: { type: "string", description: "s" },
      },
      required: [],
    },
    defaultModel: "model-a",
    models: [mkModel("model-a"), mkModel("model-b")],
    requiredParams: [
      { param: "model", via: "select", title: "选模型", options: ["$models"] },
      {
        param: "size",
        via: "select",
        title: "选尺寸",
        options: ["1024x1024", "auto"],
        fallback: "auto",
      },
      {
        param: "prompt",
        via: "input",
        title: "输入描述",
        placeholder: "用你的语言",
      },
    ],
  };
}

// ── Mock attachment ctx ────────────────────────────────────────────────────────
function makeMockCtx(): AttachmentToolContext {
  return {
    available: true,
    resolve: async () => {
      throw new Error("not needed");
    },
    putOutput: vi.fn().mockResolvedValue({
      attachmentId: "att_x",
      displayUrl: "http://localhost/att/x",
      mimeType: "image/png",
      name: "interactive_tool-0.png",
    }),
  };
}

// ── Mock provider fetch ────────────────────────────────────────────────────────
function makeImageFetch() {
  return vi.fn().mockImplementation(async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
    if (u.includes("multimodal-generation")) {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            output: { choices: [{ message: { content: [{ image: "https://example.com/img.png" }] } }] },
          }),
        headers: { get: () => "application/json" },
        status: 200,
      };
    }
    return {
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
      headers: { get: () => "image/png" },
      status: 200,
    };
  });
}

// ── Mock ExtensionContext(仅 hasUI + ui.select/input)─────────────────────────
function makeExtCtx(
  hasUI: boolean,
  ui?: { select?: (...a: unknown[]) => Promise<string | undefined>; input?: (...a: unknown[]) => Promise<string | undefined> },
): ExtensionContext {
  return {
    hasUI,
    mode: hasUI ? "rpc" : "print",
    ui: {
      select: ui?.select ?? vi.fn(async () => undefined),
      input: ui?.input ?? vi.fn(async () => undefined),
      confirm: vi.fn(async () => true),
      notify: vi.fn(),
    },
  } as unknown as ExtensionContext;
}

// ── 辅助:运行工具 ──────────────────────────────────────────────────────────────
async function run(
  tool: ToolSpec,
  params: Record<string, unknown>,
  ext: ExtensionContext,
) {
  const ctx = makeMockCtx();
  const fetchImpl = makeImageFetch();
  const compiled = compileTool(tool, { getCtx: () => ctx, fetchImpl });
  const result = await compiled.execute(
    "call",
    params,
    undefined,
    undefined,
    ext as never,
  );
  return { result, ctx, fetchImpl };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("compileTool 必选项交互补全", () => {
  beforeEach(() => {
    process.env.TEST_KEY = "test-secret";
  });
  afterEach(() => {
    delete process.env.TEST_KEY;
    vi.restoreAllMocks();
  });

  it("缺 model + hasUI → select(models) 并以所选路由(R2)", async () => {
    const selectSpy = vi.fn(async () => "model-b");
    const ext = makeExtCtx(true, { select: selectSpy });
    const { result } = await run(
      makeInteractiveTool(),
      { prompt: "p", size: "1024x1024" },
      ext,
    );
    expect(selectSpy).toHaveBeenCalledWith("选模型", ["model-a", "model-b"]);
    const d = result.details as { ok: true; model: string };
    expect(d.ok).toBe(true);
    expect(d.model).toBe("model-b");
  });

  it("缺 size + hasUI → select(预设) 并以所选执行(R3)", async () => {
    const selectSpy = vi.fn(async () => "auto");
    const ext = makeExtCtx(true, { select: selectSpy });
    const { result } = await run(
      makeInteractiveTool(),
      { prompt: "p", model: "model-a" },
      ext,
    );
    expect(selectSpy).toHaveBeenCalledWith("选尺寸", ["1024x1024", "auto"]);
    expect((result.details as { ok: boolean }).ok).toBe(true);
    expect(capturedArgs?.size).toBe("auto");
  });

  it("缺 prompt + hasUI → input,补全值传入 buildBody(R4)", async () => {
    const inputSpy = vi.fn(async () => "一只水墨熊猫");
    const ext = makeExtCtx(true, { input: inputSpy });
    await run(
      makeInteractiveTool(),
      { model: "model-a", size: "1024x1024" },
      ext,
    );
    expect(inputSpy).toHaveBeenCalled();
    expect(capturedArgs?.prompt).toBe("一只水墨熊猫");
  });

  it("select 取消(undefined) → ok:false 且 provider/putOutput 未被调用(R5)", async () => {
    const ext = makeExtCtx(true, { select: vi.fn(async () => undefined) });
    const { result, ctx, fetchImpl } = await run(
      makeInteractiveTool(),
      { prompt: "p", size: "1024x1024" }, // 缺 model → select → 取消
      ext,
    );
    const d = result.details as { ok: boolean; error?: string };
    expect(d.ok).toBe(false);
    expect(d.error).toContain("取消");
    expect(ctx.putOutput).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("hasUI=false 降级:缺 model→default、缺 size→fallback(R6)", async () => {
    const ext = makeExtCtx(false);
    const { result } = await run(makeInteractiveTool(), { prompt: "p" }, ext);
    const d = result.details as { ok: true; model: string };
    expect(d.ok).toBe(true);
    expect(d.model).toBe("model-a");
    expect(capturedArgs?.size).toBe("auto");
  });

  it("hasUI=false 缺 prompt(无 fallback) → ok:false(R6)", async () => {
    const ext = makeExtCtx(false);
    const { result } = await run(
      makeInteractiveTool(),
      { model: "model-a", size: "1024x1024" },
      ext,
    );
    const d = result.details as { ok: boolean; error?: string };
    expect(d.ok).toBe(false);
    expect(d.error).toContain("prompt");
  });

  it("全部必选项已传 → ctx.ui 完全不被调用(R7)", async () => {
    const selectSpy = vi.fn(async () => "x");
    const inputSpy = vi.fn(async () => "x");
    const ext = makeExtCtx(true, { select: selectSpy, input: inputSpy });
    const { result } = await run(
      makeInteractiveTool(),
      { prompt: "p", model: "model-a", size: "1024x1024" },
      ext,
    );
    expect(selectSpy).not.toHaveBeenCalled();
    expect(inputSpy).not.toHaveBeenCalled();
    expect((result.details as { ok: boolean }).ok).toBe(true);
  });
});
