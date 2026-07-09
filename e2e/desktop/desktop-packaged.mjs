#!/usr/bin/env node
/**
 * 打包 app 冒烟(spec pi-web-desktop 打包路径验证)。
 *
 * 与 desktop-real.mjs 的区别:启动的是**已打包的 .app 二进制**(app.isPackaged=true → 走
 * packaged 分支:从 process.resourcesPath/dist 定位 server,不设 PI_WEB_DESKTOP_SERVER_JS),
 * 以复现并验证「双击打包应用」的真实路径(e2e 之前只测未打包 electron dist/main.js)。
 *
 * 验证:打包 app 起真实会话(证明 Resources/standalone/node_modules 完整、server require('next')
 * 不崩、只读 Resources 下 server/runner 仍可运行)。
 *
 * 前置:已 `electron-builder --mac --dir` 产出 release/mac-<arch>/pi-web.app。
 * 跑法:`node e2e/desktop/desktop-packaged.mjs`。
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RELEASE = join(ROOT, "desktop", "release");
const EVIDENCE_DIR = join(ROOT, ".kiro/specs/pi-web-desktop/evidence");
const DESKTOP_PORT = 34840;
const REPLY_TOKEN = "PIWEBPACKAGEDOK";

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failures.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 定位打包 app 的可执行二进制(mac-arm64 / mac / mac-x64 任一)。 */
function findAppBinary() {
  if (!existsSync(RELEASE)) return undefined;
  for (const d of readdirSync(RELEASE)) {
    if (!d.startsWith("mac")) continue;
    const bin = join(RELEASE, d, "pi-web.app", "Contents", "MacOS", "pi-web");
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

function startMockProvider() {
  let calls = 0;
  const server = createServer((req, res) => {
    if (req.method === "POST" && /\/chat\/completions/.test(req.url ?? "")) {
      calls += 1;
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
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

function makeAgentDir(mockPort) {
  const dir = mkdtempSync(join(tmpdir(), "pi-desktop-packaged-"));
  const models = {
    providers: {
      mock: {
        name: "Mock (e2e)", baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiKey: "mock-key", api: "openai-completions",
        models: [{ id: "mock-model", name: "Mock Model", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      },
    },
  };
  writeFileSync(join(dir, "models.json"), JSON.stringify(models, null, 2));
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ defaultProvider: "mock", defaultModel: "mock-model", packages: [], loadSystemSkills: false }, null, 2));
  writeFileSync(join(dir, "auth.json"), "{}\n");
  return dir;
}

async function main() {
  const appBin = findAppBinary();
  if (appBin === undefined) {
    console.error("未找到打包 app,请先 `pnpm --filter @blksails/pi-web-desktop dist` 或 electron-builder --mac --dir");
    process.exit(1);
  }
  console.log(`打包二进制: ${appBin}`);

  const mock = await startMockProvider();
  const agentDir = makeAgentDir(mock.port);

  let app;
  try {
    app = await electron.launch({
      executablePath: appBin, // 打包 app 二进制(app.isPackaged=true → packaged 分支)
      env: {
        ...process.env,
        PI_WEB_DESKTOP_PORT: String(DESKTOP_PORT),
        PI_WEB_AGENT_DIR: agentDir,
        PI_WEB_DEFAULT_SOURCE: join(ROOT, "examples", "hello-agent"),
        PI_WEB_DEFAULT_CWD: ROOT,
        ELECTRON_RUN_AS_NODE: undefined,
        // 注意:不设 PI_WEB_DESKTOP_SERVER_JS → 走 process.resourcesPath/dist(打包真实路径)
      },
    });

    const page = await app.firstWindow();
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 90_000 });
    check("打包 app 窗口加载本地回环 UI(server 从 Resources/standalone 起,require('next') 不崩)", /^http:\/\/127\.0\.0\.1:/.test(page.url()));

    await page.waitForSelector("[data-pi-input-textarea]", { timeout: 30_000 });
    await page.fill("[data-pi-input-textarea]", "say the magic token");
    await page.getByRole("button", { name: "发送" }).click();

    const got = await page
      .waitForFunction((tok) => document.body.innerText.includes(tok), REPLY_TOKEN, { timeout: 45_000 })
      .then(() => true)
      .catch(() => false);
    check("打包 app 真实会话跑通(Resources/standalone 完整 + runner 链可用)", got);
    check("mock provider 被真实 runner 调用(≥1 次)", mock.getCalls() >= 1);

    mkdirSync(EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE_DIR, "desktop-packaged.png"), fullPage: true });
    console.log(`证据截图: ${join(EVIDENCE_DIR, "desktop-packaged.png")}`);
  } catch (err) {
    check(`打包 app 冒烟: ${err?.message ?? err}`, false);
  } finally {
    if (app) await app.close().catch(() => {});
    await sleep(400);
    mock.server.close();
    try {
      rmSync(agentDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }

  console.log(failures.length ? `\nFAIL: ${failures.length} 项` : "\nPASS: 全部通过");
  process.exit(failures.length ? 1 : 0);
}

main();
