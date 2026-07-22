/**
 * webext-load-client — useRuntimeWebext 宿主壳降级隔离(任务 6.3 / Req 10.4)。
 *
 * 验证:安全门在服务端/浏览器侧拒绝(`/api/webext/resolve` 回 rejectedReason,或
 * loadExtension 判 rejected)时,hook 状态落 "rejected"/"none"、`extension` 恒为
 * undefined、且不抛出 —— 宿主壳(chat-app.tsx: `extension = buildTimeExtension ??
 * runtimeWebext.extension`)据此保持默认 UI 正常渲染,不因扩展被拒而崩壳。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useRuntimeWebext } from "../lib/app/webext-load-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useRuntimeWebext 降级隔离", () => {
  it("resolve 端点回 rejectedReason(如签名/SRI 拒绝) → 状态 rejected,extension 恒 undefined,不抛", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ found: true, rejectedReason: "签名不在白名单内或验签失败" }),
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useRuntimeWebext("some-source", false));

    await waitFor(() => expect(result.current.status).toBe("rejected"));
    expect(result.current.extension).toBeUndefined();
    expect(result.current.reason).toBe("签名不在白名单内或验签失败");
  });

  it("resolve 端点 found:false(无 webext 产物) → 状态 none,extension undefined,不抛", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ found: false }), { status: 200 })),
    );

    const { result } = renderHook(() => useRuntimeWebext("plain-source", false));

    await waitFor(() => expect(result.current.status).toBe("none"));
    expect(result.current.extension).toBeUndefined();
  });

  it("resolve 请求网络异常 → 捕获落 rejected,不向上抛出(宿主壳不因此崩溃)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { result } = renderHook(() => useRuntimeWebext("flaky-source", false));

    await waitFor(() => expect(result.current.status).toBe("rejected"));
    expect(result.current.extension).toBeUndefined();
    expect(result.current.reason).toBe("network down");
    consoleSpy.mockRestore();
  });

  it("skip=true(构建期已命中)→ 不发起请求,状态 idle", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { result } = renderHook(() => useRuntimeWebext("some-source", true));
    expect(result.current.status).toBe("idle");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
