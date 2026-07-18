/**
 * desktop-cloud-login · 任务 1.3 · stub egress 测试脚手架(design.md §System Flows 出口时序,
 * Req 3.4)。
 *
 * OpenAI 兼容 `POST /v1/chat/completions` stub HTTP 服务,供任务 7.2 集成测试与后续 e2e(7.4)
 * 复用:
 *  - 捕获入站请求(含 `Authorization` 头)供调用方断言 Bearer=桌面凭据(Req 3.1/3.2);
 *  - 正常模式按 SSE 逐帧回流式 completion(role/content delta → finish_reason:"stop" → `[DONE]`,
 *    与仓内既有 mock OpenAI provider 先例同构,见 agent-routes-subprocess.test.ts);
 *  - 可切换 `unauthorized` 模式模拟凭据失效(401,Req 3.7);
 *  - `unreachableBaseUrl()` 造一个保证连接被拒的 base(起服后立即关闭,取其已释放端口),
 *    供「egress 不可达」分支使用,无需额外起服务。
 *
 * 依赖:纯 Node `node:http`,无第三方 HTTP mock 库、无外网。
 */
import { createServer, type Server } from "node:http";

/** 单条被 stub 捕获的入站请求。 */
export interface StubEgressRequest {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

/** stub 当前回复模式。 */
export type StubEgressMode = "ok" | "unauthorized";

export interface StubEgress {
  /** OpenAI 兼容根,含尾部 `/v1`(与 `PI_WEB_CLOUD_EGRESS_BASE` 期望形态一致)。 */
  readonly baseUrl: string;
  readonly port: number;
  /** 迄今捕获的全部入站请求(按到达顺序)。 */
  requests(): ReadonlyArray<StubEgressRequest>;
  /** 切换回复模式:"ok"=流式 completion;"unauthorized"=401(Req 3.7)。 */
  setMode(mode: StubEgressMode): void;
  close(): Promise<void>;
}

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache",
  connection: "keep-alive",
} as const;

/**
 * 起一个 stub egress 服务。默认模式 "ok"。
 *
 * 流式回复内容固定含 token `STUBEGRESSTOKEN`,便于断言回复确实经本 stub 产生(而非其他
 * provider)。
 */
export function startStubEgress(): Promise<StubEgress> {
  const requests: StubEgressRequest[] = [];
  let mode: StubEgressMode = "ok";

  const server = createServer((req, res) => {
    if (req.method === "POST" && /\/chat\/completions/.test(req.url ?? "")) {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body: unknown = undefined;
        try {
          body = raw.length > 0 ? JSON.parse(raw) : undefined;
        } catch {
          body = raw;
        }
        requests.push({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body,
        });

        if (mode === "unauthorized") {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: { message: "invalid or expired credential", type: "invalid_request_error" },
            }),
          );
          return;
        }

        // "ok" 模式:SSE 逐帧回流式 completion(与 agent-routes-subprocess.test.ts 的
        // mock provider 同构),携带可识别 token 供断言。
        res.writeHead(200, SSE_HEADERS);
        const base = {
          id: "chatcmpl-stub-egress",
          object: "chat.completion.chunk",
          created: 0,
          model: "stub-model",
        };
        const send = (choices: unknown[], extra?: object): void => {
          res.write(`data: ${JSON.stringify({ ...base, choices, ...extra })}\n\n`);
        };
        send([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]);
        send([{ index: 0, delta: { content: "STUBEGRESSTOKEN" }, finish_reason: null }]);
        send([{ index: 0, delta: {}, finish_reason: "stop" }]);
        send([], { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.writeHead(404).end();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        port,
        requests: () => requests,
        setMode: (m) => {
          mode = m;
        },
        close: () =>
          new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/**
 * 造一个「不可达」的 egress base:起一个临时服务取其已分配端口后立即关闭 —— 该端口在
 * 关闭后短时间内几乎必然连接被拒(ECONNREFUSED),无需长期占用一个专门的黑洞服务。
 */
export async function unreachableBaseUrl(): Promise<string> {
  const server: Server = createServer();
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as { port: number }).port);
    });
  });
  await new Promise<void>((r) => server.close(() => r()));
  return `http://127.0.0.1:${port}/v1`;
}
