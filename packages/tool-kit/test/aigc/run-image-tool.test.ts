/**
 * runImageTool 单元测试(detoolspec-unify-builtin-tools task 4.1)。
 *
 * 覆盖:必选项补全(select/input)、取消、fallback、$models 展开、model 路由、
 * requiredVars/attachment/零产物降级、媒体字段解析(att_→dataURI)、async 轮询(Req 4.2)、
 * 成功 result 的 content/details 形态(Req 1.4)。注入式 deps(getCtx/fetchImpl)隔离外部依赖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runImageTool,
  optionalModelEnum,
  buildModelsDescription,
  promptToNamePrefix,
} from "../../src/aigc/run-image-tool.js";
import {
  createDashscopeSyncT2I,
  createDashscopeImageEdit,
  createDashscopeAsyncT2I,
} from "../../src/aigc/providers/dashscope.js";
import { createNewApiImage } from "../../src/aigc/providers/newapi.js";
import type { ImageRoute, InteractionParam } from "../../src/aigc/types.js";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// ── mocks ──────────────────────────────────────────────────────────────────────

function makeMockCtx(overrides: Partial<AttachmentToolContext> = {}): AttachmentToolContext {
  let n = 0;
  return {
    available: true,
    resolve: vi.fn(async (_id: string) => ({
      bytes: async () => new Uint8Array([1, 2, 3, 4]),
      meta: { mimeType: "image/png" },
    })),
    putOutput: vi.fn(async (o: { name: string; mimeType: string }) => {
      const id = `att_img${++n}`;
      return {
        attachmentId: id,
        displayUrl: `http://localhost/att/${id}`,
        mimeType: o.mimeType ?? "image/png",
        name: o.name,
      };
    }),
    ...overrides,
  } as unknown as AttachmentToolContext;
}

/** DashScope sync 响应 + 产物下载 mock。 */
function makeSyncFetch(imageUrls: string[]) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
    if (imageUrls.some((iu) => u === iu)) {
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
        headers: { get: (): string => "image/png" },
        status: 200,
      };
    }
    const choices = imageUrls.map((image) => ({ message: { content: [{ image }] } }));
    return {
      ok: true,
      text: async () => JSON.stringify({ output: { choices } }),
      headers: { get: (): string => "application/json" },
      status: 200,
    };
  }) as unknown as typeof fetch;
}

/** 返回零图(raw)的 provider mock —— 触发零产物降级。 */
function makeEmptyFetch() {
  return vi.fn(async () => ({
    ok: true,
    text: async () => JSON.stringify({ output: { choices: [] } }),
    headers: { get: (): string => "application/json" },
    status: 200,
  })) as unknown as typeof fetch;
}

function makeExtNoUI(): ExtensionContext {
  return { hasUI: false } as unknown as ExtensionContext;
}

function makeExtWithUI(
  select: (title: string, options: string[]) => Promise<string | undefined>,
  input: (title: string, placeholder?: string) => Promise<string | undefined>,
) {
  const ui = { select: vi.fn(select), input: vi.fn(input) };
  return { ctx: { hasUI: true, ui } as unknown as ExtensionContext, ui };
}

const dashRoute = (): ImageRoute =>
  createDashscopeSyncT2I({
    model: "wan2.7-image-pro",
    label: "Wan 2.7",
    description: "test",
    providerModel: "wan2.7-image-pro",
  });

const SYNC_OPTS = {
  toolName: "image_generation",
  routes: [dashRoute()],
  defaultModel: "wan2.7-image-pro",
  requiredParams: [] as readonly InteractionParam[],
  mediaFields: [] as readonly string[],
};

