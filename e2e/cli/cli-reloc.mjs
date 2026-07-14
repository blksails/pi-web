#!/usr/bin/env node
/**
 * CLI 「npm 安装态」端到端 e2e —— 首启解包 + 跨路径重定位守卫。可重复运行。
 *
 * 本测试有三重目的:
 *
 * A) **重定位守卫**(原有职责,spec pi-web-cli)：产物若把**构建机绝对路径**烤进 bundle
 *    (打包器内联 import.meta.url、externals 绝对路径等),则只在「同机 build+run、同绝对
 *    路径」下能跑,一换路径(发布到 npm / 换机 / 换 OS)即崩。同机 e2e(cli-smoke / cli-real)
 *    因构建路径仍在,会**假阳性**测不到。故此处**临时藏起原构建目录**,使任何内联的构建机
 *    绝对路径在本地也指向不存在的位置,忠实复现「换机运行」。
 *
 * B) **首启解包**(spec shared-runtime-payload,Req 9.3/9.4)：npm 包不再内嵌 `dist/` 树,
 *    只带 `payload/` 载荷。CLI 的解析顺序是 ① PI_WEB_DIST_DIR → ② PKG_ROOT/dist →
 *    ③ 解包载荷。仓库里有 `dist/`,故 cli-smoke / cli-real / cli-watch 走 ②,**完全测不到
 *    解包路径**。本测试构造一个只含 `bin/` + `payload/` 的临时包根(无 `dist/`),是 CLI 侧
 *    **唯一**覆盖分支 ③ 的 e2e。
 *
 * C) **第二产物同验**(spec cli-package-commands 任务 6.3,Req 10.6)：`cli-commands.mjs`
 *    (子命令实现)与 `server.mjs` 同为 esbuild 单文件产物,同样可能内联构建机绝对路径。
 *    本测试在原构建目录仍「藏起」时,从**解包出的运行时**动态 `import()` 它并调用导出,
 *    覆盖「新产物在包被装到任意路径、经载荷解包后仍可被动态加载」。
 *
 * 三者天然合一:解包出的运行时落在 `PI_WEB_RUNTIME_ROOT` 指向的临时目录,与构建目录毫无关系。
 *
 * 跨机/跨 OS 的权威验证仍是 CI 矩阵(Linux 构建 → mac/win 运行);本测试是等价的**本地快反**守卫。
 *
 * 前置:`pnpm build:dist`。跑法:`pnpm e2e:cli:reloc`。
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer, get as httpGet } from "node:http";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
      q.on("error", () => (Date.now() > dl ? rej(new Error("就绪超时")) : setTimeout(tk, 300)));
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
    server.listen(0, "127.0.0.1", () => r({ server, port: server.address().port, getCalls: () => calls })),
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

/** 构造一个「npm 安装后」的包根：只有 bin/ + payload/ + package.json，**没有 dist/**。 */
function makeInstalledPackageRoot() {
  const pkgRoot = mkdtempSync(join(tmpdir(), "pi-web-installed-"));
  cpSync(join(ROOT, "bin"), join(pkgRoot, "bin"), { recursive: true });
  cpSync(join(ROOT, "payload"), join(pkgRoot, "payload"), { recursive: true });
  // readVersion() 读它；同时证明包根不含 dist/。
  cpSync(join(ROOT, "package.json"), join(pkgRoot, "package.json"));
  return pkgRoot;
}

/** 由载荷元数据推出运行时目录名，供解包前后的存在性断言。 */
function expectedRuntimeDir(pkgRoot) {
  const meta = JSON.parse(readFileSync(join(pkgRoot, "payload", "payload.json"), "utf8"));
  return `${meta.version}-${meta.digest.slice(0, 12)}`;
}

