/**
 * aigc-proxy · proxy-routes 真实 HTTP stub 上游集成测试(task 3.2)。
 *
 * 与 `proxy-routes.test.ts`(task 3.1)的区别:那边全用 `vi.fn()` mock `fetchImpl`,
 * 只验证 proxy-routes 内部逻辑的调用形状;这里起一个真实的 `node:http` stub 服务器
 * 监听 `127.0.0.1` 随机端口,`fetchImpl` 用「真实全局 fetch(undici)包一层 URL 重写」
 * 实现——只替换 origin(协议+host+port),保留 path/query 不变,再交给真实 fetch 发往
 * stub。这仍是一次完整的真实 TCP 往返(undici 真连 stub 进程),满足「真实 HTTP stub
 * 上游」语义;之所以要重写 origin,是因为 provider-registry 的 upstreamBase 是登记表
 * 写死的真实域名字面量,而 proxy-routes 当前只开放 `fetchImpl`/`env` 两个测试接缝,没有
 * 开放「上游 base 可覆盖」接缝(design.md 与 provider-registry.ts 明确:上游地址变更是
 * 双处一致性问题,不属本任务改动范围)。
 *
 * 覆盖 Req 2.1, 2.2, 2.4, 2.5, 2.6, 3.3;经真实 Router 装配(`createPiWebHandler` +
 * `createAigcProxyRoutes` 注入路由,与 proxy-routes.test.ts 同一套贴近生产的最小装配)。
 */
import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import {
  createAigcProxyRoutes,
  mintSessionToken,
} from "../../src/aigc-proxy/index.js";

const SECRET = "test-aigc-proxy-integration-secret";
const REAL_KEY = "sk-should-never-leak-real-key-99999";

/** 待每个用例结束后关闭的 stub 服务器集合。 */
const serversToClose: Server[] = [];

afterEach(async () => {
  await Promise.all(
    serversToClose.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close(() => resolve());
        }),
    ),
  );
});

/** 起一个 stub 服务器,监听 127.0.0.1 随机端口,返回 { server, origin, port }。 */
async function startStub(
  onRequest: (req: IncomingMessage, res: ServerResponse, body: Buffer) => void,
): Promise<{ server: Server; origin: string; port: number }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => onRequest(req, res, Buffer.concat(chunks)));
  });
  serversToClose.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("[test] stub server address 获取失败");
  }
  return { server, origin: `http://127.0.0.1:${address.port}`, port: address.port };
}

/**
 * 构造「真实 fetch 包一层 URL 重写」的 fetchImpl:只替换 origin(协议+host+port),
 * path/query 原样保留;真正的网络往返仍走 Node 全局 fetch(undici)。
 */
function makeRewritingFetch(targetOrigin: string): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const originalUrl =
      typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
    const rewritten = new URL(`${originalUrl.pathname}${originalUrl.search}`, targetOrigin);
    return fetch(rewritten, init);
  }) as typeof fetch;
}

function handlerWith(opts: {
  readonly fetchImpl: typeof fetch;
  readonly env?: Record<string, string | undefined>;
}) {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  return createPiWebHandler({
    manager,
    store,
    routes: createAigcProxyRoutes({
      secret: SECRET,
      fetchImpl: opts.fetchImpl,
      env: opts.env ?? {},
    }),
    authResolver: () => ({ anonymous: true }),
  });
}

function validToken(sessionId = "sess-int-1"): string {
  return mintSessionToken({ sessionId, ttlMs: 60_000, secret: SECRET });
}

function expiredToken(sessionId = "sess-int-1"): string {
  return mintSessionToken({ sessionId, ttlMs: -1000, secret: SECRET });
}

