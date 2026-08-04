/**
 * desktop-cloud-login 任务 1.3 · stub egress 脚手架自测(Req 3.4)。
 *
 * 独立于真实 runner,直接用 `fetch` 打 stub 验证其自身契约:带合法 Bearer 的请求得
 * 流式回复(捕获到相同 Authorization)、401 分支可触发、`unreachableBaseUrl()` 产出的
 * base 确实连接被拒。任务 7.2 在此基础上接真实 runner 子进程复用同一 stub。
 */
import { describe, it, expect, afterEach } from "vitest";
import { startStubEgress, unreachableBaseUrl, type StubEgress } from "./stub-egress.js";

let stub: StubEgress | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

describe("startStubEgress", () => {
  it("ok 模式:带 Bearer 的请求得 SSE 流式回复,并捕获同一 Authorization", async () => {
    stub = await startStubEgress();
    const res = await fetch(`${stub.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: "Bearer desktop-cred.sig", "content-type": "application/json" },
      body: JSON.stringify({ model: "stub-model", messages: [], stream: true }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("STUBEGRESSTOKEN");
    expect(text).toContain("[DONE]");

    expect(stub.requests()).toHaveLength(1);
    expect(stub.requests()[0]?.authorization).toBe("Bearer desktop-cred.sig");
  });

  it("unauthorized 模式:401 分支可触发(凭据失效,Req 3.7)", async () => {
    stub = await startStubEgress();
    stub.setMode("unauthorized");
    const res = await fetch(`${stub.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: "Bearer expired.sig", "content-type": "application/json" },
      body: JSON.stringify({ model: "stub-model", messages: [] }),
    });
    expect(res.status).toBe(401);
    expect(stub.requests()).toHaveLength(1);
  });

  it("非 chat/completions 路径 → 404", async () => {
    stub = await startStubEgress();
    const res = await fetch(`${stub.baseUrl}/other`);
    expect(res.status).toBe(404);
  });
});

describe("unreachableBaseUrl", () => {
  it("产出的 base 连接被拒(不可达分支)", async () => {
    const base = await unreachableBaseUrl();
    await expect(fetch(`${base}/chat/completions`, { method: "POST" })).rejects.toThrow();
  });
});
