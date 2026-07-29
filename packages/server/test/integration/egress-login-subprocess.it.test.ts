/**
 * 集成(真实 runner 子进程)— desktop-cloud-login 任务 7.2:登录态经 egress 出口全闭环
 * (Req 3.1/3.2/3.3/3.4/4.1/4.3/5.3/3.7/6.1)。
 *
 * 本 spec 范围内最强证据:真实拉起 runner 子进程(agent-routes-subprocess.test.ts 先例:
 * PiRpcProcess 持有子进程、PiSession 消费其 onLine),验证「本地 runner 登录态确实经 egress
 * 出口、携桌面凭据作 Bearer」——而非只在单测里验证纯函数。
 *
 * 两组 spawn:
 *  - 「登录态」组:spawn env 携 `PI_WEB_CLOUD_EGRESS_BASE`/`PI_WEB_DESKTOP_CREDENTIAL`/
 *    `PI_WEB_CLOUD_EGRESS_MODELS` 三件套(auth-egress-assembly.computeAuthEgressSpawnEnv 的
 *    下发契约),runner 内 `resolveEgressModelSourceFromEnv` 据此注入内存 ModelRegistry
 *    (option-mapper 已接线,§3.2)。settings.json 的 defaultProvider 指向注入的 `pi-cloud`
 *    provider —— **故意不写 models.json**:登录态经内存注入,SDK 默认路径完全不需要它。
 *  - 「未登录/未启用」对照组:spawn env 不携带上述三件套,agentDir 写本地 models.json 指向
 *    第二个本地 mock provider —— 断言 runner 打的是本地 mock 而非 stub egress,证明无 egress
 *    env 时字节级等价今日本地路径(Req 4.1)。
 *
 * 依赖:无外网、无真实凭据(桌面凭据仅本仓不验签的样例串,egress 侧不校验签名真伪);
 * `--agent-dir` 指向临时目录隔离全局 ~/.pi。
 *
 * Req 3.7(过期凭据 server 端不下发)属 pi-handler/auth-session-state 层,已被单测覆盖
 * (test/auth/auth-session-state.test.ts、test/auth/auth-routes.test.ts)—— 本集成层 SKIP,
 * 只在注释中说明,不重复断言装配层职责之外的行为。
 */
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SpawnSpec } from "@blksails/pi-web-protocol";
import { PiRpcProcess } from "../../src/rpc-channel/pi-rpc-process.js";
import { PiSession } from "../../src/session/pi-session.js";
import { makeResolved } from "../session/fixtures.js";
import { startStubEgress, type StubEgress } from "../auth/stub-egress.js";

const here = dirname(fileURLToPath(import.meta.url));
// test/integration -> packages/server
const serverPkgDir = join(here, "..", "..");
const runnerEntry = join(serverPkgDir, "src", "runner", "runner.ts");
const fixtureAgent = join(here, "fixtures", "egress-login-agent");

