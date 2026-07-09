#!/usr/bin/env node
/**
 * CLI 跨路径重定位 e2e(自包含产物可重定位守卫)。可重复运行。
 *
 * 为什么需要它:产物若把**构建机绝对路径**烤进 bundle(打包器内联
 * import.meta.url、externals 绝对路径等),则只在「同机 build+run、同绝对路径」下能跑;
 * 一换路径(发布到 npm / 换机 / 换 OS)即崩。同机 e2e(cli-smoke / cli-real)因构建路径
 * 仍在,会**假阳性**测不到。本测试:
 *   1) 把产物 tar 到**另一个绝对路径**(保留符号链接);
 *   2) **临时藏起原构建目录**,使任何内联的构建机绝对路径在本地也指向不存在的位置
 *      —— 忠实复现「换机运行」,消除假阳性;
 *   3) 从重定位副本直接跑 server.mjs 走真实会话(mock openai-completions provider);
 *   4) 断言:真实会话激活 + 收到真实流式回包 + mock 被调用 + 无模块/CLI 解析错误。
 *
 * 跨机/跨 OS 的权威验证仍是 CI 矩阵(Linux 构建 → mac/win 运行);本测试是等价的**本地快反**守卫。
 *
 * 前置:`pnpm build:cli`。跑法:`pnpm e2e:cli:reloc`。
 */
import { spawn } from "node:child_process";
import { createServer, get as httpGet } from "node:http";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = process.env.PI_WEB_DIST_DIR ?? "dist";
const PORT = 3489;
const BASE = `http://127.0.0.1:${PORT}`;
const REPLY_TOKEN = "RELOCATEDOK";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (n, ok) => {
  console.log(`${ok ? "✓" : "✗"} ${n}`);
  if (!ok) fails.push(n);
};

function waitReady(t) {
  const dl = Date.now() + t;
  return new Promise((res, rej) => {
    const tk = () => {
      const q = httpGet(`${BASE}/`, (r) => {
        r.resume();
        res();
      });
      q.on("error", () =>
        Date.now() > dl ? rej(new Error("就绪超时")) : setTimeout(tk, 300),
      );
    };
    tk();
  });
}
function startMock() {
  let calls = 0;
  const server = createServer((req, res) => {
    if (req.method === "POST" && /\/chat\/completions/.test(req.url ?? "")) {
      calls++;
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const base = { id: "x", object: "chat.completion.chunk", created: 0, model: "mock-model" };
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
  return new Promise((r) =>
    server.listen(0, "127.0.0.1", () =>
      r({ server, port: server.address().port, getCalls: () => calls }),
    ),
  );
}
function makeAgentDir(mockPort) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-reloc-agent-"));
  writeFileSync(
    join(dir, "models.json"),
    JSON.stringify({
      providers: {
        mock: {
          name: "Mock",
          baseUrl: `http://127.0.0.1:${mockPort}/v1`,
          apiKey: "k",
          api: "openai-completions",
          models: [
            { id: "mock-model", name: "Mock", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
          ],
        },
      },
    }),
  );
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({ defaultProvider: "mock", defaultModel: "mock-model", packages: [], loadSystemSkills: false }),
  );
  writeFileSync(join(dir, "auth.json"), "{}\n");
  return dir;
}

async function main() {
  const origDist = join(ROOT, DIST);
  if (!existsSync(join(origDist, "server.mjs"))) {
    console.error("产物缺失,请先 `pnpm build:cli`");
    process.exit(1);
  }

  // 1) tar 产物到另一个绝对路径(保留符号链接)
  const reloc = mkdtempSync(join(tmpdir(), "pi-web-reloc-"));
  mkdirSync(join(reloc, DIST), { recursive: true });
  const t = spawnSync("bash", [
    "-c",
    `tar -czf - -C "${ROOT}" "${DIST}" | tar -xzf - -C "${reloc}"`,
  ]);
  check("产物已重定位到新绝对路径", t.status === 0);

  // 2) 临时藏起原构建目录 —— 强制内联的构建机绝对路径在本地也失效(消除假阳性)
  const hidden = join(ROOT, `${DIST}__hidden_reloc`);
  renameSync(origDist, hidden);
  const restoreOrig = () => {
    if (existsSync(hidden) && !existsSync(origDist)) renameSync(hidden, origDist);
  };

  const mock = await startMock();
  const agentDir = makeAgentDir(mock.port);
  const relocSA = join(reloc, DIST);
  const srcDir = join(relocSA, "examples", "hello-agent");

  let stderr = "";
  let browser;
  let srv;
  try {
    srv = spawn(process.execPath, [join(relocSA, "server.mjs")], {
      cwd: relocSA,
      env: {
        ...process.env,
        PI_WEB_DIST_DIR: DIST,
        PORT: String(PORT),
        HOSTNAME: "127.0.0.1",
        PI_WEB_DEFAULT_SOURCE: srcDir,
        PI_WEB_DEFAULT_CWD: srcDir,
        PI_WEB_AUTOSTART: "1",
        PI_WEB_AGENT_DIR: agentDir,
      },
    });
    srv.stdout.on("data", (d) => process.stdout.write(d));
    srv.stderr.on("data", (d) => {
      stderr += d.toString();
      process.stderr.write(d);
    });

    await waitReady(60_000);
    check("重定位后 server 就绪", true);
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-pi-input-textarea]", { timeout: 20_000 });
    check("重定位产物激活真实会话(无模块/CLI 解析错误)", /\/session\//.test(page.url()));
    await page.fill("[data-pi-input-textarea]", "go");
    await page.getByRole("button", { name: "发送" }).click();
    const got = await page
      .waitForFunction((tok) => document.body.innerText.includes(tok), REPLY_TOKEN, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    check("收到真实流式回包", got);
    check("mock 被真实 runner 调用", mock.getCalls() >= 1);
  } catch (e) {
    check(`重定位 e2e: ${e.message}`, false);
  } finally {
    if (browser) await browser.close();
    if (srv) srv.kill("SIGINT");
    await sleep(500);
    mock.server.close();
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(reloc, { recursive: true, force: true });
    restoreOrig(); // 必须还原原构建目录
  }
  if (/ERR_MODULE_NOT_FOUND|Cannot find (module|package)|PiCliNotFound|PI_CLI_NOT_FOUND/.test(stderr)) {
    check("server 无模块/CLI 解析错误", false);
  }
  console.log(fails.length ? `\nFAIL: ${fails.length} 项` : "\nPASS: 全部通过");
  process.exit(fails.length ? 1 : 0);
}
main();