describe("runImageTool", () => {
  beforeEach(() => {
    process.env.DASHSCOPE_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.NEWAPI_API_KEY;
    vi.restoreAllMocks();
  });

  it("成功路径:prompt → 2 图 → 落库,result 形态 ok + assets + markdown content", async () => {
    const urls = ["https://dash/img1.png", "https://dash/img2.png"];
    const ctx = makeMockCtx();
    const result = await runImageTool(
      { prompt: "雪山", model: "wan2.7-image-pro" },
      makeExtNoUI(),
      undefined,
      undefined,
      { ...SYNC_OPTS, deps: { getCtx: () => ctx, fetchImpl: makeSyncFetch(urls) } },
    );
    const d = result.details as { ok: boolean; model?: string; assets?: { attachmentId: string }[] };
    expect(d.ok).toBe(true);
    expect(d.model).toBe("wan2.7-image-pro");
    expect(d.assets?.length).toBe(2);
    expect(d.assets?.[0]?.attachmentId).toMatch(/^att_/);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("生成成功");
    expect(text).toContain("![");
  });

  it("model 省略 → 回退 defaultModel", async () => {
    const ctx = makeMockCtx();
    const result = await runImageTool(
      { prompt: "x" },
      makeExtNoUI(),
      undefined,
      undefined,
      { ...SYNC_OPTS, deps: { getCtx: () => ctx, fetchImpl: makeSyncFetch(["https://dash/a.png"]) } },
    );
    expect((result.details as { ok: boolean; model?: string }).model).toBe("wan2.7-image-pro");
  });

  it("requiredVars 缺失 → ok:false 降级", async () => {
    // NewAPI route 需 NEWAPI_API_KEY(未设)。
    const ctx = makeMockCtx();
    const result = await runImageTool(
      { prompt: "x", model: "gpt-image-2" },
      makeExtNoUI(),
      undefined,
      undefined,
      {
        toolName: "image_generation",
        routes: [createNewApiImage({ model: "gpt-image-2", label: "g", description: "d" })],
        defaultModel: "gpt-image-2",
        requiredParams: [],
        mediaFields: [],
        deps: { getCtx: () => ctx, fetchImpl: makeSyncFetch([]) },
      },
    );
    const d = result.details as { ok: boolean; error?: string };
    expect(d.ok).toBe(false);
    expect(d.error).toContain("缺少环境变量");
  });

  it("attachment ctx 不可用 → ok:false 降级", async () => {
    const result = await runImageTool(
      { prompt: "x", model: "wan2.7-image-pro" },
      makeExtNoUI(),
      undefined,
      undefined,
      { ...SYNC_OPTS, deps: { getCtx: () => ({ available: false } as AttachmentToolContext), fetchImpl: makeSyncFetch([]) } },
    );
    const d = result.details as { ok: boolean; error?: string };
    expect(d.ok).toBe(false);
    expect(d.error).toContain("attachment");
  });

  it("零产物 → ok:false(非误导成功)", async () => {
    const ctx = makeMockCtx();
    const result = await runImageTool(
      { prompt: "x", model: "wan2.7-image-pro" },
      makeExtNoUI(),
      undefined,
      undefined,
      { ...SYNC_OPTS, deps: { getCtx: () => ctx, fetchImpl: makeEmptyFetch() } },
    );
    const d = result.details as { ok: boolean; error?: string };
    expect(d.ok).toBe(false);
    expect(d.error).toContain("有效图像产物");
  });

  it("必选项补全:有 UI 时经 ui.select/input 补全,$models 展开为 routes 的 model", async () => {
    const ctx = makeMockCtx();
    const { ctx: ext, ui } = makeExtWithUI(
      async () => "wan2.7-image-pro",
      async () => "补全的提示词",
    );
    const reqParams: InteractionParam[] = [
      { param: "model", via: "select", title: "选择模型", options: ["$models"] },
      { param: "prompt", via: "input", title: "输入描述" },
    ];
    const result = await runImageTool(
      {},
      ext,
      undefined,
      undefined,
      { ...SYNC_OPTS, requiredParams: reqParams, deps: { getCtx: () => ctx, fetchImpl: makeSyncFetch(["https://dash/a.png"]) } },
    );
    expect((result.details as { ok: boolean }).ok).toBe(true);
    // $models 展开:select 第二参含 route model
    const selectArg = ui.select.mock.calls[0]?.[1] as string[];
    expect(selectArg).toContain("wan2.7-image-pro");
    expect(ui.input).toHaveBeenCalled();
  });

  it("用户取消补全 → ok:false,不发起 provider 调用", async () => {
    const ctx = makeMockCtx();
    const fetchImpl = makeSyncFetch(["https://dash/a.png"]);
    const { ctx: ext } = makeExtWithUI(
      async () => undefined, // 取消 select
      async () => undefined,
    );
    const result = await runImageTool(
      {},
      ext,
      undefined,
      undefined,
      {
        ...SYNC_OPTS,
        requiredParams: [{ param: "model", via: "select", title: "选择模型", options: ["$models"] }],
        deps: { getCtx: () => ctx, fetchImpl },
      },
    );
    expect((result.details as { ok: boolean; error?: string }).ok).toBe(false);
    expect((result.details as { error: string }).error).toContain("已取消");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("无 UI:size 用 fallback、model 回退默认时正常出图;prompt 无兜底则 ok:false", async () => {
    const ctx = makeMockCtx();
    // size 有 fallback、prompt 提供 → 成功
    const ok = await runImageTool(
      { prompt: "x" },
      makeExtNoUI(),
      undefined,
      undefined,
      {
        ...SYNC_OPTS,
        requiredParams: [
          { param: "model", via: "select", title: "m", options: ["$models"] },
          { param: "size", via: "select", title: "s", options: ["1024x1024"], fallback: "auto" },
        ],
        deps: { getCtx: () => ctx, fetchImpl: makeSyncFetch(["https://dash/a.png"]) },
      },
    );
    expect((ok.details as { ok: boolean }).ok).toBe(true);
    // prompt 必选无兜底、无 UI、无值 → ok:false
    const fail = await runImageTool(
      {},
      makeExtNoUI(),
      undefined,
      undefined,
      {
        ...SYNC_OPTS,
        requiredParams: [{ param: "prompt", via: "input", title: "p" }],
        deps: { getCtx: () => ctx, fetchImpl: makeSyncFetch([]) },
      },
    );
    const d = fail.details as { ok: boolean; error?: string };
    expect(d.ok).toBe(false);
    expect(d.error).toContain("prompt");
  });

  it("媒体字段解析:image_edit 的 att_ 引用 → ctx.resolve 解析为 data URI", async () => {
    const ctx = makeMockCtx();
    const result = await runImageTool(
      { image: "att_input1", prompt: "改背景", model: "qwen-image-edit-max" },
      makeExtNoUI(),
      undefined,
      undefined,
      {
        toolName: "image_edit",
        routes: [
          createDashscopeImageEdit({
            model: "qwen-image-edit-max",
            label: "edit",
            description: "d",
            providerModel: "qwen-image-edit-max",
          }),
        ],
        defaultModel: "qwen-image-edit-max",
        requiredParams: [],
        mediaFields: ["image", "mask", "reference_images"],
        deps: { getCtx: () => ctx, fetchImpl: makeSyncFetch(["https://dash/edited.png"]) },
      },
    );
    expect((result.details as { ok: boolean }).ok).toBe(true);
    expect(ctx.resolve).toHaveBeenCalledWith("att_input1");
  });

  it("async 轮询路由(Req 4.2):提交 task_id → SUCCEEDED → 落库 ok", async () => {
    const ctx = makeMockCtx();
    const imageUrls = ["https://dash/wanx.png"];
    let submitted = false;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
      if (imageUrls.some((iu) => u === iu)) {
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8), headers: { get: (): string => "image/png" }, status: 200 };
      }
      if (u.includes("text2image") && !submitted) {
        submitted = true;
        return { ok: true, text: async () => JSON.stringify({ output: { task_id: "t1" } }), headers: { get: (): string => "application/json" }, status: 200 };
      }
      if (u.includes("/tasks/")) {
        return {
          ok: true,
          text: async () => JSON.stringify({ output: { task_status: "SUCCEEDED", results: imageUrls.map((url) => ({ url })) } }),
          headers: { get: (): string => "application/json" },
          status: 200,
        };
      }
      throw new Error(`unexpected url ${u}`);
    }) as unknown as typeof fetch;

    const base = createDashscopeAsyncT2I({ model: "wanx-async", label: "a", description: "d", providerModel: "wanx2.0-t2i-turbo" });
    const fastRoute: ImageRoute = { ...base, async: { ...base.async!, pollMs: 20, timeoutMs: 5000 } };
    const result = await runImageTool(
      { prompt: "雪山", model: "wanx-async" },
      makeExtNoUI(),
      undefined,
      undefined,
      { toolName: "image_generation", routes: [fastRoute], defaultModel: "wanx-async", requiredParams: [], mediaFields: [], deps: { getCtx: () => ctx, fetchImpl } },
    );
    expect((result.details as { ok: boolean; model?: string }).ok).toBe(true);
    expect((result.details as { model: string }).model).toBe("wanx-async");
  }, 15_000);

  it("乐观预览:onUpdate 在 persist 前发预览帧(远程 URL)", async () => {
    const ctx = makeMockCtx();
    const updates: unknown[] = [];
    await runImageTool(
      { prompt: "x", model: "wan2.7-image-pro" },
      makeExtNoUI(),
      undefined,
      (p) => updates.push(p),
      { ...SYNC_OPTS, deps: { getCtx: () => ctx, fetchImpl: makeSyncFetch(["https://dash/a.png"]) } },
    );
    expect(updates.length).toBeGreaterThan(0);
  });

  it("optionalModelEnum / buildModelsDescription 产出可用", () => {
    const routes = [dashRoute()];
    const schema = optionalModelEnum(routes, "wan2.7-image-pro");
    expect(schema).toBeDefined();
    const desc = buildModelsDescription("base", routes, "wan2.7-image-pro");
    expect(desc).toContain("wan2.7-image-pro");
    expect(desc).toContain("(default)");
  });
});

