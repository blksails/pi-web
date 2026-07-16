#!/usr/bin/env node
/**
 * llm-gateway e2e(spec sandbox-credentials-v2,Task 4.1)—— LLM 网关换钥+流式转发的端到端
 * 安全性质证明,无 e2b 依赖(真实沙盒回归见 4.4,条件跑)。改造自已摘除的
 * `e2e/aigc-proxy/proxy-chain.local.mjs`(同一三进程编排骨架,保留 spawn/stub/断言母本)。
 *
 * 跑法:`pnpm e2e:llm-gateway`(或 `node e2e/llm-gateway/gateway-chain.local.mjs`)。
 *
 * 拓扑(三个真实进程 + 一个真实 TCP stub,均非共享内存):
 *
 *   sandbox-child.ts(独立子进程,env 仅含 PI_LLM_GATEWAY_BASE/PI_LLM_TOKEN_NEWAPI——
 *   无任何 PROVIDER_KEY_NAMES 真实值)
 *        │ POST http://127.0.0.1:<serverPort>/api/llm-gateway/newapi/chat/completions
 *        │ Authorization: Bearer <scoped-token>(token 当 apiKey 用)   (真实 HTTP #1)
 *        ▼
 *   server-entry.ts(真实 pi-web server 最小装配,env 含真实(stub)NEWAPI_API_KEY)
 *        │ createLlmGatewayRoutes:scope token 校验 → 查 env 换真实 key → 流式转发
 *        │ Authorization: Bearer sk-real-e2e-llm-gw                    (真实 HTTP #2)
 *        ▼
 *   stub SSE 上游(本进程内 node:http,分块 flush,记录收到的 authorization 头)
 *
 * 断言(Req 覆盖):
 *   ① 流式回复逐块到达沙箱侧(非整体缓冲)+ 全文与 stub fixture 逐字精确一致(Req 2.3, 6.2)
 *   ② stub 收到且仅收到 `Bearer sk-real-e2e-llm-gw`(真实 key 只在 server↔stub 段出现,
 *      Req 6.2)
 *   ③ 子进程自检:env 全程无任何 PROVIDER_KEY_NAMES 真实值(Req 6.1)
 *   ④ 负路径:无 token → 401;过期 token → 401;错 scope token(llm:sufy 打 newapi)→ 403,
 *      三者均零上游新增请求(Req 6.3)
 *   ⑤ `/api/aigc-proxy/*` → 404(已摘除,Req 6.4)
 *
 * 形态取舍同 aigc-proxy 版本:server-entry 是"最小装配"而非完整 `server/index.ts`;
 * provider 登记表以直接注入(而非内置表 JSON 覆盖)指向本地 stub,`createLlmGatewayRoutes`
 * 生产代码零改动。TS 子进程加载沿用仓内 `scripts/dev-all.mjs` 同一惯例——
 * `node --import <jiti-register> <entry.ts>`。
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JITI_REGISTER = join(
  ROOT,
  "node_modules/.pnpm/jiti@2.7.0/node_modules/jiti/lib/jiti-register.mjs",
);
const SERVER_ENTRY = join(ROOT, "e2e/llm-gateway/server-entry.ts");
const SANDBOX_CHILD = join(ROOT, "e2e/llm-gateway/sandbox-child.ts");

const REAL_KEY = "sk-real-e2e-llm-gw";
const GATEWAY_SECRET = `e2e-llm-gw-secret-${randomBytes(8).toString("hex")}`;

/** stub 上游分块 SSE 内容(拼接后须与子进程侧 fullText 逐字一致)+ 分块间隔。 */
const SSE_CHUNKS = ["Hel", "lo ", "from ", "stub"];
const FULL_TEXT = SSE_CHUNKS.join("");
const CHUNK_DELAY_MS = 60;

const OVERALL_TIMEOUT_MS = 55_000;

const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

/** 收到的 stub 请求记录(供断言②/④用)。 */
const stubRequests = [];

function startStub() {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      stubRequests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
      });
      if (req.url !== "/v1/chat/completions" || req.headers.authorization !== `Bearer ${REAL_KEY}`) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "stub: unexpected auth or path" } }));
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      for (const piece of SSE_CHUNKS) {
        await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      }
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return new Promise((resolvePromise, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolvePromise({ server, origin: `http://127.0.0.1:${addr.port}` });
    });
  });
}

/** 起 server-entry.ts 子进程,解析首行 `GATEWAY_CHAIN_READY <json>`。 */
function startServerEntry(stubOrigin) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", JITI_REGISTER, SERVER_ENTRY],
      {
        cwd: ROOT,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          PORT: "0",
          PI_WEB_LLM_GATEWAY_SECRET: GATEWAY_SECRET,
          STUB_ORIGIN: stubOrigin,
          NEWAPI_API_KEY: REAL_KEY,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;
    child.stdout.on("data", (d) => {
      stdoutBuf += d.toString();
      const m = /GATEWAY_CHAIN_READY (\{.*\})/.exec(stdoutBuf);
      if (m && !settled) {
        settled = true;
        resolvePromise({ child, ready: JSON.parse(m[1]) });
      }
    });
    child.stderr.on("data", (d) => {
      stderrBuf += d.toString();
    });
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`server-entry 提前退出(code=${code}):\n${stderrBuf || stdoutBuf}`));
      }
    });
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

