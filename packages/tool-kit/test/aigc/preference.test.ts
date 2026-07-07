/**
 * aigc-prompt-toolbar · 偏好级单元测试(tasks 2.3)。
 *
 * 覆盖:偏好采用(model/size,跳过追问)/ 显式参数覆盖偏好 / seam 降级行为不变 /
 * 追问选择写回(白名单)/ 白名单外不写回 / 装配期清单下发(gen∪edit 并集 + 四档尺寸)。
 * 全程注入式 deps(getCtx/fetchImpl/getState)隔离外部依赖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runImageTool } from "../../src/aigc/run-image-tool.js";
import { createDashscopeSyncT2I } from "../../src/aigc/providers/dashscope.js";
import type { ImageRoute, InteractionParam } from "../../src/aigc/types.js";
import type { SessionStateAccess } from "../../src/session-state.js";
import { SESSION_STATE_SEAM_KEY } from "../../src/session-state.js";
import { aigcExtension, SIZE_OPTIONS } from "../../src/aigc/extension.js";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// ── fixtures(与 run-image-tool.test.ts 同款精简版)────────────────────────────

function makeMockCtx(): AttachmentToolContext {
  let n = 0;
  return {
    available: true,
    resolve: vi.fn(async () => ({
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
  } as unknown as AttachmentToolContext;
}

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

function makeExtWithUI(
  select: (title: string, options: string[]) => Promise<string | undefined>,
  input: (title: string, placeholder?: string) => Promise<string | undefined>,
) {
  const ui = { select: vi.fn(select), input: vi.fn(input) };
  return { ctx: { hasUI: true, ui } as unknown as ExtensionContext, ui };
}

/** fake 会话状态:内存 Map + set 调用记录。 */
function makeFakeState(init: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(init));
  const sets: Array<[string, unknown]> = [];
  const state: SessionStateAccess = {
    available: true,
    get: <T = unknown>(k: string) => store.get(k) as T | undefined,
    set: (k: string, v: unknown) => {
      store.set(k, v);
      sets.push([k, v]);
    },
    delete: (k: string) => {
      store.delete(k);
    },
    snapshot: () => Object.fromEntries(store),
  };
  return { state, sets };
}

const UNAVAILABLE_STATE: SessionStateAccess = {
  available: false,
  get: () => undefined,
  set: () => {},
  delete: () => {},
  snapshot: () => ({}),
};

const ROUTE_MODEL = "wan2.7-image-pro";
const dashRoute = (): ImageRoute =>
  createDashscopeSyncT2I({
    model: ROUTE_MODEL,
    label: "Wan 2.7",
    description: "test",
    providerModel: ROUTE_MODEL,
  });

const MODEL_PARAM: InteractionParam = {
  param: "model",
  via: "select",
  title: "选择模型",
  options: ["$models"],
};
const SIZE_PARAM: InteractionParam = {
  param: "size",
  via: "select",
  title: "选择尺寸",
  options: ["1024x1024", "1536x1024", "1024x1536", "auto"],
};

function makeOpts(
  state: SessionStateAccess,
  requiredParams: readonly InteractionParam[],
) {
  return {
    toolName: "image_generation",
    routes: [dashRoute()],
    defaultModel: ROUTE_MODEL,
    requiredParams,
    mediaFields: [] as readonly string[],
    deps: {
      getCtx: () => makeMockCtx(),
      fetchImpl: makeSyncFetch(["https://dash/a.png"]),
      getState: () => state,
    },
  };
}

