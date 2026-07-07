/**
 * 集成(真实 runner 子进程)— agent 声明式 routes 全闭环(agent-declared-routes, Task 5.1)。
 *
 * 把真实 runner 作为子进程拉起(`startRunner` 内 wireAgentRoutesBridge 已装配,fixture
 * routes-e2e-agent 声明 gallery-stats/echo/boom/slow 四个 route),由 **PiRpcProcess 持有
 * 子进程、PiSession 消费其 onLine**,验证任务面全闭环:
 *
 *   声明帧(装配期 stdout)→ PiSession.handleRawLine 缓存(agentRoutes)
 *   → invokeAgentRoute(stdin 请求帧)→ 子进程 handler 执行
 *   → **fd1 直写**结果帧(runRpcMode `takeOverStdout()` 劫持 process.stdout 后,
 *     `fs.writeSync(1)` 是唯一能回到主进程的通路——此坑仅真实子进程层能验,stub 抓不到)
 *   → handleRawLine 按 id 配对 resolve。
 *
 * busy 场景:models.json 指向本测试自起的 mock OpenAI SSE 服务(cli-real.mjs 先例),
 * mock 把流**握住不收尾** → 真 prompt turn 进行中(snapshot.busy=true)调用 route,
 * 断言仍同步返回(invokeAgentRoute 不 gate busy,Req 5.1)。
 *
 * 依赖:无外网、无真实凭据;`--agent-dir` 指向临时目录隔离全局 ~/.pi。
 */
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SpawnSpec } from "@blksails/pi-web-protocol";
import { PiRpcProcess } from "../../src/rpc-channel/pi-rpc-process.js";
import { PiSession } from "../../src/session/pi-session.js";
import { makeResolved } from "../session/fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
// test/integration -> packages/server
const serverPkgDir = join(here, "..", "..");
const runnerEntry = join(serverPkgDir, "src", "runner", "runner.ts");
const fixtureAgent = join(
  serverPkgDir,
  "test",
  "runner",
  "fixtures",
  "routes-e2e-agent",
);

// ───────────────────────── mock OpenAI provider(busy 装置) ─────────────────────────

interface MockProvider {
  server: Server;
  port: number;
  calls: () => number;
  /** 当前被握住(未收尾)的流数量。 */
  held: () => number;
  /** 收尾所有被握住的流(finish_reason stop + [DONE])。 */
  releaseAll: () => void;
}

/**
 * mock OpenAI Chat Completions(cli-real.mjs 先例):对 POST .../chat/completions
 * 先发 role/content delta 但**不收尾**,把 finisher 存起来由测试显式 release ——
 * 在 release 前,pi 的 turn 一直进行中(busy)。12s 安全阀自动收尾防悬挂。
 */
function startMockProvider(): Promise<MockProvider> {
  let calls = 0;
  const finishers = new Set<() => void>();
  const server = createServer((req, res) => {
    if (req.method === "POST" && /\/chat\/completions/.test(req.url ?? "")) {
      calls += 1;
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const base = {
          id: "chatcmpl-mock",
          object: "chat.completion.chunk",
          created: 0,
          model: "mock-model",
        };
        const send = (choices: unknown[], extra?: object): void => {
          res.write(`data: ${JSON.stringify({ ...base, choices, ...extra })}\n\n`);
        };
        send([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]);
        send([{ index: 0, delta: { content: "ROUTESBUSYTOKEN" }, finish_reason: null }]);
        const finish = (): void => {
          if (!finishers.delete(finish)) return; // 幂等
          clearTimeout(safety);
          send([{ index: 0, delta: {}, finish_reason: "stop" }]);
          send([], { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
          res.write("data: [DONE]\n\n");
          res.end();
        };
        // 安全阀:测试异常路径下 12s 自动收尾,避免子进程/测试互相悬挂。
        const safety = setTimeout(finish, 12_000);
        finishers.add(finish);
      });
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({
        server,
        port,
        calls: () => calls,
        held: () => finishers.size,
        releaseAll: () => {
          for (const f of [...finishers]) f();
        },
      });
    });
  });
}

