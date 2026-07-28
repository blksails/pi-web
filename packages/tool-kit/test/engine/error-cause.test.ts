/**
 * `describeError` 的 cause 链展开 + callOnce 错误包装保留 cause(2026-07-28)。
 *
 * 背景:undici 把一切网络错误包装成 `TypeError: fetch failed`,真因只在 `err.cause`
 * (`HeadersTimeoutError` / `ConnectTimeoutError` / `ECONNREFUSED` …)。原实现用
 * `String(err)` 渲染,cause 全丢 —— 排查图像端点失败时只能靠耗时规律反推。
 */
import { describe, it, expect } from "vitest";
import { describeError, runEndpoint } from "../../src/engine/endpoint-adapter.js";
import type { EndpointBehavior } from "../../src/engine/endpoint-types.js";

/** 复刻 undici 的真实错误形状:TypeError: fetch failed + cause=HeadersTimeoutError。 */
function undiciFetchFailed(): TypeError {
  const cause = new Error("Headers Timeout Error");
  cause.name = "HeadersTimeoutError";
  return new TypeError("fetch failed", { cause });
}

describe("describeError", () => {
  it("普通 Error(无 cause)→ name: message", () => {
    expect(describeError(new Error("boom"))).toBe("Error: boom");
  });

  it("★undici 形状 → 展开 cause,真因可见", () => {
    expect(describeError(undiciFetchFailed())).toBe(
      "TypeError: fetch failed ← HeadersTimeoutError: Headers Timeout Error",
    );
  });

  it("多层 cause 逐层展开", () => {
    const l3 = new Error("ECONNREFUSED");
    const l2 = new Error("connect failed", { cause: l3 });
    const l1 = new TypeError("fetch failed", { cause: l2 });
    expect(describeError(l1)).toBe(
      "TypeError: fetch failed ← Error: connect failed ← Error: ECONNREFUSED",
    );
  });

  it("深度封顶 3 层,自引用 cause 不会无限递归", () => {
    const e = new Error("self") as Error & { cause?: unknown };
    e.cause = e;
    const out = describeError(e);
    expect(out.split("←")).toHaveLength(4); // 头 + 3 层
  });

  it("非 Error 值原样字符串化", () => {
    expect(describeError("plain string")).toBe("plain string");
    expect(describeError(undefined)).toBe("undefined");
  });

  it("message 为空时只出 name", () => {
    const e = new Error("");
    e.name = "WeirdError";
    expect(describeError(e)).toBe("WeirdError");
  });
});

describe("callOnce 错误包装(经 runEndpoint)", () => {
  const behavior: EndpointBehavior = {
    url: "https://example.test/v1/images/generations",
    method: "POST",
    buildBody: async () => ({ x: 1 }),
    pickResult: () => ({ kind: "raw", value: null }),
  };

  it("★网络失败:消息含真因,且原始错误挂在 cause 上", async () => {
    const thrown = undiciFetchFailed();
    await expect(
      runEndpoint(behavior, {}, { fetchImpl: (async () => { throw thrown; }) as unknown as typeof fetch }),
    ).rejects.toMatchObject({
      // 真因进了人读消息 —— 这是本次修复的核心
      message: expect.stringContaining("HeadersTimeoutError: Headers Timeout Error"),
      // 原始错误对象保留,上层可据类型分类而非字符串匹配
      cause: thrown,
    });
  });

  it("AbortError 原样抛出,不被包装(取消 ≠ 失败)", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    await expect(
      runEndpoint(behavior, {}, { fetchImpl: (async () => { throw abort; }) as unknown as typeof fetch }),
    ).rejects.toBe(abort);
  });
});
