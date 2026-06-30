/**
 * 回归:async 提交即错应立即暴露,而非进入对 undefined task_id 的无意义轮询(Req 1.6)。
 *
 * 修复前:async 路径 submit 后直接取 task_id 轮询,submit 体里的业务 error(HTTP 200)
 * 被忽略 → 轮询无效 url 直到超时,返回误导性 "timed out"。
 * 修复后:submit 后立即跑 detectError,命中即抛可读错误,且**不进入轮询**(只 fetch 一次)。
 */
import { describe, it, expect, vi } from "vitest";
import { runEndpoint } from "../../src/engine/endpoint-adapter.js";
import type { EndpointBehavior } from "../../src/engine/endpoint-types.js";

describe("async submit detectError(Req 1.6)", () => {
  it("submit 即错 → 立即抛错且不进入轮询", async () => {
    const behavior: EndpointBehavior = {
      url: "https://provider/submit",
      buildBody: () => ({}),
      async: {
        statusUrl: () => "https://provider/status",
        responseUrl: () => "https://provider/result",
        pollMs: 10,
        timeoutMs: 500,
        isComplete: () => true,
      },
      pickResult: () => ({ kind: "image", url: "https://x/img.png" }),
      detectError: (r) => (r as { error?: string }).error,
    };

    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "quota exceeded" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(
      runEndpoint(behavior, {}, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/quota exceeded/);

    // 只发了一次请求(submit);未进入 status 轮询。
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