/** 造一枚桌面凭据串(credential.test.ts 先例):`base64url(JSON(payload)) + "." + sig`。 */
function makeDesktopCredential(): string {
  const payload = {
    userId: "user-egress-it",
    companyId: "co-egress-it",
    scope: "desktop",
    exp: 4_000_000_000, // 远期(2096),本仓不验签,egress-model-source 只取明文透传
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.itsig`;
}

const DESKTOP_CREDENTIAL = makeDesktopCredential();
const EGRESS_MODEL_ID = "egress-mock-model";

/** 本地对照组用的第二个 mock OpenAI provider(与 agent-routes-subprocess.test.ts 同构)。 */
interface LocalMockProvider {
  server: Server;
  port: number;
  calls: () => number;
}

function startLocalMockProvider(): Promise<LocalMockProvider> {
  let calls = 0;
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
          id: "chatcmpl-local-mock",
          object: "chat.completion.chunk",
          created: 0,
          model: "local-mock-model",
        };
        const send = (choices: unknown[], extra?: object): void => {
          res.write(`data: ${JSON.stringify({ ...base, choices, ...extra })}\n\n`);
        };
        send([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]);
        send([{ index: 0, delta: { content: "LOCALPATHTOKEN" }, finish_reason: null }]);
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
      resolve({ server, port, calls: () => calls });
    });
  });
}

/**
 * 登录态 agentDir:settings.json 指向注入的 `pi-cloud` provider;auth.json 空对象(共享
 * auth.json 复用路径);**不写 models.json**(登录态经内存注入,Req 5.3/4.3)。
 */
function makeLoggedInAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "egress-login-agentdir-"));
  const settings = {
    defaultProvider: "pi-cloud",
    defaultModel: EGRESS_MODEL_ID,
    packages: [],
    loadSystemSkills: false,
  };
  writeFileSync(join(dir, "settings.json"), JSON.stringify(settings, null, 2));
  writeFileSync(join(dir, "auth.json"), "{}\n");
  return dir;
}

/** 未登录/未启用对照组 agentDir:走今日本地路径,models.json 指向本地 mock provider。 */
function makeLocalAgentDir(localMockPort: number): string {
  const dir = mkdtempSync(join(tmpdir(), "egress-local-agentdir-"));
  const models = {
    providers: {
      local: {
        name: "Local (integration control group)",
        baseUrl: `http://127.0.0.1:${localMockPort}/v1`,
        apiKey: "local-mock-key",
        api: "openai-completions",
        models: [
          {
            id: "local-mock-model",
            name: "Local Mock Model",
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
    defaultProvider: "local",
    defaultModel: "local-mock-model",
    packages: [],
    loadSystemSkills: false,
  };
  writeFileSync(join(dir, "models.json"), JSON.stringify(models, null, 2));
  writeFileSync(join(dir, "settings.json"), JSON.stringify(settings, null, 2));
  writeFileSync(join(dir, "auth.json"), "{}\n");
  return dir;
}

async function waitFor(
  cond: () => boolean,
  what: string,
  stderrRef: { text: string },
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}\nstderr=${stderrRef.text}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

function spawnSpec(agentDir: string, cwdDir: string, extraEnv: Record<string, string>): SpawnSpec {
  return {
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
    // jiti/register 从 cwd 解析:必须以 server 包为 cwd(agent-routes-subprocess.test.ts 先例)。
    cwd: serverPkgDir,
    env: { ...process.env, ...extraEnv } as Record<string, string>,
  };
}

let stub: StubEgress;
let localMock: LocalMockProvider;

// ───────────────────────── 组 A:登录态(经 stub egress) ─────────────────────────
let loggedInCwd: string;
let loggedInAgentDir: string;
let loggedInChannel: PiRpcProcess;
let loggedInSession: PiSession;
const loggedInStderr = { text: "" };

// ───────────────────────── 组 B:未登录/未启用(本地路径对照组) ─────────────────────────
let localCwd: string;
let localAgentDir: string;
let localChannel: PiRpcProcess;
let localSession: PiSession;
const localStderr = { text: "" };

beforeAll(async () => {
  stub = await startStubEgress();
  localMock = await startLocalMockProvider();

  // 组 A:登录态 spawn env 携三件套(computeAuthEgressSpawnEnv 下发契约)。
  loggedInCwd = mkdtempSync(join(tmpdir(), "egress-login-cwd-"));
  loggedInAgentDir = makeLoggedInAgentDir();
  const loggedInEnv: Record<string, string> = {
    PI_WEB_CLOUD_EGRESS_BASE: stub.baseUrl,
    PI_WEB_DESKTOP_CREDENTIAL: DESKTOP_CREDENTIAL,
    PI_WEB_CLOUD_EGRESS_MODELS: JSON.stringify([{ id: EGRESS_MODEL_ID, name: "Egress Mock" }]),
  };
  loggedInChannel = new PiRpcProcess(spawnSpec(loggedInAgentDir, loggedInCwd, loggedInEnv));
  loggedInChannel.onStderr((chunk) => {
    loggedInStderr.text += chunk;
  });
  loggedInSession = new PiSession({
    id: "egress-login-it-1",
    resolved: makeResolved(),
    channel: loggedInChannel,
    idleMs: 0,
  });
  // 就绪锚点:runRpcMode 已接管并应答 RPC。
  const loggedInCommands = await loggedInSession.getCommands();
  expect(loggedInCommands.success).toBe(true);

  // 组 B:未登录/未启用 —— spawn env 不携带 egress 三件套。
  localCwd = mkdtempSync(join(tmpdir(), "egress-local-cwd-"));
  localAgentDir = makeLocalAgentDir(localMock.port);
  localChannel = new PiRpcProcess(spawnSpec(localAgentDir, localCwd, {}));
  localChannel.onStderr((chunk) => {
    localStderr.text += chunk;
  });
  localSession = new PiSession({
    id: "egress-login-it-2",
    resolved: makeResolved(),
    channel: localChannel,
    idleMs: 0,
  });
  const localCommands = await localSession.getCommands();
  expect(localCommands.success).toBe(true);
}, 60_000);

afterAll(async () => {
  await loggedInSession?.stop().catch(() => undefined);
  await localSession?.stop().catch(() => undefined);
  await stub?.close();
  await new Promise<void>((r) => localMock?.server.close(() => r()) ?? r());
  for (const dir of [loggedInCwd, loggedInAgentDir, localCwd, localAgentDir]) {
    try {
      if (dir) rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort 清理
    }
  }
}, 30_000);

function chunkTypes(session: PiSession): Promise<{ types: string[]; deltas: string[] }> {
  const types: string[] = [];
  const deltas: string[] = [];
  return new Promise((resolve) => {
    const unsub = session.subscribe((f) => {
      if (f.kind !== "uiMessageChunk") return;
      types.push(f.chunk.type);
      if (f.chunk.type === "text-delta") deltas.push(f.chunk.delta);
      if (f.chunk.type === "finish") {
        unsub.unsubscribe();
        resolve({ types, deltas });
      }
    });
  });
}

describe("desktop-cloud-login — egress 登录态全闭环(Task 7.2)", () => {
  it("① 登录态:真 prompt turn 经 stub egress,Bearer=桌面凭据、baseUrl=egress(Req 3.1/3.2)", async () => {
    expect(stub.requests()).toHaveLength(0);

    const streamPromise = chunkTypes(loggedInSession);
    const promptRes = await loggedInSession.prompt("say the egress token");
    expect(promptRes.success).toBe(true);
    const { types, deltas } = await streamPromise;

    // ② 流式 assistant 回复经 runner 回到 PiSession(Req 3.4)。
    expect(types).toContain("text-delta");
    expect(deltas.join("")).toContain("STUBEGRESSTOKEN");

    expect(stub.requests().length).toBeGreaterThanOrEqual(1);
    const req = stub.requests()[0];
    expect(req?.authorization).toBe(`Bearer ${DESKTOP_CREDENTIAL}`);

    // 打的确实是 stub egress,本地对照组的 mock 未被调用。
    expect(localMock.calls()).toBe(0);
  }, 40_000);

  it("③ 内存注入零落盘:登录态 agentDir 下 models.json 全程未被写入(Req 5.3/4.3)", () => {
    expect(existsSync(join(loggedInAgentDir, "models.json"))).toBe(false);
  });

  it("④ 未登录/未启用对照组:runner 走本地 models.json 路径,不触达 stub egress(Req 4.1)", async () => {
    const beforeStubCalls = stub.requests().length;

    const streamPromise = chunkTypes(localSession);
    const promptRes = await localSession.prompt("say the local token");
    expect(promptRes.success).toBe(true);
    const { deltas } = await streamPromise;

    expect(deltas.join("")).toContain("LOCALPATHTOKEN");
    expect(localMock.calls()).toBeGreaterThanOrEqual(1);
    // 对照组的请求没有打到 stub egress —— 两条出口互不串扰。
    expect(stub.requests().length).toBe(beforeStubCalls);
  }, 40_000);

  it.skip(
    "⑤ 凭据过期:server 不下发 spawn env(Req 3.7)—— 属 pi-handler/auth-session-state 装配层职责," +
      "已被 test/auth/auth-session-state.test.ts、test/auth/auth-routes.test.ts 单测覆盖;" +
      "本集成层不重复起第三个真实子进程验证同一装配期分支(SKIP,原因见上)。",
    () => {},
  );
});
