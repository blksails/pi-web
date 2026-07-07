#!/usr/bin/env node
/**
 * 桌面版启动闭环 + 真实会话 e2e(spec pi-web-desktop task 4.2)。可重复,产出新鲜证据。
 *
 * 用 Playwright 的 `_electron` 驱动**真实 Electron 壳**(未打包,指向预构建 standalone),
 * 证明整条桌面机制端到端可用:
 *   Electron 主进程 → 以「Electron 充当 Node」spawn standalone server →
 *   就绪后 BrowserWindow 加载本地回环 UI → 真实 runner 子进程(runner-bootstrap→jiti→用户
 *   agent 代码)→ mock provider → 流式回包显示在 Electron 窗口。
 *
 * 复用 cli-real.mjs 的 mock provider + 临时 agent-dir 手法(不依赖外网/真实凭据)。
 * 关键注入:
 *   - PI_WEB_DESKTOP_SERVER_JS:指向 repo 的 .next-cli/standalone/server.js(未打包态入口覆盖)。
 *   - PI_WEB_AGENT_DIR:临时 agent-dir(默认模型指向 mock)。
 *   - PI_WEB_DEFAULT_SOURCE/CWD:autostart 直接建会话(前端据默认 source 存在跳过选源页)。
 *   - 主进程自身**不带** ELECTRON_RUN_AS_NODE(保持 GUI);supervisor 只给 server 子进程注入。
 *
 * 前置:`pnpm build:cli`(standalone) + `pnpm --filter @blksails/pi-web-desktop build`(desktop dist)。
 * 跑法:`node e2e/desktop/desktop-real.mjs`。
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = process.env.NEXT_DIST_DIR ?? ".next-cli";
const STANDALONE_SERVER = join(ROOT, DIST, "standalone", "server.js");
const DESKTOP_MAIN = join(ROOT, "desktop", "dist", "main.js");
const DESKTOP_PORT = 34810;
const EVIDENCE_DIR = join(ROOT, ".kiro/specs/pi-web-desktop/evidence");
const REPLY_TOKEN = "PIWEBDESKTOPOK";

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failures.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** mock OpenAI Chat Completions(确定性 SSE 回包);复用 cli-real.mjs 的格式。 */
function startMockProvider() {
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
        const base = { id: "chatcmpl-mock", object: "chat.completion.chunk", created: 0, model: "mock-model" };
        const send = (choices, extra) => res.write(`data: ${JSON.stringify({ ...base, choices, ...extra })}\n\n`);
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
    server.listen(0, "127.0.0.1", () => res({ server, port: server.address().port, getCalls: () => calls }));
  });
}

/** 最小临时 agent-dir,默认模型指向 mock。 */
function makeAgentDir(mockPort) {
  const dir = mkdtempSync(join(tmpdir(), "pi-desktop-real-"));
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
  const settings = { defaultProvider: "mock", defaultModel: "mock-model", packages: [], loadSystemSkills: false };
  writeFileSync(join(dir, "models.json"), JSON.stringify(models, null, 2));
  writeFileSync(join(dir, "settings.json"), JSON.stringify(settings, null, 2));
  writeFileSync(join(dir, "auth.json"), "{}\n");
  return dir;
}

async function main() {
  if (!existsSync(STANDALONE_SERVER)) {
    console.error(`产物缺失:${STANDALONE_SERVER}\n请先 \`pnpm build:cli\``);
    process.exit(1);
  }
  if (!existsSync(DESKTOP_MAIN)) {
    console.error(`桌面 bundle 缺失:${DESKTOP_MAIN}\n请先 \`pnpm --filter @blksails/pi-web-desktop build\``);
    process.exit(1);
  }

  const require = createRequire(join(ROOT, "desktop", "package.json"));
  const electronPath = require("electron"); // electron npm 默认导出=二进制路径

  const mock = await startMockProvider();
  const agentDir = makeAgentDir(mock.port);

  let app;
  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: [DESKTOP_MAIN],
      cwd: ROOT,
      env: {
        ...process.env,
        // 未打包态 server.js 入口覆盖(避开内联 import.meta.url 路径漂移)。
        PI_WEB_DESKTOP_SERVER_JS: STANDALONE_SERVER,
        PI_WEB_DESKTOP_PORT: String(DESKTOP_PORT),
        // agent-dir + 默认 source + autostart:直接建真实会话。
        PI_WEB_AGENT_DIR: agentDir,
        PI_WEB_DEFAULT_SOURCE: join(ROOT, "examples", "hello-agent"),
        PI_WEB_DEFAULT_CWD: ROOT,
        // 主进程保持 GUI:显式确保不带 run-as-node(supervisor 只给 server 子进程注入)。
        ELECTRON_RUN_AS_NODE: undefined,
        NEXT_DIST_DIR: DIST,
      },
    });

    // 第一个窗口:先是 loading.html,就绪后被 main 切到本地回环 UI。
    const page = await app.firstWindow();
    // 等窗口导航到本地回环 UI(非 loading.html/file://)。
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 90_000 });
    check("Electron 窗口加载本地回环 UI(非空白/非加载页)", /^http:\/\/127\.0\.0\.1:/.test(page.url()));

    // autostart 建会话 → 输入框出现。
    await page.waitForSelector("[data-pi-input-textarea]", { timeout: 30_000 });
    check("默认 source 自动激活真实会话(URL 含 /session/)", /\/session\//.test(page.url()));

    await page.fill("[data-pi-input-textarea]", "say the magic token");
    await page.getByRole("button", { name: "发送" }).click();

    const got = await page
      .waitForFunction((tok) => document.body.innerText.includes(tok), REPLY_TOKEN, { timeout: 45_000 })
      .then(() => true)
      .catch(() => false);
    check("Electron 窗口收到真实 runner 经 mock provider 的流式回包", got);

    // 硬证据:真实 runner 链路打通(stub 永不触发 mock)。
    check("mock provider 被真实 runner 调用(≥1 次,证明 Electron-as-Node 下 server→runner 链可用)", mock.getCalls() >= 1);

    mkdirSync(EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE_DIR, "desktop-real.png"), fullPage: true });
    console.log(`证据截图: ${join(EVIDENCE_DIR, "desktop-real.png")}`);
  } catch (err) {
    check(`桌面真实 e2e: ${err?.message ?? err}`, false);
  } finally {
    if (app) await app.close().catch(() => {});
    await sleep(500);
    mock.server.close();
    try {
      rmSync(agentDir, { recursive: true, force: true });
    } catch {
      // best-effort。
    }
  }

  console.log(failures.length ? `\nFAIL: ${failures.length} 项` : "\nPASS: 全部通过");
  process.exit(failures.length ? 1 : 0);
}

main();
