/**
 * 集成(真实 runner 子进程)— agent-attachment-catalog busy 并发与 publish(spec
 * agent-attachment-catalog,任务 7.2;Req 2.3, 4.1, 4.2, 4.4)。
 *
 * - busy 并发:真 prompt turn 进行中(mock provider 流握住不收尾,`session.snapshot.busy`
 *   为 true 期间)调用 `session.requestCatalog({op:"list"})` —— 仍同步应答(list 走独立
 *   请求/结果帧通道,不经 prompt 通路,agent-routes 同结构性保证)。
 * - publish 集成:子进程经 `publish-demo` route 调用 `ctx.publish` → fd1 写
 *   `piweb_attachment_event` 帧 → 主进程 `PiSession` 转发 SSE `control:"attachment"` →
 *   落库件按 id 可分发(同等待遇,标准 att_ id)。
 */
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SpawnSpec, SseFrame } from "@blksails/pi-web-protocol";
import { PiRpcProcess } from "../../src/rpc-channel/pi-rpc-process.js";
import { PiSession } from "../../src/session/pi-session.js";
import { attachmentStoreConfigFromEnv } from "../../src/attachment/config.js";
import { makeResolved } from "../session/fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverPkgDir = join(here, "..", "..");
const runnerEntry = join(serverPkgDir, "src", "runner", "runner.ts");
const fixtureAgent = join(
  serverPkgDir,
  "test",
  "runner",
  "fixtures",
  "attachment-catalog-publish-e2e-agent",
);

// ───────────────────────── mock OpenAI provider(busy 装置,agent-routes-subprocess 先例) ─────────────────────────

interface MockProvider {
  server: Server;
  port: number;
  held: () => number;
  releaseAll: () => void;
}

function startMockProvider(): Promise<MockProvider> {
  const finishers = new Set<() => void>();
  const server = createServer((req, res) => {
    if (req.method === "POST" && /\/chat\/completions/.test(req.url ?? "")) {
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const base = { id: "chatcmpl-mock", object: "chat.completion.chunk", created: 0, model: "mock-model" };
        const send = (choices: unknown[], extra?: object): void => {
          res.write(`data: ${JSON.stringify({ ...base, choices, ...extra })}\n\n`);
        };
        send([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]);
        send([{ index: 0, delta: { content: "CATALOGBUSYTOKEN" }, finish_reason: null }]);
        const finish = (): void => {
          if (!finishers.delete(finish)) return;
          clearTimeout(safety);
          send([{ index: 0, delta: {}, finish_reason: "stop" }]);
          send([], { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
          res.write("data: [DONE]\n\n");
          res.end();
        };
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
        held: () => finishers.size,
        releaseAll: () => {
          for (const f of [...finishers]) f();
        },
      });
    });
  });
}

function makeAgentDir(mockPort: number): string {
  const dir = mkdtempSync(join(tmpdir(), "catalog-busy-agentdir-"));
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

let mock: MockProvider;
let cwdDir: string;
let agentDir: string;
let attachDir: string;
let channel: PiRpcProcess;
let session: PiSession;

const SECRET = "attachment-catalog-busy-publish-secret-0123456789";

async function waitFor(cond: () => boolean, what: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  mock = await startMockProvider();
  cwdDir = mkdtempSync(join(tmpdir(), "catalog-busy-cwd-"));
  agentDir = makeAgentDir(mock.port);
  attachDir = mkdtempSync(join(tmpdir(), "catalog-busy-store-"));

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
    cwd: serverPkgDir,
    env: {
      ...process.env,
      PI_WEB_ATTACHMENT_DIR: attachDir,
      PI_WEB_ATTACHMENT_SECRET: SECRET,
    } as Record<string, string>,
  };
  channel = new PiRpcProcess(spec);
  session = new PiSession({
    id: "attcatalog-busy-0",
    resolved: makeResolved(),
    channel: channel as unknown as import("../../src/session/session.types.js").SessionChannel,
    idleMs: 0,
    readinessHandshake: true,
    readinessProbeTimeoutMs: 15_000,
  });
  await waitFor(() => session.lifecycle === "ready", "session ready");
  await waitFor(() => session.attachmentCatalogAvailable, "catalog declaration frame cached");
}, 40_000);

afterAll(async () => {
  await session?.stop("shutdown").catch(() => undefined);
  await new Promise((r) => mock.server.close(() => r(undefined)));
  for (const dir of [cwdDir, agentDir, attachDir]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("agent-attachment-catalog — busy 并发(Req 2.3)", () => {
  it("推理中(mock 流握住)list 仍同步应答", async () => {
    expect(session.snapshot.busy).toBe(false);
    const promptPromise = session.prompt("say the busy token");
    await waitFor(
      () => session.snapshot.busy && mock.held() >= 1,
      "snapshot.busy=true + mock stream held",
    );

    const listRes = await session.requestCatalog({ op: "list", query: "" });
    expect(listRes.ok).toBe(true);
    expect(listRes.entries).toEqual([{ id: "entry-1", name: "Report", version: "v1" }]);
    expect(session.snapshot.busy).toBe(true); // 仍在忙碌中,证明 list 未等轮次结束

    mock.releaseAll();
    await waitFor(() => !session.snapshot.busy, "snapshot.busy=false (agent_end)", 30_000);
    await promptPromise;
  }, 45_000);
});

describe("agent-attachment-catalog — publish 集成(Req 4.1/4.2/4.4)", () => {
  it("publish → 主进程收事件帧转 SSE control:attachment;落库件可分发", async () => {
    const frames: SseFrame[] = [];
    const unsub = session.subscribe((f) => frames.push(f));

    const res = await session.invokeAgentRoute("publish-demo", { method: "POST", query: {} });
    expect(res.ok).toBe(true);
    const result = res.result as { ok: boolean; attachmentId?: string };
    expect(result.ok).toBe(true);
    expect(result.attachmentId).toMatch(/^att_/);

    await waitFor(
      () =>
        frames.some(
          (f) =>
            f.kind === "control" &&
            (f as { payload?: { control?: string } }).payload?.control === "attachment",
        ),
      "control:attachment frame received",
    );
    const controlFrame = frames.find(
      (f) =>
        f.kind === "control" &&
        (f as { payload?: { control?: string } }).payload?.control === "attachment",
    ) as { payload: { event: string; attachment: { id: string } } };
    expect(controlFrame.payload.event).toBe("added");
    expect(controlFrame.payload.attachment.id).toBe(result.attachmentId);
    unsub.unsubscribe();

    // 落库件按 id 可分发(同等待遇,标准 att_ id)。
    const { store } = attachmentStoreConfigFromEnv({
      PI_WEB_ATTACHMENT_DIR: attachDir,
      PI_WEB_ATTACHMENT_SECRET: SECRET,
    });
    const head = await store.head(result.attachmentId!);
    expect(head?.name).toBe("pushed.txt");
  }, 30_000);
});
