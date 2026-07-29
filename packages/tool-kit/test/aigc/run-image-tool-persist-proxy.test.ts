/**
 * 产出图落盘下载的出网路径(2026-07-29 真机暴露的缺口)。
 *
 * ★ 背景:多数 provider 的 `pickResult` 返回远程 URL(CDN / R2 预签名),`persistPicked` 要
 * **二次下载**整张图。该下载此前恒用裸 `globalThis.fetch`,不理会 `route.proxy` —— 于是出现
 * 「provider 请求成功(网关后台留有 HTTP 200 记录)、工具却报 `fetch failed`」的割裂:失败发生
 * 在取图这一跳,极易被误判成响应格式不匹配。
 *
 * 本套件钉死:落盘下载与 provider 请求走**同一条**出网路径。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const proxyFetchSpy = vi.fn(
  async (_u: string | URL, _i?: RequestInit) =>
    new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } }),
);

vi.mock("../../src/engine/proxy-fetch.js", () => ({
  proxyFetch: (u: string | URL, i?: RequestInit, p?: string) => {
    proxyFetchSpy(u, i);
    (proxyFetchSpy as unknown as { lastProxy?: string }).lastProxy = p;
    return proxyFetchSpy(u, i);
  },
}));

const { runImageTool } = await import("../../src/aigc/run-image-tool.js");
import type { ImageRoute, InteractionParam } from "../../src/aigc/types.js";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";

/** 返回远程 URL 的路由(与 CF/openrouter 等同形态),声明可选代理占位符。 */
function urlRoute(proxy?: string): ImageRoute {
  return {
    model: "m1",
    label: "M1",
    url: "https://api.example.com/run",
    headers: { authorization: "Bearer ${TEST_KEY}" },
    ...(proxy !== undefined ? { proxy } : {}),
    requiredVars: ["TEST_KEY"],
    buildBody: () => ({ prompt: "x" }),
    pickResult: () => ({ kind: "image", url: "https://cdn.example.com/out.png" }),
  };
}

function makeMockCtx(): AttachmentToolContext {
  return {
    available: true,
    putOutput: vi.fn(async () => ({ attachmentId: "att_1", displayUrl: "/a/att_1", mimeType: "image/png", name: "n.png" })),
  } as unknown as AttachmentToolContext;
}

const makeExtNoUI = () => ({}) as never;

const OPTS = {
  toolName: "image_generation",
  defaultModel: "m1",
  requiredParams: [] as readonly InteractionParam[],
  mediaFields: [] as readonly string[],
};

beforeEach(() => {
  process.env.TEST_KEY = "k";
  proxyFetchSpy.mockClear();
  delete (proxyFetchSpy as unknown as { lastProxy?: string }).lastProxy;
});

afterEach(() => {
  delete process.env.TEST_KEY;
  delete process.env.TEST_PROXY;
});

describe("落盘下载的出网路径", () => {
  it("★ route 声明了 proxy 且 env 已配 → 取图这一跳带上同一个代理", async () => {
    process.env.TEST_PROXY = "http://127.0.0.1:10808";
    const ctx = makeMockCtx();
    await runImageTool(
      { prompt: "x", model: "m1" },
      makeExtNoUI(),
      undefined,
      undefined,
      { ...OPTS, routes: [urlRoute("${TEST_PROXY}")], deps: { getCtx: () => ctx } },
    );
    // 取图跳确实经 proxyFetch,且拿到的是解析后的代理地址(而非占位符原文/undefined)。
    expect((proxyFetchSpy as unknown as { lastProxy?: string }).lastProxy).toBe(
      "http://127.0.0.1:10808",
    );
  });

  it("route 未声明 proxy → 仍经 proxyFetch 但代理为 undefined(直连,行为与既有一致)", async () => {
    const ctx = makeMockCtx();
    await runImageTool(
      { prompt: "x", model: "m1" },
      makeExtNoUI(),
      undefined,
      undefined,
      { ...OPTS, routes: [urlRoute()], deps: { getCtx: () => ctx } },
    );
    expect((proxyFetchSpy as unknown as { lastProxy?: string }).lastProxy).toBeUndefined();
  });

  it("显式注入 deps.fetchImpl 时以注入者为准(测试可控性不被破坏)", async () => {
    const injected = vi.fn(
      async () => new Response(new Uint8Array([9]), { status: 200, headers: { "content-type": "image/png" } }),
    );
    const ctx = makeMockCtx();
    await runImageTool(
      { prompt: "x", model: "m1" },
      makeExtNoUI(),
      undefined,
      undefined,
      {
        ...OPTS,
        routes: [urlRoute("${TEST_PROXY}")],
        deps: { getCtx: () => ctx, fetchImpl: injected as unknown as typeof fetch },
      },
    );
    expect(injected).toHaveBeenCalled();
  });
});