describe("aigc-prompt-toolbar 偏好级", () => {
  beforeEach(() => {
    process.env.DASHSCOPE_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.DASHSCOPE_API_KEY;
    vi.restoreAllMocks();
  });

  it("KV 有 model 偏好且 args 未指定 → 采用偏好且不追问(Req 4.1/4.5)", async () => {
    const { state } = makeFakeState({ "aigc.model": ROUTE_MODEL });
    const { ctx: ext, ui } = makeExtWithUI(async () => "不该被调", async () => "不该被调");
    const result = await runImageTool(
      { prompt: "雪山" },
      ext,
      undefined,
      undefined,
      makeOpts(state, [MODEL_PARAM]),
    );
    expect((result.details as { ok: boolean; model?: string }).model).toBe(ROUTE_MODEL);
    expect((result.details as { ok: boolean }).ok).toBe(true);
    expect(ui.select).not.toHaveBeenCalled();
  });

  it("args 显式指定 model → 忽略偏好(Req 4.2)", async () => {
    const { state } = makeFakeState({ "aigc.model": "some-other-model" });
    const result = await runImageTool(
      { prompt: "x", model: ROUTE_MODEL },
      { hasUI: false } as unknown as ExtensionContext,
      undefined,
      undefined,
      makeOpts(state, []),
    );
    expect((result.details as { model?: string }).model).toBe(ROUTE_MODEL);
  });

  it("KV 有 size 偏好 → 采用且不追问 size(Req 4.3/4.5)", async () => {
    const { state } = makeFakeState({ "aigc.size": "1024x1024" });
    const { ctx: ext, ui } = makeExtWithUI(async () => "不该被调", async () => "不该被调");
    const result = await runImageTool(
      { prompt: "x", model: ROUTE_MODEL },
      ext,
      undefined,
      undefined,
      makeOpts(state, [SIZE_PARAM]),
    );
    expect((result.details as { ok: boolean }).ok).toBe(true);
    expect(ui.select).not.toHaveBeenCalled();
  });

  it("args 显式指定 size → 忽略 size 偏好且不追问(Req 4.4)", async () => {
    const { state } = makeFakeState({ "aigc.size": "1024x1536" });
    const { ctx: ext, ui } = makeExtWithUI(async () => "不该被调", async () => "不该被调");
    const fetchImpl = makeSyncFetch(["https://dash/a.png"]);
    const opts = makeOpts(state, [SIZE_PARAM]);
    const result = await runImageTool(
      { prompt: "x", model: ROUTE_MODEL, size: "1536x1024" },
      ext,
      undefined,
      undefined,
      { ...opts, deps: { ...opts.deps, fetchImpl } },
    );
    expect((result.details as { ok: boolean }).ok).toBe(true);
    expect(ui.select).not.toHaveBeenCalled();
    // 发往 provider 的请求体用显式 size(非偏好值)。DashScope buildBody 把 "宽x高"
    // 归一为 "宽*高"(memory: size 用 width*height),故按两种形态放宽匹配。
    const bodies = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => (c[1] as { body?: string } | undefined)?.body)
      .filter((b): b is string => typeof b === "string");
    const has = (s: string): boolean =>
      bodies.some((b) => b.includes(s) || b.includes(s.replace("x", "*")));
    expect(has("1536x1024")).toBe(true);
    expect(has("1024x1536")).toBe(false);
  });

  it("seam 不可用 → 行为与引入前完全一致(默认模型 / 照常追问)(Req 4.6)", async () => {
    // 无 UI:回退 defaultModel。
    const noUi = await runImageTool(
      { prompt: "x" },
      { hasUI: false } as unknown as ExtensionContext,
      undefined,
      undefined,
      makeOpts(UNAVAILABLE_STATE, [MODEL_PARAM]),
    );
    expect((noUi.details as { ok: boolean; model?: string }).model).toBe(ROUTE_MODEL);
    // 有 UI:照常追问(select 被调一次)。
    const { ctx: ext, ui } = makeExtWithUI(async () => ROUTE_MODEL, async () => "p");
    await runImageTool(
      { prompt: "x" },
      ext,
      undefined,
      undefined,
      makeOpts(UNAVAILABLE_STATE, [MODEL_PARAM]),
    );
    expect(ui.select).toHaveBeenCalledTimes(1);
  });

  it("追问选择 model → 写回会话偏好(Req 5.1)", async () => {
    const { state, sets } = makeFakeState();
    const { ctx: ext } = makeExtWithUI(async () => ROUTE_MODEL, async () => "p");
    await runImageTool(
      { prompt: "x" },
      ext,
      undefined,
      undefined,
      makeOpts(state, [MODEL_PARAM]),
    );
    expect(sets).toContainEqual(["aigc.model", ROUTE_MODEL]);
  });

  it("白名单外参数(prompt)追问后不写回偏好", async () => {
    const { state, sets } = makeFakeState();
    const { ctx: ext } = makeExtWithUI(
      async () => ROUTE_MODEL,
      async () => "一段一次性描述",
    );
    await runImageTool(
      {},
      ext,
      undefined,
      undefined,
      makeOpts(state, [MODEL_PARAM, { param: "prompt", via: "input", title: "描述" }]),
    );
    expect(sets.some(([k]) => k === "aigc.prompt")).toBe(false);
    expect(sets).toContainEqual(["aigc.model", ROUTE_MODEL]);
  });

  it("装配期清单下发:aigc.models = gen∪edit 并集,aigc.sizes 四档(Req 2.2/3.1)", () => {
    const { state, sets } = makeFakeState();
    const g = globalThis as Record<string, unknown>;
    g[SESSION_STATE_SEAM_KEY] = state;
    try {
      const fakePi = { registerTool: vi.fn() } as unknown as ExtensionAPI;
      aigcExtension(fakePi);
      const models = sets.find(([k]) => k === "aigc.models")?.[1] as string[];
      const sizes = sets.find(([k]) => k === "aigc.sizes")?.[1] as string[];
      expect(models).toContain("gpt-image-2"); // gen 侧
      expect(models).toContain("qwen-image-edit-max"); // edit 侧
      expect(new Set(models).size).toBe(models.length); // 去重(并集)
      expect(sizes).toEqual([...SIZE_OPTIONS]);
    } finally {
      delete g[SESSION_STATE_SEAM_KEY];
    }
  });

  it("清单下发·装配时序:factory 执行时 seam 未挂(真实 runner 顺序)→ 重试后仍下发", () => {
    vi.useFakeTimers();
    const { state, sets } = makeFakeState();
    const g = globalThis as Record<string, unknown>;
    try {
      // 复刻真实 runner:extensions 装配(factory 执行)早于 wireStateBridge 挂 seam。
      const fakePi = { registerTool: vi.fn() } as unknown as ExtensionAPI;
      aigcExtension(fakePi); // 此刻 seam 缺失 → 首次 set 必 no-op
      expect(sets.some(([k]) => k === "aigc.models")).toBe(false);
      // 随后 wireStateBridge 挂上 seam(下一宏任务前)。
      g[SESSION_STATE_SEAM_KEY] = state;
      vi.advanceTimersByTime(200); // 越过退避重试
      const models = sets.find(([k]) => k === "aigc.models")?.[1] as string[];
      expect(models).toContain("gpt-image-2");
      expect(sets.some(([k]) => k === "aigc.sizes")).toBe(true);
    } finally {
      delete g[SESSION_STATE_SEAM_KEY];
      vi.useRealTimers();
    }
  });
});