describe("proxy-routes × 真实 HTTP stub 上游 — 换 key 转发(Req 2.1, 2.2)", () => {
  it("有效 token → stub 收到 Bearer <真实key>,响应体透传", async () => {
    let receivedAuth: string | undefined;
    let requestCount = 0;
    const { origin } = await startStub((req, res, _body) => {
      requestCount += 1;
      receivedAuth = req.headers.authorization;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, echoed: true }));
    });

    const res = await handlerWith({
      fetchImpl: makeRewritingFetch(origin),
      env: { NEWAPI_API_KEY: REAL_KEY },
    })(
      new Request("http://x/aigc-proxy/newapi/images/generations", {
        method: "POST",
        headers: {
          authorization: `Bearer ${validToken()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ prompt: "hello" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, echoed: true });
    expect(requestCount).toBe(1);
    expect(receivedAuth).toBe(`Bearer ${REAL_KEY}`);
  });

  it("无效 token → 401,stub 零请求", async () => {
    let requestCount = 0;
    const { origin } = await startStub((_req, res) => {
      requestCount += 1;
      res.writeHead(200);
      res.end("{}");
    });

    const res = await handlerWith({
      fetchImpl: makeRewritingFetch(origin),
      env: { NEWAPI_API_KEY: REAL_KEY },
    })(
      new Request("http://x/aigc-proxy/newapi/images/generations", {
        method: "POST",
        headers: { authorization: "Bearer not-a-real-token" },
      }),
    );

    expect(res.status).toBe(401);
    expect(requestCount).toBe(0);
  });

  it("过期 token → 401,stub 零请求(Req 3.3)", async () => {
    let requestCount = 0;
    const { origin } = await startStub((_req, res) => {
      requestCount += 1;
      res.writeHead(200);
      res.end("{}");
    });

    const res = await handlerWith({
      fetchImpl: makeRewritingFetch(origin),
      env: { NEWAPI_API_KEY: REAL_KEY },
    })(
      new Request("http://x/aigc-proxy/newapi/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${expiredToken()}` },
      }),
    );

    expect(res.status).toBe(401);
    expect(requestCount).toBe(0);
  });

  it("未知 provider → 404,stub 零请求(Req 2.2)", async () => {
    let requestCount = 0;
    const { origin } = await startStub((_req, res) => {
      requestCount += 1;
      res.writeHead(200);
      res.end("{}");
    });

    const res = await handlerWith({
      fetchImpl: makeRewritingFetch(origin),
      env: { NEWAPI_API_KEY: REAL_KEY },
    })(
      new Request("http://x/aigc-proxy/not-a-registered-provider/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${validToken()}` },
      }),
    );

    expect(res.status).toBe(404);
    expect(requestCount).toBe(0);
  });
});

