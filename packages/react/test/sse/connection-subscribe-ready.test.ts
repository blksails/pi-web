/**
 * PiSessionConnection.whenSubscribed 契约 —— 消除「prompt 早于订阅」的竞态。
 *
 * whenSubscribed() 解析于「本轮 /stream 订阅在服务端建立」之后:收到 GET /stream 响应即证明
 * (SSE 响应的 ReadableStream.start() 在响应构造/handler return 前同步执行 subscribe)。
 * PiTransport.sendMessages 在 POST prompt 前 await 它,故 fetch 未返回时 prompt 不得发出;
 * 订阅失败/中断亦 resolve(降级,不挂起调用方)。
 */
import { describe, it, expect, vi } from "vitest";
import { PiSessionConnection } from "../../src/sse/connection.js";
import { makeSseResponse } from "../fixtures/sse-samples.js";

describe("PiSessionConnection.whenSubscribed", () => {
  it("开流前为已就绪(resolved)", async () => {
    const conn = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: vi.fn(async () => makeSseResponse("")) as unknown as typeof fetch,
      onError: vi.fn(),
    });
    await expect(conn.whenSubscribed()).resolves.toBeUndefined();
  });

  it("openChunkStream 后,直到收到 /stream 响应才 resolve", async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchGate = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const conn = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: (() => fetchGate) as unknown as typeof fetch,
      onError: vi.fn(),
    });

    conn.openChunkStream();
    const ready = conn.whenSubscribed();
    let settled = false;
    void ready.then(() => {
      settled = true;
    });

    // fetch 未返回 → 订阅未就绪 → 不应放行 prompt。
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    // 收到响应 → 就绪(放行 POST prompt)。
    resolveFetch(makeSseResponse(""));
    await ready;
    expect(settled).toBe(true);
  });

  it("订阅失败(非 2xx)也 resolve(降级,不挂起调用方)", async () => {
    const conn = new PiSessionConnection({
      baseUrl: "http://api.test",
      sessionId: "s1",
      fetchImpl: vi.fn(
        async () => new Response("", { status: 500 }),
      ) as unknown as typeof fetch,
      onError: vi.fn(),
    });
    conn.openChunkStream();
    await expect(conn.whenSubscribed()).resolves.toBeUndefined();
  });
});
