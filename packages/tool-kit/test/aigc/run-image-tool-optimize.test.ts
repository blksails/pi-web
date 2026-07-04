/**
 * run-image-tool 提示词优化开关读取 单元测试(aigc-tool-settings task 2.2 / Req 4.3/4.5/7.2)。
 *
 * mock optimizePrompt 使其对 prompt 追加标记,断言:
 *  - 会话开关为真 → 接缝被调用,派发 provider 的 prompt 含标记;
 *  - 为假/未设 → 接缝不调用,prompt 透传(不含标记)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const optimizeSpy = vi.fn(async (p: string) => `${p}::OPT`);
vi.mock("../../src/aigc/optimize-prompt.js", () => ({
  optimizePrompt: (p: string) => optimizeSpy(p),
}));

import { runImageTool } from "../../src/aigc/run-image-tool.js";
import { createDashscopeSyncT2I } from "../../src/aigc/providers/dashscope.js";
import type { ImageRoute, InteractionParam } from "../../src/aigc/types.js";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SessionStateAccess } from "../../src/session-state.js";

function makeMockCtx(): AttachmentToolContext {
  let n = 0;
  return {
    available: true,
    resolve: vi.fn(async () => ({
      bytes: async () => new Uint8Array([1, 2, 3, 4]),
      meta: { mimeType: "image/png" },
    })),
    putOutput: vi.fn(async (o: { name: string; mimeType: string }) => ({
      attachmentId: `att_img${++n}`,
      displayUrl: `http://localhost/att/${n}`,
      mimeType: o.mimeType ?? "image/png",
      name: o.name,
    })),
  } as unknown as AttachmentToolContext;
}

/** 捕获 POST body 的 dashscope sync fetch(返回一张图)。 */
function makeCapturingFetch(bodies: string[]) {
  return vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    if (init?.body !== undefined) bodies.push(String(init.body));
    const choices = [{ message: { content: [{ image: "https://dash/a.png" }] } }];
    return {
      ok: true,
      text: async () => JSON.stringify({ output: { choices } }),
      arrayBuffer: async () => new ArrayBuffer(8),
      headers: { get: (): string => "application/json" },
      status: 200,
    };
  }) as unknown as typeof fetch;
}

function fakeState(flag: boolean | undefined): SessionStateAccess {
  return {
    available: true,
    get: <T>(k: string): T | undefined =>
      (k === "aigc.enablePromptOptimization" ? (flag as unknown as T) : undefined),
    set: () => {},
    delete: () => {},
    snapshot: () => ({}),
  };
}

const route = (): ImageRoute =>
  createDashscopeSyncT2I({
    model: "wan2.7-image-pro",
    label: "Wan 2.7",
    description: "test",
    providerModel: "wan2.7-image-pro",
  });

const OPTS = {
  toolName: "image_generation",
  routes: [route()],
  defaultModel: "wan2.7-image-pro",
  requiredParams: [] as readonly InteractionParam[],
  mediaFields: [] as readonly string[],
};
const noUI = { hasUI: false } as unknown as ExtensionContext;

describe("run-image-tool 提示词优化开关", () => {
  beforeEach(() => {
    process.env.DASHSCOPE_API_KEY = "test-key";
    optimizeSpy.mockClear();
  });
  afterEach(() => {
    delete process.env.DASHSCOPE_API_KEY;
    vi.restoreAllMocks();
  });

  it("开关为真 → 调用优化接缝,派发 provider 的 prompt 含标记", async () => {
    const bodies: string[] = [];
    await runImageTool({ prompt: "雪山", model: "wan2.7-image-pro" }, noUI, undefined, undefined, {
      ...OPTS,
      deps: { getCtx: () => makeMockCtx(), fetchImpl: makeCapturingFetch(bodies), getState: () => fakeState(true) },
    });
    expect(optimizeSpy).toHaveBeenCalledWith("雪山");
    expect(bodies.join("")).toContain("雪山::OPT");
  });

  it("开关为假 → 不调用接缝,prompt 透传(不含标记)", async () => {
    const bodies: string[] = [];
    await runImageTool({ prompt: "雪山", model: "wan2.7-image-pro" }, noUI, undefined, undefined, {
      ...OPTS,
      deps: { getCtx: () => makeMockCtx(), fetchImpl: makeCapturingFetch(bodies), getState: () => fakeState(false) },
    });
    expect(optimizeSpy).not.toHaveBeenCalled();
    expect(bodies.join("")).toContain("雪山");
    expect(bodies.join("")).not.toContain("::OPT");
  });
});