describe("proxy-routes × 真实 HTTP stub 上游 — 流式(Req 2.4)", () => {
  it("SSE 分片:调用方逐片增量收到,首片先于尾片写出的时刻到达(非一次性缓冲)", async () => {
    const STUB_WRITE_DELAY_MS = 80;
    const stubWriteTimestamps: number[] = [];

    const { origin } = await startStub((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      stubWriteTimestamps.push(Date.now());
      res.write(`data: chunk-1\n\n`);
      setTimeout(() => {
        stubWriteTimestamps.push(Date.now());
        res.write(`data: chunk-2\n\n`);
        setTimeout(() => {
          res.end();
        }, 10);
      }, STUB_WRITE_DELAY_MS);
    });

    const res = await handlerWith({
      fetchImpl: makeRewritingFetch(origin),
      env: { NEWAPI_API_KEY: REAL_KEY },
    })(
      new Request("http://x/aigc-proxy/newapi/images/stream", {
        method: "POST",
        headers: { authorization: `Bearer ${validToken()}` },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.body).not.toBeNull();

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const clientChunks: Array<{ text: string; readAt: number }> = [];

    // 逐片读取(不一次性 res.text()),验证分片边界而非合并读取。
    while (clientChunks.length < 2) {
      const { value, done } = await reader.read();
      if (done) break;
      clientChunks.push({ text: decoder.decode(value), readAt: Date.now() });
    }
    // 读完剩余(避免挂起未消费的响应体)。
    reader.cancel().catch(() => {});

    expect(clientChunks.length).toBeGreaterThanOrEqual(2);
    expect(clientChunks[0]!.text).toContain("chunk-1");
    expect(clientChunks[0]!.text).not.toContain("chunk-2");
    expect(clientChunks[1]!.text).toContain("chunk-2");

    // 核心非缓冲证明:客户端读到首片的时刻早于 stub 写出第二片的时刻——
    // 若代理侧整体缓冲直至响应结束才转发,首片读取必然晚于第二片写出(及 end())。
    expect(stubWriteTimestamps.length).toBe(2);
    expect(clientChunks[0]!.readAt).toBeLessThan(stubWriteTimestamps[1]!);
  });
});

describe("proxy-routes × 真实 HTTP stub 上游 — multipart(Req 2.4)", () => {
  it("multipart 请求体 → stub 收到 boundary 完整的原始字节,与发送侧逐字节一致", async () => {
    const fileBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 1, 2, 3, 255, 0]);
    const form = new FormData();
    form.set("prompt", "draw a cat");
    form.set(
      "image",
      new Blob([fileBytes], { type: "application/octet-stream" }),
      "input.png",
    );

    // 用一个探针 Request 先真实序列化 multipart 体(取得确定的 boundary + 原始字节),
    // 再把这份固定字节作为实际测试请求的 body——避免 FormData 每次序列化随机 boundary
    // 导致「发送侧」与「断言基准」不可复现地对不上。
    const probeRequest = new Request("http://probe/x", { method: "POST", body: form });
    const expectedContentType = probeRequest.headers.get("content-type")!;
    expect(expectedContentType).toContain("multipart/form-data");
    expect(expectedContentType).toContain("boundary=");
    const expectedBytes = Buffer.from(await probeRequest.arrayBuffer());

    let receivedBody: Buffer | undefined;
    let receivedContentType: string | undefined;
    const { origin } = await startStub((req, res, body) => {
      receivedBody = body;
      receivedContentType = req.headers["content-type"];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    const res = await handlerWith({
      fetchImpl: makeRewritingFetch(origin),
      env: { NEWAPI_API_KEY: REAL_KEY },
    })(
      new Request("http://x/aigc-proxy/newapi/images/edits", {
        method: "POST",
        headers: {
          authorization: `Bearer ${validToken()}`,
          "content-type": expectedContentType,
        },
        body: expectedBytes,
      }),
    );

    expect(res.status).toBe(200);
    expect(receivedContentType).toBe(expectedContentType);
    expect(receivedBody).toBeDefined();
    expect(receivedBody!.equals(expectedBytes)).toBe(true);
    // boundary 令牌本身(及文件字节)必须完整出现在 stub 收到的原始体中。
    const boundaryToken = /boundary=([^\s;]+)/.exec(expectedContentType)![1]!;
    expect(receivedBody!.toString("latin1")).toContain(boundaryToken);
  });
});

describe("proxy-routes × 真实 HTTP stub 上游 — 错误(Req 2.5, 2.6)", () => {
  it("stub 返回 400 → 状态码与体透传", async () => {
    const { origin } = await startStub((_req, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad request from upstream" }));
    });

    const res = await handlerWith({
      fetchImpl: makeRewritingFetch(origin),
      env: { NEWAPI_API_KEY: REAL_KEY },
    })(
      new Request("http://x/aigc-proxy/newapi/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${validToken()}` },
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad request from upstream" });
  });

  it("stub 返回 500 → 状态码与体透传", async () => {
    const { origin } = await startStub((_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal upstream failure" }));
    });

    const res = await handlerWith({
      fetchImpl: makeRewritingFetch(origin),
      env: { NEWAPI_API_KEY: REAL_KEY },
    })(
      new Request("http://x/aigc-proxy/newapi/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${validToken()}` },
      }),
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal upstream failure" });
  });

  it("上游端口不通(connect refused)→ 502,响应体不含真实 key", async () => {
    // 先 listen 拿到一个真实分配过的端口,再立即 close——该端口随后处于「无人监听」
    // 状态,对其发起连接会得到 ECONNREFUSED(真实网络层错误,非 mock)。
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const address = probe.address();
    if (address === null || typeof address === "string") {
      throw new Error("[test] probe server address 获取失败");
    }
    const deadPort = address.port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const res = await handlerWith({
      fetchImpl: makeRewritingFetch(`http://127.0.0.1:${deadPort}`),
      env: { NEWAPI_API_KEY: REAL_KEY },
    })(
      new Request("http://x/aigc-proxy/newapi/images/generations", {
        method: "POST",
        headers: { authorization: `Bearer ${validToken()}` },
      }),
    );

    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain(REAL_KEY);
  });
});