describe("promptToNamePrefix(附件名可区分)", () => {
  it("正常 prompt → 文件名安全摘要(空格折叠为 -)", () => {
    expect(promptToNamePrefix("赛博朋克2077风格的游戏画面", "image_generation")).toBe(
      "赛博朋克2077风格的游戏画面",
    );
    expect(promptToNamePrefix("a red apple on table", "img")).toBe("a-red-apple-on-table");
  });

  it("截断到 24 码点(中文按码点,不切半个字)", () => {
    const long = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十";
    const out = promptToNamePrefix(long, "img");
    expect([...out].length).toBe(24);
    expect(out).toBe("一二三四五六七八九十一二三四五六七八九十一二三四");
  });

  it("清洗文件名非法字符(/ \\ : * ? \" < > | . 及控制符)", () => {
    expect(promptToNamePrefix('a/b:c*d?"e<f>g|h.i', "img")).toBe("a-b-c-d-e-f-g-h-i");
    expect(promptToNamePrefix("line1\nline2\ttab", "img")).toBe("line1-line2-tab");
  });

  it("空 / 纯空白 / 纯非法字符 / 非字符串 → 回退 fallback", () => {
    expect(promptToNamePrefix("", "image_generation")).toBe("image_generation");
    expect(promptToNamePrefix("   ", "img")).toBe("img");
    expect(promptToNamePrefix("///...", "img")).toBe("img");
    expect(promptToNamePrefix(undefined, "img")).toBe("img");
    expect(promptToNamePrefix(123, "img")).toBe("img");
  });
});
