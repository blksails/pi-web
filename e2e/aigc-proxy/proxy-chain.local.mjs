#!/usr/bin/env node
/**
 * aigc-key-proxy e2e(spec aigc-key-proxy,Task 5.1)——「方案 A」安全性质的端到端证明,
 * 无 e2b 依赖(真实沙盒回归见 `e2e:sandbox-browser` / Task 5.3,条件跑)。
 *
 * 跑法:`pnpm e2e:aigc-proxy`(或 `node e2e/aigc-proxy/proxy-chain.local.mjs`)。
 *
 * 拓扑(三个真实进程 + 一个真实 TCP stub,均非共享内存):
 *
 *   sandbox-child.ts(独立子进程,env 白名单——无真实 key)
 *        │ POST http://127.0.0.1:<serverPort>/aigc-proxy/newapi/images/generations
 *        │ Authorization: Bearer <session-token>              (真实 HTTP #1)
 *        ▼
 *   server-entry.ts(真实 pi-web server 最小装配,env 含真实 NEWAPI_API_KEY)
 *        │ createAigcProxyRoutes:token 校验 → 查 env 换真实 key → 转发
 *        │ Authorization: Bearer sk-real-e2e                    (真实 HTTP #2)
 *        ▼
 *   stub 上游(本进程内 node:http,记录收到的 authorization 头)
 *
 * 断言:
 *   ① 产物 b64 正确回传(sandbox-child 自 stub 固定 b64 拿回 data:image/png;base64,... )
 *   ② stub 收到且仅收到 `Bearer sk-real-e2e`(真实 key 只在 server↔stub 段出现)
 *   ③ sandbox-child 进程 env 全程无 `sk-real-e2e`(子进程自检 + 编排侧构造的 env 白名单自证)
 *   ④ 负路径:过期 token → sandbox-child 收到 401 错误语义,且 stub 零新增请求
 *
 * 形态取舍:代理链路(sandbox-child → server-entry → stub)全程真实 TCP,三个独立进程。
 * server-entry 是"最小装配"而非完整 `server/index.ts`(后者需要 agent-source 解析等与本任务
 * 无关的重依赖);它复用 `packages/server/test/aigc-proxy/proxy-routes.integration.test.ts` 的
 * `createPiWebHandler + createAigcProxyRoutes(secret, fetchImpl)` 最小装配惯例,只是把
 * "同进程直调 handler(Request)" 换成 "@hono/node-server 起真实监听端口",使 sandbox-child
 * 与 server 之间是真实进程边界(而非共享内存的函数调用)。`fetchImpl` 的 origin 重写是
 * `createAigcProxyRoutes` 本就开放的测试接缝(生产代码 proxy-routes.ts 零改动)。
 *
 * TS 子进程加载:与仓内 `scripts/dev-all.mjs` 同一惯例 ——
 * `node --import <jiti-register> <entry.ts>`(pnpm 虚拟存储路径,非包名解析,跨 tool-kit/
 * server 两个 workspace 包通用)。
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
const SERVER_ENTRY = join(ROOT, "e2e/aigc-proxy/server-entry.ts");
const SANDBOX_CHILD = join(ROOT, "e2e/aigc-proxy/sandbox-child.ts");

const REAL_KEY = "sk-real-e2e";
const PROXY_SECRET = `e2e-secret-${randomBytes(8).toString("hex")}`;
// 固定小图 b64(任意合法 base64 即可,本用例不校验像素内容,只校验"原样回传")。
const FIXED_B64 = Buffer.from("pi-web-aigc-proxy-e2e-fixture").toString("base64");

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
    req.on("end", () => {
      stubRequests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
      });
      if (req.url === "/v1/images/generations" && req.headers.authorization === `Bearer ${REAL_KEY}`) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ b64_json: FIXED_B64 }] }));
        return;
      }
      // 未按预期携带真实 key(或路径不符)→ 500,暴露给上层代理透传(不代表代理本身的错误)。
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "stub: unexpected auth or path" } }));
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

/** 起 server-entry.ts 子进程,解析首行 `PROXY_CHAIN_READY <json>`。 */
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
          PROXY_SECRET,
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
      const m = /PROXY_CHAIN_READY (\{.*\})/.exec(stdoutBuf);
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
function runSandboxChild({ baseUrl, apiKey }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", JITI_REGISTER, SANDBOX_CHILD],
      {
        cwd: ROOT,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          NEWAPI_BASE_URL: baseUrl,
          NEWAPI_API_KEY: apiKey,
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
    const baseUrl = `http://127.0.0.1:${ready.port}/aigc-proxy/newapi`;

    // ── 编排侧自证:传给 sandbox-child 的 env 白名单本就不含真实 key 字面量 ──────
    const sandboxEnvValid = { NEWAPI_BASE_URL: baseUrl, NEWAPI_API_KEY: ready.validToken };
    check(
      "编排侧:sandbox-child env 白名单不含真实 key 字面量(有效 token 用例)",
      !Object.values(sandboxEnvValid).some((v) => v.includes(REAL_KEY)),
    );

    // ── 正路径:有效 token ────────────────────────────────────────────────────
    const okResult = await runSandboxChild({ baseUrl, apiKey: ready.validToken });
    // 精确比较(非仅形状检查):isDataUri 布尔值只证明"看起来像 data URI",不能排除代理
    // 流式转发把字节转坏但仍产出语法合法 base64 的情形——须与 stub 的已知 FIXED_B64
    // fixture 逐字节相等。
    const expectedUrl = `data:image/png;base64,${FIXED_B64}`;
    check(
      "① 产物 b64 与 stub fixture 逐字节精确一致(非仅形状检查)",
      okResult.ok === true && okResult.isDataUri === true && okResult.url === expectedUrl,
      JSON.stringify(okResult),
    );
    check(
      "② stub 收到且仅收到 Bearer sk-real-e2e",
      stubRequests.length === 1 && stubRequests[0].authorization === `Bearer ${REAL_KEY}`,
      JSON.stringify(stubRequests),
    );
    check("③ 子进程自检:env 全程无真实 key", okResult.envLeak === false, JSON.stringify(okResult));

    // ── 负路径:过期 token → 401 语义,stub 零新增请求 ──────────────────────────
    const requestCountBeforeExpired = stubRequests.length;
    const expiredResult = await runSandboxChild({ baseUrl, apiKey: ready.expiredToken });
    check(
      "④ 过期 token → 子进程收到 401 错误语义",
      expiredResult.ok === false && /\b401\b/.test(expiredResult.error ?? ""),
      JSON.stringify(expiredResult),
    );
    check(
      "④b 过期 token 路径:stub 零新增请求(代理短路,未转发)",
      stubRequests.length === requestCountBeforeExpired,
      `stub 请求总数 ${stubRequests.length}`,
    );
    check("③b 过期 token 用例:子进程自检 env 全程无真实 key", expiredResult.envLeak === false);
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
  console.log("✓ 全部断言通过(aigc-key-proxy 核心链路 e2e,Task 5.1)");
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ e2e 脚本异常:", err);
  process.exit(1);
});
