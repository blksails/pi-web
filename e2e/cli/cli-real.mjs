#!/usr/bin/env node
/**
 * CLI 真实模式 e2e(spec pi-web-cli, real-runner 验收)。可重复运行,产出新鲜证据。
 *
 * 为什么需要它:`cli-smoke.mjs` 用 `--stub`,绕过真实 runner 子进程,因此测不到
 * standalone 产物里 runner-bootstrap → jiti → pi SDK 传递依赖的解析(这正是
 * fix/standalone-realmode-resolution 修的「建会话即崩」根因)。本测试**不带 --stub**,
 * 真实 spawn runner,但把 LLM 指向本地 mock(openai-completions 协议),从而:
 *   - 真正走通 runner 子进程 + 依赖解析(产物正确性的核心证据);
 *   - 不依赖外网 / 真实凭据,跨平台 CI 可稳定重复运行。
 *
 * 机制:
 *   1. 起一个 mock OpenAI Chat Completions SSE 服务(确定性回包)。
 *   2. 写一个临时 agent-dir,models.json 指向 mock,settings.json 设其为默认模型。
 *   3. CLI 以 `--agent-dir <tmp>` 启动(无 --stub)→ runner 子进程读该配置 → 调 mock。
 *   4. 浏览器 autostart 建会话 → 发消息 → 断言收到 mock 的真实流式回包。
 *   5. 断言 mock 至少被请求一次(证明真实 runner 链路全程打通)。
 *
 * 前置:`pnpm build:cli`(standalone 产物)。
 * 跑法:`pnpm e2e:cli:real`(或 `node e2e/cli/cli-real.mjs`)。
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { get as httpGet } from "node:http";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = process.env.NEXT_DIST_DIR ?? ".next-cli";
const BIN = join(ROOT, "bin", "pi-web.mjs");
const PORT = 3473;
const BASE = `http://127.0.0.1:${PORT}`;
const EVIDENCE = join(ROOT, ".kiro/specs/pi-web-cli/evidence/cli-real-repeatable.png");

// 确定性回包 token:无空格/markdown 特殊字符,断言时不会被分词或转义打断。
const REPLY_TOKEN = "PIWEBREALMODEOK";

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failures.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((res, rej) => {
    const tick = () => {
      const req = httpGet(`${BASE}/`, (r) => {
        r.resume();
        res();
      });
      req.on("error", () =>
        Date.now() > deadline ? rej(new Error("就绪超时")) : setTimeout(tick, 300),
      );
    };
    tick();
  });
}

/**
 * mock OpenAI Chat Completions：对 POST .../chat/completions 返回确定性 SSE 流。
 * pi-ai 的 openai-completions provider 用官方 openai SDK 解析标准 chunk
 * (choices[0].delta.content / finish_reason / [DONE]),故此处严格按该格式输出。
 */
function startMockProvider() {
  let calls = 0;
  const server = createServer((req, res) => {
    if (req.method === "POST" && /\/chat\/completions/.test(req.url ?? "")) {
      calls += 1;
      // 读并丢弃请求体(避免半开连接)。
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const id = "chatcmpl-mock";
        const base = { id, object: "chat.completion.chunk", created: 0, model: "mock-model" };
        const send = (choices, extra) =>
          res.write(`data: ${JSON.stringify({ ...base, choices, ...extra })}\n\n`);
        send([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]);
        send([{ index: 0, delta: { content: REPLY_TOKEN }, finish_reason: null }]);
        send([{ index: 0, delta: {}, finish_reason: "stop" }]);
        send([], { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((res) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      res({ server, port, getCalls: () => calls });
    });
  });
}

/** 写一个最小临时 agent-dir,把默认模型指向 mock。 */
function makeAgentDir(mockPort) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-real-"));
  const models = {
    providers: {
      mock: {
        name: "Mock (e2e)",
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
    packages: [], // 不加载任何 pi 包,免去 CI 内安装/沙箱依赖。
    loadSystemSkills: false,
  };
  writeFileSync(join(dir, "models.json"), JSON.stringify(models, null, 2));
  writeFileSync(join(dir, "settings.json"), JSON.stringify(settings, null, 2));
  writeFileSync(join(dir, "auth.json"), "{}\n"); // 自定义 provider 凭据在 models.json,此处占位。
  return dir;
}

async function main() {
  // 1) 产物存在性(缺则直接退出,提示先构建)
  const SA = join(ROOT, DIST, "standalone");
  if (!existsSync(join(SA, "server.js"))) {
    console.error("产物缺失,请先 `pnpm build:cli`");
    process.exit(1);
  }

  const mock = await startMockProvider();
  const agentDir = makeAgentDir(mock.port);

  let stderr = "";
  const cli = spawn(
    "node",
    [BIN, "./examples/hello-agent", "--agent-dir", agentDir, "-p", String(PORT)],
    { cwd: ROOT, env: { ...process.env, NEXT_DIST_DIR: DIST } },
  );
  cli.stdout.on("data", (d) => process.stdout.write(d));
  cli.stderr.on("data", (d) => {
    stderr += d.toString();
    process.stderr.write(d);
  });

  let browser;
  try {
    await waitReady(60_000);
    check("CLI 启动 standalone 并就绪", true);

    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    // autostart:CLI 注入 PI_WEB_AUTOSTART=1 + 默认 source,前端跳过选源页直接建会话。
    await page.waitForSelector("[data-pi-input-textarea]", { timeout: 20_000 });
    check("默认 source 自动激活真实会话(无 SESSION_NOT_FOUND)", /\/session\//.test(page.url()));

    await page.fill("[data-pi-input-textarea]", "say the magic token");
    await page.getByRole("button", { name: "发送" }).click();

    // 断言收到 mock 的真实流式回包(经真实 runner 子进程 → pi SDK → mock provider)。
    const got = await page
      .waitForFunction(
        (tok) => document.body.innerText.includes(tok),
        REPLY_TOKEN,
        { timeout: 30_000 },
      )
      .then(() => true)
      .catch(() => false);
    check("收到真实 runner 经 mock provider 的流式回包", got);

    // 真实链路打通的硬证据:mock 至少被请求一次(stub 模式永不触发)。
    check("mock provider 被真实 runner 调用(≥1 次)", mock.getCalls() >= 1);

    await page.screenshot({ path: EVIDENCE, fullPage: true });
    console.log(`证据截图: ${EVIDENCE}`);
  } catch (err) {
    check(`真实模式 e2e: ${err.message}`, false);
  } finally {
    if (browser) await browser.close();
    cli.kill("SIGINT");
    await sleep(500);
    mock.server.close();
    try {
      rmSync(agentDir, { recursive: true, force: true });
    } catch {
      // best-effort 清理。
    }
  }

  // 把 runner 崩溃信号显式暴露(便于 CI 排查)。
  if (/SESSION_NOT_FOUND|Cannot find module|ERR_MODULE_NOT_FOUND/.test(stderr)) {
    check("runner 子进程无依赖解析/会话崩溃错误", false);
  }

  console.log(failures.length ? `\nFAIL: ${failures.length} 项` : "\nPASS: 全部通过");
  process.exit(failures.length ? 1 : 0);
}

main();