async function main() {
  const origDist = join(ROOT, DIST);
  if (!existsSync(join(origDist, "server.mjs"))) {
    console.error("产物缺失,请先 `pnpm build:dist`");
    process.exit(1);
  }
  if (!existsSync(join(ROOT, "payload", "payload.json"))) {
    console.error("载荷缺失,请先 `pnpm build:dist`");
    process.exit(1);
  }

  const pkgRoot = makeInstalledPackageRoot();
  const runtimeRoot = mkdtempSync(join(tmpdir(), "pi-web-runtime-"));
  const dirName = expectedRuntimeDir(pkgRoot);
  const targetDir = join(runtimeRoot, dirName);

  check("模拟的 npm 包根不含 dist/", !existsSync(join(pkgRoot, "dist")));
  check("解包前运行时目录不存在", !existsSync(targetDir));

  // ★ 藏起原构建目录 —— 强制内联的构建机绝对路径在本地也失效(消除假阳性)。
  const hidden = join(ROOT, `${DIST}__hidden_reloc`);
  renameSync(origDist, hidden);
  const restoreOrig = () => {
    if (existsSync(hidden) && !existsSync(origDist)) renameSync(hidden, origDist);
  };

  const mock = await startMock();
  const agentDir = makeAgentDir(mock.port);

  let stdout = "";
  let stderr = "";
  let browser;
  let cli;
  try {
    // 分支 ③：包根无 dist ⇒ 从 payload/ 解包到 PI_WEB_RUNTIME_ROOT。
    const env = { ...process.env, PI_WEB_RUNTIME_ROOT: runtimeRoot };
    delete env.PI_WEB_DIST_DIR; // 否则会命中分支 ①，测不到解包

    // source 指向解包后运行时里的 examples/hello-agent —— 该路径在解包完成前并不存在，
    // 但 CLI 先解包再拉起后端，故此处可以先行给出。
    const srcDir = join(targetDir, DIST, "examples", "hello-agent");

    cli = spawn(
      process.execPath,
      [join(pkgRoot, "bin", "pi-web.mjs"), srcDir, "-p", String(PORT), "--agent-dir", agentDir],
      { cwd: tmpdir(), env },
    );
    cli.stdout.on("data", (d) => {
      stdout += d.toString();
      process.stdout.write(d);
    });
    cli.stderr.on("data", (d) => {
      stderr += d.toString();
      process.stderr.write(d);
    });

    await waitReady(120_000); // 首启含真实解包(约 5-6s)
    check("首启解包后 server 就绪", true);
    check("CLI 报告了首次解包", /已解包运行时/.test(stdout));
    check("运行时目录已落地且带完整性标记", existsSync(join(targetDir, ".ok")));
    check("解包出的产物根含 node_modules(未被剥空)", existsSync(join(targetDir, DIST, "node_modules")));
    check(
      "运行时落在与构建目录无关的绝对路径",
      targetDir.startsWith(runtimeRoot) && !targetDir.startsWith(ROOT),
    );

    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-pi-input-textarea]", { timeout: 20_000 });
    check("解包出的产物激活真实会话(无模块/CLI 解析错误)", /\/session\//.test(page.url()));
    await page.fill("[data-pi-input-textarea]", "go");
    await page.getByRole("button", { name: "发送" }).click();
    const got = await page
      .waitForFunction((tok) => document.body.innerText.includes(tok), REPLY_TOKEN, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    check("收到真实流式回包", got);
    check("mock 被真实 runner 调用", mock.getCalls() >= 1);

    // C) 第二产物(cli-commands.mjs)经载荷解包后仍可动态加载(任务 6.3,Req 10.6)。
    //    原构建目录此刻仍处于「藏起」状态(见上方 renameSync(origDist, hidden)),
    //    故此处加载的确是解包出的运行时副本,任何内联的构建机绝对路径若失效会在此处暴露。
    const relocDist = join(targetDir, DIST);
    const relocCliCommandsJs = join(relocDist, "cli-commands.mjs");
    check("解包运行时内 cli-commands.mjs 存在", existsSync(relocCliCommandsJs));
    const cliCommandsMod = await import(pathToFileURL(relocCliCommandsJs).href);
    check(
      "解包后 cli-commands.mjs 可动态加载且导出可调用(cliCommandsEntryReady)",
      cliCommandsMod.cliCommandsEntryReady() === true,
    );
    const relocExamplesRoot = cliCommandsMod.resolveExamplesRoot(
      [join(relocDist, "examples")],
      existsSync,
    );
    check(
      "解包后 resolveExamplesRoot() 在运行时自身 examples/ 下解析成功",
      relocExamplesRoot === join(relocDist, "examples"),
    );
  } catch (e) {
    check(`npm 安装态 e2e: ${e.message}`, false);
  } finally {
    if (browser) await browser.close();
    if (cli) cli.kill("SIGINT");
    await sleep(800);
    mock.server.close();
  }

  // 二次解析应命中已解包目录（快路径），不再解包。
  // 注意：不能用 `pi-web --version` 来测——它在 main() 里早于 resolveRuntime() 返回，
  // 那样的断言恒真、什么也没验证。直接问解包器。
  try {
    const again = spawnSync(
      process.execPath,
      [join(pkgRoot, "payload", "unpack.mjs"), "--payload-dir", join(pkgRoot, "payload"), "--runtime-root", runtimeRoot, "--json"],
      { encoding: "utf8" },
    );
    const res = JSON.parse(again.stdout.trim().split("\n").at(-1));
    check("二次解析命中已解包目录(unpacked=false)", again.status === 0 && res.ok === true && res.unpacked === false);
    check("命中路径为常数时间(<200ms)", res.elapsedMs < 200);
  } catch (e) {
    check(`二次解析: ${e.message}`, false);
  }

  rmSync(agentDir, { recursive: true, force: true });
  rmSync(pkgRoot, { recursive: true, force: true });
  rmSync(runtimeRoot, { recursive: true, force: true });
  restoreOrig(); // 必须还原原构建目录

  if (/ERR_MODULE_NOT_FOUND|Cannot find (module|package)|PiCliNotFound|PI_CLI_NOT_FOUND/.test(stderr)) {
    check("server 无模块/CLI 解析错误", false);
  }
  console.log(fails.length ? `\nFAIL: ${fails.length} 项` : "\nPASS: 全部通过");
  process.exit(fails.length ? 1 : 0);
}
main();