/** 写最小临时 agent-dir:models.json/settings.json 指向 mock(cli-real.mjs 先例)。 */
function makeAgentDir(mockPort: number): string {
  const dir = mkdtempSync(join(tmpdir(), "routes-runner-agentdir-"));
  const models = {
    providers: {
      mock: {
        name: "Mock (integration)",
        baseUrl: `http://127.0.0.1:${mockPort}/v1`,
        apiKey: "mock-key",
        api: "openai-completions",
        models: [
          {
            id: "mock-model",
            name: "Mock Model",
            reasoning: false,
            input: ["text"],
            contextWindow: 8192,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  };
  const settings = {
    defaultProvider: "mock",
    defaultModel: "mock-model",
    packages: [],
    loadSystemSkills: false,
  };
  writeFileSync(join(dir, "models.json"), JSON.stringify(models, null, 2));
  writeFileSync(join(dir, "settings.json"), JSON.stringify(settings, null, 2));
  writeFileSync(join(dir, "auth.json"), "{}\n");
  return dir;
}

// ───────────────────────── 共享装置(单次真实子进程 boot) ─────────────────────────

let mock: MockProvider;
let cwdDir: string;
let agentDir: string;
let channel: PiRpcProcess;
let session: PiSession;
let stderrBuf = "";

async function waitFor(
  cond: () => boolean,
  what: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}\nstderr=${stderrBuf}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  mock = await startMockProvider();
  cwdDir = mkdtempSync(join(tmpdir(), "routes-runner-cwd-"));
  agentDir = makeAgentDir(mock.port);

  const spec: SpawnSpec = {
    cmd: process.execPath,
    args: [
      "--import",
      "jiti/register",
      runnerEntry,
      "--agent",
      fixtureAgent,
      "--cwd",
      cwdDir,
      "--agent-dir",
      agentDir,
    ],
    // jiti/register 从 cwd 解析:必须以 server 包为 cwd(state-bridge 先例)。
    cwd: serverPkgDir,
    env: { ...process.env } as Record<string, string>,
  };
  channel = new PiRpcProcess(spec);
  channel.onStderr((chunk) => {
    stderrBuf += chunk;
  });
  session = new PiSession({
    id: "routes-int-1",
    resolved: makeResolved(),
    channel,
    idleMs: 0,
  });

  // 就绪锚点 1:装配期声明帧已被 PiSession 缓存(经 onLine→handleRawLine)。
  await waitFor(() => session.agentRoutes.length > 0, "agent_routes declaration frame");
  // 就绪锚点 2:runRpcMode 已接管并应答 RPC —— 此后 stdout 被 takeOverStdout 劫持,
  // 后续所有结果帧只能经 fs.writeSync(1) 直写 fd1 回到主进程(本层核心验证点)。
  const commands = await session.getCommands();
  expect(commands.success).toBe(true);
}, 60_000);

afterAll(async () => {
  await session?.stop().catch(() => undefined);
  mock?.releaseAll();
  await new Promise<void>((r) => mock?.server.close(() => r()) ?? r());
  for (const dir of [cwdDir, agentDir]) {
    try {
      if (dir) rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort 清理
    }
  }
}, 30_000);

// ───────────────────────── 断言面 ─────────────────────────

describe("agent-declared-routes — 真实 runner 子进程全闭环 (Task 5.1, Req 5.1/7.3)", () => {
  it("① 声明帧被 PiSession 缓存:agentRoutes 含 fixture 的纯数据投影(handler 不过界)", () => {
    const byName = new Map(session.agentRoutes.map((r) => [r.name, r]));
    expect([...byName.keys()].sort()).toEqual(["boom", "echo", "gallery-stats", "slow"]);
    expect(byName.get("gallery-stats")).toEqual({
      name: "gallery-stats",
      methods: ["GET"],
      description: "Gallery statistics (fixture)",
    });
    expect(byName.get("echo")?.methods).toEqual(["POST"]);
    // 纯数据投影:声明表条目不携带 handler 字段(函数不过进程边界)。
    for (const decl of session.agentRoutes) {
      expect("handler" in decl).toBe(false);
    }
  });

  it("② GET 闭环:invokeAgentRoute → handler 执行 → fd1 结果帧 → resolve(ok:true + query 透传)", async () => {
    const res = await session.invokeAgentRoute("gallery-stats", {
      method: "GET",
      query: { probe: "x1" },
    });
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({
      images: 3,
      source: "routes-e2e-agent",
      query: { probe: "x1" },
    });
  });

  it("③ POST 闭环:body 经请求帧过界并回显", async () => {
    const body = { hello: "world", n: 42, nested: { arr: [1, 2, 3] } };
    const res = await session.invokeAgentRoute("echo", {
      method: "POST",
      query: {},
      body,
    });
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({ method: "POST", received: body });
  });

  it("④ handler 抛错 → ok:false handler_error(含消息),runner 不崩", async () => {
    const res = await session.invokeAgentRoute("boom", { method: "GET", query: {} });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("handler_error");
    expect(res.error?.message).toContain("boom: intentional fixture failure");

    // 子进程未崩:RPC 与 route 均继续可用。
    const after = await session.invokeAgentRoute("gallery-stats", {
      method: "GET",
      query: {},
    });
    expect(after.ok).toBe(true);
  });

  it("⑤ 并发两请求独立配对:slow 在途时 fast 先返回,互不串扰(不排队)", async () => {
    const slow = session.invokeAgentRoute("slow", {
      method: "GET",
      query: { ms: "800" },
    });
    const fast = session.invokeAgentRoute("gallery-stats", {
      method: "GET",
      query: { probe: "concurrent" },
    });
    // fast 必须先收敛(子进程 async 并发派发,不被 slow 阻塞)。
    const first = await Promise.race([
      slow.then(() => "slow"),
      fast.then(() => "fast"),
    ]);
    expect(first).toBe("fast");

    const [slowRes, fastRes] = await Promise.all([slow, fast]);
    expect(slowRes.ok).toBe(true);
    expect(slowRes.result).toEqual({ slept: 800 });
    expect(fastRes.ok).toBe(true);
    expect(fastRes.result).toEqual({
      images: 3,
      source: "routes-e2e-agent",
      query: { probe: "concurrent" },
    });
  });

  it("⑥ busy 场景:真 prompt turn 进行中(mock 流握住不收尾)route 仍同步返回", async () => {
    expect(session.snapshot.busy).toBe(false);

    // 发真 prompt:preflight 成功即 resolve;turn 经 mock provider 流式进行中。
    const promptPromise = session.prompt("say the busy token");
    // agent_start(busy=true)与 LLM HTTP 请求到达 mock 有间隙:等到流真被握住为止。
    await waitFor(
      () => session.snapshot.busy && mock.held() >= 1,
      "snapshot.busy=true + mock stream held (turn in flight)",
      30_000,
    );
    expect(mock.calls()).toBeGreaterThanOrEqual(1);

    // prompt 流进行中调用 route —— 仍同步返回(invokeAgentRoute 不 gate busy)。
    const res = await session.invokeAgentRoute("gallery-stats", {
      method: "GET",
      query: { during: "busy" },
    });
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({
      images: 3,
      source: "routes-e2e-agent",
      query: { during: "busy" },
    });
    // route 收敛时 turn 仍在进行(流仍被握住)→ 证明未被 prompt 流阻塞/排队。
    expect(session.snapshot.busy).toBe(true);
    expect(mock.held()).toBeGreaterThanOrEqual(1);

    // 收尾:放流 → turn 结束 → busy 复位;prompt 命令本身成功。
    mock.releaseAll();
    await waitFor(() => !session.snapshot.busy, "snapshot.busy=false (agent_end)", 30_000);
    const promptRes = await promptPromise;
    expect(promptRes.success).toBe(true);
  }, 40_000);

  it("⑦ 回归:多次 route 往返后 RPC 流未被污染(get_state 仍正常应答)", async () => {
    const state = await session.getState();
    expect(state.success).toBe(true);
  });
});
