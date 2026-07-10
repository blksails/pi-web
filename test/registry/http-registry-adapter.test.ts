/**
 * HttpRegistryAdapter 契约测试(cli-package-commands 任务 7.1/7.2)—— **无网络**。
 *
 * 注入 fake fetch 驱动四类操作的成功/错误分支:错误码归一、可变 ref 前置拒绝(不触网)、
 * 网络异常→UNREACHABLE(带地址)。registry-client 经 alias 解析(源码 inline)。
 */
import { describe, it, expect, vi } from "vitest";
import { HttpRegistryAdapter } from "@/server/cli/registry/http-registry-adapter";

/** fake fetch:按 (method, path) 返回 canned HTTP 响应({status, text()})。 */
type Canned = { status: number; body: unknown };
function fakeFetch(routes: (method: string, url: string, init: { body?: string }) => Canned | Error) {
  return vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const out = routes(init.method, url, { ...(init.body !== undefined ? { body: init.body } : {}) });
    if (out instanceof Error) throw out;
    return { status: out.status, text: async () => JSON.stringify(out.body) };
  });
}

const BASE = "https://registry.example";
const errBody = (code: string, message = "x", details?: Record<string, unknown>) => ({
  error: { code, message, ...(details ? { details } : {}) },
});

describe("HttpRegistryAdapter — 成功分支", () => {
  it("resolve → 自包含来源 + 清单", async () => {
    const fetch = fakeFetch((m, u) => {
      if (m === "GET" && u.includes("/resolve"))
        return { status: 200, body: { sourceId: "acme/bot", version: "1.0.0", origin: { type: "oss", bundle: "bundles/x.tgz" }, hydrate: "runtime", policy: {}, capabilities: {}, publisherFingerprint: "fp", manifest: { name: "acme/bot", signature: "s" } } };
      return { status: 404, body: errBody("NOT_FOUND") };
    });
    const a = new HttpRegistryAdapter({ baseUrl: BASE, consumeToken: "c", fetch: fetch as never });
    const r = await a.resolve("acme/bot", { channel: "stable" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.version).toBe("1.0.0");
      expect(r.value.origin).toEqual({ type: "oss", bundle: "bundles/x.tgz" });
      expect(r.value.manifest["name"]).toBe("acme/bot");
    }
  });

  it("uploadBundle → 内容寻址 key", async () => {
    const fetch = fakeFetch((m, u) => {
      if (m === "POST" && u.endsWith("/bundles")) return { status: 201, body: { bundle: "bundles/deadbeef.tgz" } };
      return { status: 500, body: errBody("OTHER") };
    });
    const a = new HttpRegistryAdapter({ baseUrl: BASE, publishToken: "p", fetch: fetch as never });
    const r = await a.uploadBundle("acme/bot", new Uint8Array([1, 2, 3]));
    expect(r.ok && r.value.bundle).toBe("bundles/deadbeef.tgz");
  });

  it("registerVersion(oss) happy → ok", async () => {
    const fetch = fakeFetch(() => ({ status: 201, body: { version: { status: "ready" } } }));
    const a = new HttpRegistryAdapter({ baseUrl: BASE, publishToken: "p", fetch: fetch as never });
    const r = await a.registerVersion("acme/bot", { type: "oss", bundle: "bundles/x.tgz" }, { name: "acme/bot", signature: "s" });
    expect(r.ok).toBe(true);
  });

  it("setChannel → ok", async () => {
    const fetch = fakeFetch(() => ({ status: 200, body: { name: "stable", version: "1.0.0" } }));
    const a = new HttpRegistryAdapter({ baseUrl: BASE, publishToken: "p", fetch: fetch as never });
    const r = await a.setChannel("acme/bot", "stable", "1.0.0");
    expect(r.ok).toBe(true);
  });
});

