#!/usr/bin/env node
/**
 * 桌面版「干净无 Node 机器」验证 + 退出收尾 e2e(spec pi-web-desktop task 4.3)。
 *
 * 沿用 cli-reloc.mjs「藏起系统 node」的思路证明 Req 9.2/4.2:从传给 Electron 应用的 PATH 中
 * **剥除所有含 node 可执行文件的目录**,再启动桌面壳跑真实会话。若仍成功,则证明 server 与
 * runner 子进程用的是**注入的 Electron-as-Node 二进制**(PI_WEB_NODE_BIN=process.execPath),
 * 而非系统 PATH 上的 node——即干净无 Node 机器可用。
 *
 * 并验证退出收尾(Req 6.1/9.4):关闭应用后本地端口释放(server 进程树已被收尾)。
 *
 * 前置:`pnpm build:dist` + `pnpm --filter @blksails/pi-web-desktop build`。
 * 跑法:`node e2e/desktop/desktop-no-node.mjs`(或 `pnpm e2e:desktop:nonode`)。
 */
import { createServer } from "node:http";
import { connect as netConnect } from "node:net";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = process.env.PI_WEB_DIST_DIR ?? "dist";
const DIST_SERVER = join(ROOT, DIST, "server.mjs");
const DESKTOP_MAIN = join(ROOT, "desktop", "dist", "main.js");
const DESKTOP_PORT = 34820;
const EVIDENCE_DIR = join(ROOT, ".kiro/specs/pi-web-desktop/evidence");
const REPLY_TOKEN = "PIWEBNONODEOK";

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failures.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 从 PATH 剥除所有含 node/node.exe 的目录。 */
function pathWithoutNode(origPath) {
  return (origPath ?? "")
    .split(delimiter)
    .filter((d) => {
      if (!d) return false;
      try {
        return !existsSync(join(d, "node")) && !existsSync(join(d, "node.exe"));
      } catch {
        return true;
      }
    })
    .join(delimiter);
}

/** 端口是否空闲(连接被拒=空闲)。 */
function isPortFree(port) {
  return new Promise((res) => {
    const sock = netConnect({ host: "127.0.0.1", port, timeout: 1000 });
    sock.on("connect", () => {
      sock.destroy();
      res(false);
    });
    sock.on("error", () => res(true));
    sock.on("timeout", () => {
      sock.destroy();
      res(true);
    });
  });
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
  const dir = mkdtempSync(join(tmpdir(), "pi-desktop-nonode-"));
  const models = {
    providers: {
      mock: {
        name: "Mock (e2e)",
        baseUrl: `http://127.0.0.1:${mockPort}/v1`,
        apiKey: "mock-key",
        api: "openai-completions",
        models: [
          { id: "mock-model", name: "Mock Model", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
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
  if (!existsSync(DIST_SERVER) || !existsSync(DESKTOP_MAIN)) {
    console.error("产物缺失,请先 `pnpm build:dist` 与 `pnpm --filter @blksails/pi-web-desktop build`");
    process.exit(1);
  }

  const require = createRequire(join(ROOT, "desktop", "package.json"));
  const electronPath = require("electron");

  const strippedPath = pathWithoutNode(process.env.PATH);
  // 前置断言:剥离后系统确实找不到 node(否则本测试无意义)。
  let nodeGone = false;
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", ["node"], {
      env: { ...process.env, PATH: strippedPath },
      stdio: "ignore",
    });
  } catch {
    nodeGone = true;
  }
  check("已从 PATH 剥除系统 node(干净无 Node 环境模拟)", nodeGone);

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
        PATH: strippedPath, // 关键:应用及其 server/runner 子进程都拿不到系统 node
        PI_WEB_DESKTOP_SERVER_JS: DIST_SERVER,
        PI_WEB_DESKTOP_PORT: String(DESKTOP_PORT),
        PI_WEB_AGENT_DIR: agentDir,
        PI_WEB_DEFAULT_SOURCE: join(ROOT, "examples", "hello-agent"),
        PI_WEB_DEFAULT_CWD: ROOT,
        ELECTRON_RUN_AS_NODE: undefined,
        PI_WEB_DIST_DIR: DIST,
      },
    });

    const page = await app.firstWindow();
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 90_000 });
    check("无系统 node 下窗口仍加载本地回环 UI(server 用注入的 Electron-as-Node 启动)", /^http:\/\/127\.0\.0\.1:/.test(page.url()));

    await page.waitForSelector("[data-pi-input-textarea]", { timeout: 30_000 });
    await page.fill("[data-pi-input-textarea]", "say the magic token");
    await page.getByRole("button", { name: "发送" }).click();

    const got = await page
      .waitForFunction((tok) => document.body.innerText.includes(tok), REPLY_TOKEN, { timeout: 45_000 })
      .then(() => true)
      .catch(() => false);
    check("无系统 node 下真实会话跑通(runner 用注入二进制,非系统 node — Req 4.2/9.2)", got);
    check("mock provider 被真实 runner 调用(≥1 次)", mock.getCalls() >= 1);

    mkdirSync(EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: join(EVIDENCE_DIR, "desktop-no-node.png"), fullPage: true });
    console.log(`证据截图: ${join(EVIDENCE_DIR, "desktop-no-node.png")}`);

    // 退出收尾(Req 6.1/9.4):关闭应用后 server 端口应释放(进程树已被收尾,无残留)。
    await app.close();
    app = undefined;
    // 轮询端口释放(给收尾一点时间)。
    let released = false;
    for (let i = 0; i < 20; i++) {
      if (await isPortFree(DESKTOP_PORT)) {
        released = true;
        break;
      }
      await sleep(250);
    }
    check("关闭应用后本地端口释放(server 进程树已收尾,无残留 — Req 6.1)", released);
  } catch (err) {
    check(`干净无 node e2e: ${err?.message ?? err}`, false);
  } finally {
    if (app) await app.close().catch(() => {});
    await sleep(300);
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
