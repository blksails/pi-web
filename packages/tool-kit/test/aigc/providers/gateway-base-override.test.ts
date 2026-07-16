/**
 * 网关地址占位化(NEWAPI_BASE_URL / SUFY_BASE_URL / DASHSCOPE_BASE_URL)集成测试。
 *
 * 覆盖(task 2.3):
 *  - newapi / sufy:声明期 baseUrl 是 `${X_BASE_URL:-字面量}` 占位;经 runEndpoint 执行,
 *    设 env 时请求打到 env 指向的 stub,未设时打默认字面量 —— 用注入的 fetchImpl 捕获
 *    实际请求 URL,不发真实网络请求。
 *  - dashscope:同步端点 + 异步轮询(statusUrl/responseUrl 由同一 BASE 拼接)均跟随
 *    DASHSCOPE_BASE_URL override。
 *
 * 模块顶层不得读 process.env(双入口约束)——占位展开只发生在 runEndpoint 执行期,
 * 故这里全部通过 runEndpoint(而非直接读 route.url)来触发展开并断言真实请求目标。
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { runEndpoint } from "../../../src/engine/endpoint-adapter.js";
import { createNewApiImage } from "../../../src/aigc/providers/newapi.js";
import { createSufyImage } from "../../../src/aigc/providers/sufy.js";
import {
  createDashscopeSyncT2I,
  createDashscopeAsyncT2I,
} from "../../../src/aigc/providers/dashscope.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── newapi ──────────────────────────────────────────────────────────────────

describe("newapi baseUrl 占位覆盖", () => {
  it("未设 NEWAPI_BASE_URL 时打默认字面量", async () => {
    const route = createNewApiImage({ model: "gpt-image-1", label: "L", description: "d" });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [{ url: "https://x/a.png" }] }));
    vi.stubEnv("NEWAPI_API_KEY", "k");
    await runEndpoint(route, { prompt: "cat" }, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const requestedUrl = fetchImpl.mock.calls[0]?.[0];
    expect(requestedUrl).toBe("https://www.apiservices.top/v1/images/generations");
  });

  it("设 NEWAPI_BASE_URL 时请求打到 stub base", async () => {
    const route = createNewApiImage({ model: "gpt-image-1", label: "L", description: "d" });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [{ url: "https://x/a.png" }] }));
    vi.stubEnv("NEWAPI_API_KEY", "k");
    vi.stubEnv("NEWAPI_BASE_URL", "https://stub.local/newapi");
    await runEndpoint(route, { prompt: "cat" }, { fetchImpl });
    const requestedUrl = fetchImpl.mock.calls[0]?.[0];
    expect(requestedUrl).toBe("https://stub.local/newapi/images/generations");
  });
});

// ── sufy ────────────────────────────────────────────────────────────────────

describe("sufy baseUrl 占位覆盖", () => {
  it("未设 SUFY_BASE_URL 时打默认字面量", async () => {
    const route = createSufyImage({ model: "m", label: "L", description: "d" });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [{ url: "https://x/a.png" }] }));
    vi.stubEnv("SUFY_API_KEY", "k");
    await runEndpoint(route, { prompt: "cat" }, { fetchImpl });
    const requestedUrl = fetchImpl.mock.calls[0]?.[0];
    expect(requestedUrl).toBe("https://openai.sufy.com/v1/images/generations");
  });

  it("设 SUFY_BASE_URL 时请求打到 stub base", async () => {
    const route = createSufyImage({ model: "m", label: "L", description: "d" });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [{ url: "https://x/a.png" }] }));
    vi.stubEnv("SUFY_API_KEY", "k");
    vi.stubEnv("SUFY_BASE_URL", "https://stub.local/sufy");
    await runEndpoint(route, { prompt: "cat" }, { fetchImpl });
    const requestedUrl = fetchImpl.mock.calls[0]?.[0];
    expect(requestedUrl).toBe("https://stub.local/sufy/images/generations");
  });
});

// ── dashscope ─────────────────────────────────────────────────────────────────

describe("dashscope baseUrl 占位覆盖", () => {
  it("同步端点:未设 DASHSCOPE_BASE_URL 时打默认字面量", async () => {
    const route = createDashscopeSyncT2I({ model: "qwen-image-2.0", label: "L", description: "d" });
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ output: { choices: [{ message: { content: [{ image: "https://x/a.png" }] } }] } }),
    );
    vi.stubEnv("DASHSCOPE_API_KEY", "k");
    await runEndpoint(route, { prompt: "cat" }, { fetchImpl });
    const requestedUrl = fetchImpl.mock.calls[0]?.[0];
    expect(requestedUrl).toBe(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    );
  });

  it("同步端点:设 DASHSCOPE_BASE_URL 时请求打到 stub base", async () => {
    const route = createDashscopeSyncT2I({ model: "qwen-image-2.0", label: "L", description: "d" });
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ output: { choices: [{ message: { content: [{ image: "https://x/a.png" }] } }] } }),
    );
    vi.stubEnv("DASHSCOPE_API_KEY", "k");
    vi.stubEnv("DASHSCOPE_BASE_URL", "https://stub.local/dashscope");
    await runEndpoint(route, { prompt: "cat" }, { fetchImpl });
    const requestedUrl = fetchImpl.mock.calls[0]?.[0];
    expect(requestedUrl).toBe(
      "https://stub.local/dashscope/services/aigc/multimodal-generation/generation",
    );
  });

  it("异步轮询:statusUrl/responseUrl 跟随 DASHSCOPE_BASE_URL override", async () => {
    // taskPolling.pollMs 硬编码 5000ms(真实定时器下拖慢测试),用假定时器推进而非真等待。
    vi.useFakeTimers();
    try {
      const route = createDashscopeAsyncT2I({ model: "wanx2.0-t2i-turbo", label: "L", description: "d" });
      const succeeded = jsonResponse({
        output: { task_status: "SUCCEEDED", results: [{ url: "https://x/a.png" }] },
      });
      const fetchImpl = vi
        .fn()
        // submit
        .mockResolvedValueOnce(jsonResponse({ output: { task_id: "t1", task_status: "PENDING" } }))
        // status poll → SUCCEEDED
        .mockResolvedValueOnce(succeeded.clone())
        // responseUrl fetch(statusUrl == responseUrl for dashscope taskUrl,故再取一次)
        .mockResolvedValueOnce(succeeded.clone());
      vi.stubEnv("DASHSCOPE_API_KEY", "k");
      vi.stubEnv("DASHSCOPE_BASE_URL", "https://stub.local/dashscope");
      const promise = runEndpoint(route, { prompt: "cat" }, { fetchImpl });
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;
      expect(result).toEqual({ kind: "image", url: "https://x/a.png" });
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      // submit URL
      expect(fetchImpl.mock.calls[0]?.[0]).toBe(
        "https://stub.local/dashscope/services/aigc/text2image/image-synthesis",
      );
      // poll (statusUrl == responseUrl for dashscope taskUrl) — 由 submit 响应的 task_id 拼出
      expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://stub.local/dashscope/tasks/t1");
      expect(fetchImpl.mock.calls[2]?.[0]).toBe("https://stub.local/dashscope/tasks/t1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("异步轮询:未设 DASHSCOPE_BASE_URL 时轮询 URL 用默认字面量", async () => {
    vi.useFakeTimers();
    try {
      const route = createDashscopeAsyncT2I({ model: "wanx2.0-t2i-turbo", label: "L", description: "d" });
      const succeeded = jsonResponse({
        output: { task_status: "SUCCEEDED", results: [{ url: "https://x/a.png" }] },
      });
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ output: { task_id: "t2", task_status: "PENDING" } }))
        .mockResolvedValueOnce(succeeded.clone())
        .mockResolvedValueOnce(succeeded.clone());
      vi.stubEnv("DASHSCOPE_API_KEY", "k");
      const promise = runEndpoint(route, { prompt: "cat" }, { fetchImpl });
      await vi.advanceTimersByTimeAsync(5_000);
      await promise;
      expect(fetchImpl.mock.calls[0]?.[0]).toBe(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
      );
      expect(fetchImpl.mock.calls[1]?.[0]).toBe(
        "https://dashscope.aliyuncs.com/api/v1/tasks/t2",
      );
      expect(fetchImpl.mock.calls[2]?.[0]).toBe(
        "https://dashscope.aliyuncs.com/api/v1/tasks/t2",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