/**
 * 起 sandbox-child.ts 子进程(env 显式白名单,不继承父 shell 全部 env —— 断言③前置)。
 * 解析唯一一行 `SANDBOX_RESULT <json>`。
 */
function runSandboxChild(sandboxEnv) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", JITI_REGISTER, SANDBOX_CHILD],
      {
        cwd: ROOT,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          ...sandboxEnv,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdoutBuf = "";
    let stderrBuf = "";
    child.stdout.on("data", (d) => (stdoutBuf += d.toString()));
    child.stderr.on("data", (d) => (stderrBuf += d.toString()));
    child.on("exit", () => {
      const m = /SANDBOX_RESULT (\{.*\})/.exec(stdoutBuf);
      if (!m) {
        reject(new Error(`sandbox-child 未产出 SANDBOX_RESULT:\nstdout=${stdoutBuf}\nstderr=${stderrBuf}`));
        return;
      }
      resolvePromise(JSON.parse(m[1]));
    });
    child.on("error", reject);
  });
}

async function main() {
  const timeoutGuard = setTimeout(() => {
    console.error(`✗ 全局超时(>${OVERALL_TIMEOUT_MS}ms),强制退出`);
    process.exit(1);
  }, OVERALL_TIMEOUT_MS);
  timeoutGuard.unref?.();

  const { server: stubServer, origin: stubOrigin } = await startStub();
  let serverChild;
  try {
    const { child, ready } = await startServerEntry(stubOrigin);
    serverChild = child;
    const { publicBase, sandboxEnv, expiredToken, wrongScopeToken } = ready;
    const gatewayUrl = `${publicBase}/api/llm-gateway/newapi/chat/completions`;

    // ── 编排侧自证:传给 sandbox-child 的 env 白名单本就不含真实 key 字面量 ──────
    check(
      "编排侧:sandbox-child env 白名单不含真实 key 字面量",
      !Object.values(sandboxEnv).some((v) => typeof v === "string" && v.includes(REAL_KEY)),
      JSON.stringify(sandboxEnv),
    );
    check(
      "编排侧:sandboxEnv 键名符合跨仓契约(PI_LLM_GATEWAY_BASE + PI_LLM_TOKEN_NEWAPI)",
      typeof sandboxEnv.PI_LLM_GATEWAY_BASE === "string" &&
        typeof sandboxEnv.PI_LLM_TOKEN_NEWAPI === "string",
    );

    // ── 正路径:真实沙箱子进程,仅持 token,发主对话请求经网关流式回传 ──────────────
    const okResult = await runSandboxChild(sandboxEnv);
    check(
      "① 分块流式到达(非整体缓冲):多次独立 read() 且首末间隔可观测",
      okResult.ok === true && okResult.incremental === true,
      JSON.stringify(okResult),
    );
    check(
      "① 流式回复全文与 stub fixture 逐字精确一致",
      okResult.ok === true && okResult.fullText === FULL_TEXT,
      JSON.stringify(okResult),
    );
    check(
      "② stub 收到且仅收到 Bearer sk-real-e2e-llm-gw",
      stubRequests.length === 1 && stubRequests[0].authorization === `Bearer ${REAL_KEY}`,
      JSON.stringify(stubRequests),
    );
    check("③ 子进程自检:env 全程无任何 PROVIDER_KEY_NAMES 真实值", okResult.envLeak === false, JSON.stringify(okResult));

    // ── 负路径④:无 token / 过期 token / 错 scope token,三者均零上游新增请求 ───────
    const requestCountBeforeNegative = stubRequests.length;

    const noTokenRes = await fetch(gatewayUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "x", stream: true, messages: [] }),
    });
    check("④a 无 token → 401", noTokenRes.status === 401, `status=${noTokenRes.status}`);

    const expiredRes = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${expiredToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "x", stream: true, messages: [] }),
    });
    check("④b 过期 token → 401", expiredRes.status === 401, `status=${expiredRes.status}`);

    const wrongScopeRes = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${wrongScopeToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "x", stream: true, messages: [] }),
    });
    check("④c 错 scope token(llm:sufy 打 newapi)→ 403", wrongScopeRes.status === 403, `status=${wrongScopeRes.status}`);

    check(
      "④d 负路径:stub 零新增请求(代理短路,未转发)",
      stubRequests.length === requestCountBeforeNegative,
      `stub 请求总数 ${stubRequests.length}`,
    );

    // ── 断言⑤:aigc-proxy 已摘除,同前缀下路径 404 ─────────────────────────────
    const aigcProxyRes = await fetch(`${publicBase}/api/aigc-proxy/newapi/images/generations`, {
      method: "POST",
      headers: { authorization: `Bearer ${expiredToken}`, "content-type": "application/json" },
      body: "{}",
    });
    check("⑤ /api/aigc-proxy/* → 404(已摘除)", aigcProxyRes.status === 404, `status=${aigcProxyRes.status}`);
  } finally {
    clearTimeout(timeoutGuard);
    if (serverChild && serverChild.exitCode === null) serverChild.kill("SIGTERM");
    await new Promise((r) => stubServer.close(() => r()));
  }

  console.log("");
  if (failures.length > 0) {
    console.error(`✗ ${failures.length} 项断言失败:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("✓ 全部断言通过(LLM 网关三进程链核心安全性质 e2e,Task 4.1)");
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ e2e 脚本异常:", err);
  process.exit(1);
});