describe("HttpRegistryAdapter — 错误归一", () => {
  it("★ 可变 git ref(分支名)→ MUTABLE_REF,且**不触网**(前置拒绝)", async () => {
    const fetch = fakeFetch(() => ({ status: 201, body: {} }));
    const a = new HttpRegistryAdapter({ baseUrl: BASE, publishToken: "p", fetch: fetch as never });
    const r = await a.registerVersion("acme/bot", { type: "git", repo: "r", ref: "main" }, { signature: "s" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("MUTABLE_REF");
    expect(fetch).not.toHaveBeenCalled(); // Req 7.8:前置拒绝,不推给服务端
  });

  it("★ 可变 npm range → MUTABLE_REF,不触网", async () => {
    const fetch = fakeFetch(() => ({ status: 201, body: {} }));
    const a = new HttpRegistryAdapter({ baseUrl: BASE, publishToken: "p", fetch: fetch as never });
    const r = await a.registerVersion("acme/bot", { type: "npm", name: "p", version: "^1.0.0" }, { signature: "s" });
    expect(r.ok === false && r.error.code).toBe("MUTABLE_REF");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("不可变 git tag(v1.0.0)放行到服务端", async () => {
    const fetch = fakeFetch(() => ({ status: 201, body: { version: { status: "ready" } } }));
    const a = new HttpRegistryAdapter({ baseUrl: BASE, publishToken: "p", fetch: fetch as never });
    const r = await a.registerVersion("acme/bot", { type: "git", repo: "r", ref: "v1.0.0" }, { signature: "s" });
    expect(r.ok).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("VERSION_CONFLICT → VERSION_EXISTS", async () => {
    const fetch = fakeFetch(() => ({ status: 409, body: errBody("VERSION_CONFLICT", "exists", { version: "1.0.0" }) }));
    const a = new HttpRegistryAdapter({ baseUrl: BASE, publishToken: "p", fetch: fetch as never });
    const r = await a.registerVersion("acme/bot", { type: "oss", bundle: "b" }, { signature: "s" });
    expect(r.ok === false && r.error.code).toBe("VERSION_EXISTS");
    if (!r.ok && r.error.code === "VERSION_EXISTS") expect(r.error.version).toBe("1.0.0");
  });

  it("SIGNATURE/INTEGRITY → VERSION_REJECTED(带原因)", async () => {
    const fetch = fakeFetch(() => ({ status: 400, body: errBody("SIGNATURE", "bad sig") }));
    const a = new HttpRegistryAdapter({ baseUrl: BASE, publishToken: "p", fetch: fetch as never });
    const r = await a.registerVersion("acme/bot", { type: "oss", bundle: "b" }, { signature: "s" });
    expect(r.ok === false && r.error.code).toBe("VERSION_REJECTED");
    if (!r.ok && r.error.code === "VERSION_REJECTED") expect(r.error.reason).toMatch(/SIGNATURE/);
  });

  it("NOT_FOUND → SOURCE_ABSENT", async () => {
    const fetch = fakeFetch(() => ({ status: 404, body: errBody("NOT_FOUND") }));
    const a = new HttpRegistryAdapter({ baseUrl: BASE, consumeToken: "c", fetch: fetch as never });
    const r = await a.resolve("acme/ghost", { version: "1.0.0" });
    expect(r.ok === false && r.error.code).toBe("SOURCE_ABSENT");
  });

  it("★ 网络不可达 → UNREACHABLE(带 registry 地址)", async () => {
    const fetch = fakeFetch(() => new Error("ECONNREFUSED"));
    const a = new HttpRegistryAdapter({ baseUrl: BASE, publishToken: "p", fetch: fetch as never, });
    const r = await a.setChannel("acme/bot", "stable", "1.0.0");
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.code === "UNREACHABLE") {
      expect(r.error.baseUrl).toBe(BASE); // 携带地址(Req 7.2)
    } else {
      throw new Error("expected UNREACHABLE");
    }
  });
});
