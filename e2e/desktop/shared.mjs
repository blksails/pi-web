/**
 * 桌面壳黑盒 e2e 共用基础设施（spec electron-to-tauri 任务 4.4，Req 10.6）。
 *
 * 迁移到 Tauri 后，Playwright 的 `_electron`（`launch`/`firstWindow`/`app.evaluate`）不再适用，
 * 而 `tauri-driver` **官方不支持 macOS**（无 WKWebView driver）。因此 macOS 上只能黑盒验证：
 * 启动壳二进制 → 探测其拉起的本地回环端点 → 用普通浏览器访问**同一个端点**跑真实会话
 * （pi-web UI 本就是一个 web app）→ 断言 mock provider 被真实 runner 调用 →
 * 优雅终止 → 断言无孤儿进程、端口释放。
 *
 * 「渲染层经桥调用 pickDirectory」这条 macOS 测不到的路径，由 Linux 的 WebDriver e2e 覆盖
 * （任务 6.1）。此处不假装覆盖它。
 */
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { connect as netConnect } from "node:net";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DIST = process.env.PI_WEB_DIST_DIR ?? "dist";
export const DIST_SERVER = join(ROOT, DIST, "server.mjs");
/** 未打包壳二进制（`cargo build` 产物）。 */
export const SHELL_BIN = join(ROOT, "desktop", "src-tauri", "target", "debug", "pi-web");
export const SIDECAR_DIR = join(ROOT, "desktop", "src-tauri", "binaries");

const failures = [];
export const check = (name, ok) => {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failures.push(name);
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function reportAndExit() {
  console.log("");
  if (failures.length > 0) {
    console.error(`✗ ${failures.length} 项失败：\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("✓ 全部通过");
  process.exit(0);
}

/** 本机 target triple（用于定位 sidecar 二进制）。 */
export function hostTriple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const m = out.match(/^host:\s*(\S+)$/m);
  if (!m) throw new Error("无法从 rustc -vV 解析 host triple");
  return m[1];
}

/**
 * 一次性备齐 4.5–4.7 并行组的共享前提，使并行组内无人再写共享资源。
 *
 * 1. `dist/`（由 `pnpm build:dist` 产出，不由本 spec 拥有）
 * 2. sidecar node，并拷到**未打包可执行同目录** —— unpackaged 模式下 `resolve_artifact`
 *    同样从可执行同目录取 node，而 `binaries/` 是 gitignored，干净检出下为空。
 */
export function ensurePrerequisites({ needShellBinary = true } = {}) {
  if (!existsSync(DIST_SERVER)) {
    console.error(`✗ 缺少自包含产物：${DIST_SERVER}\n  请先执行：pnpm build:dist`);
    process.exit(1);
  }
  if (needShellBinary && !existsSync(SHELL_BIN)) {
    console.error(
      `✗ 缺少桌面壳二进制：${SHELL_BIN}\n  请先执行：cargo build --manifest-path desktop/src-tauri/Cargo.toml`,
    );
    process.exit(1);
  }

  const triple = hostTriple();
  const src = join(SIDECAR_DIR, triple.includes("windows") ? `node-${triple}.exe` : `node-${triple}`);
  if (!existsSync(src)) {
    console.error(
      `✗ 缺少随包 Node 二进制：${src}\n  请先执行：node scripts/fetch-node-sidecar.mjs`,
    );
    process.exit(1);
  }
  if (needShellBinary) {
    const dst = join(dirname(SHELL_BIN), process.platform === "win32" ? "node.exe" : "node");
    copyFileSync(src, dst);
    // 校验它真的可执行（macOS 上 strip 会破坏签名，导致 SIGKILL）。
    const v = execFileSync(dst, ["--version"], { encoding: "utf8" }).trim();
    if (!v.startsWith("v")) throw new Error(`随包 node 不可执行：${dst}`);
  }
}

/** 端口是否空闲（连接被拒 = 空闲）。 */
export function isPortFree(port, host = "127.0.0.1") {
  return new Promise((res) => {
    const s = netConnect({ port, host });
    const done = (free) => {
      s.destroy();
      res(free);
    };
    s.once("connect", () => done(false));
    s.once("error", () => done(true));
    setTimeout(() => done(true), 800);
  });
}

/** 轮询直至回环端点返回任何 HTTP 响应。 */
export async function waitReady(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
      return true;
    } catch {
      await sleep(300);
    }
  }
  return false;
}

/** 轮询直至端口被释放。 */
export async function waitPortFree(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return true;
    await sleep(250);
  }
  return false;
}

/**
 * mock OpenAI Chat Completions：对 POST .../chat/completions 返回确定性 SSE 流。
 * 严格按 openai SDK 期望的 chunk 格式输出（delta.content / finish_reason / [DONE]）。
 */
export function startMockProvider(replyToken) {
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
        const send = (choices, extra) =>
          res.write(`data: ${JSON.stringify({ ...base, choices, ...extra })}\n\n`);
        send([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]);
        send([{ index: 0, delta: { content: replyToken }, finish_reason: null }]);
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
      res({ server, port: server.address().port, getCalls: () => calls });
    });
  });
}

/** 写一个最小临时 agent-dir，把默认模型指向 mock provider。 */
export function makeAgentDir(mockPort) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-desktop-e2e-"));
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
    packages: [],
    loadSystemSkills: false,
  };
  writeFileSync(join(dir, "models.json"), JSON.stringify(models, null, 2));
  writeFileSync(join(dir, "settings.json"), JSON.stringify(settings, null, 2));
  writeFileSync(join(dir, "auth.json"), "{}\n");
  return dir;
}

export const cleanupAgentDir = (dir) => rmSync(dir, { recursive: true, force: true });

/** 启动壳二进制（不打开 GUI 断言，纯进程 + HTTP 观察）。 */
export function launchShell({ exePath = SHELL_BIN, port, env = {}, cwd = ROOT }) {
  const proc = spawn(exePath, [], {
    cwd,
    env: { ...process.env, PI_WEB_DESKTOP_PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  proc.stdout.on("data", (d) => process.stdout.write(d));
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
    process.stderr.write(d);
  });
  return { proc, getStderr: () => stderr };
}

/**
 * 优雅终止壳。
 *
 * ★ 走 SIGTERM 而非 SIGKILL：壳装了信号处理器把它转成 `app.exit(0)` → `ExitRequested`
 *   → 收尾 server 进程树。SIGKILL 会跳过收尾，留下孤儿（曾实测复现）。
 */
export async function stopShell(proc, timeoutMs = 15_000) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill("SIGTERM");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    await sleep(100);
  }
  proc.kill("SIGKILL");
}

/** 未打包壳的 sidecar node 绝对路径（`resolve_artifact` 从可执行同目录取它）。 */
export const SHELL_NODE_BIN = join(dirname(SHELL_BIN), process.platform === "win32" ? "node.exe" : "node");

/**
 * 列出仍在运行的、由本壳拉起的随包 node 进程（用于孤儿断言）。
 *
 * ★ 按**可执行文件路径前缀**匹配，而非 `pgrep -f <子串>`：后者会匹配到任何命令行里
 *   碰巧含该字符串的进程——包括跑这个 e2e 的 shell 自己（曾实测自匹配，导致假阳性）。
 *
 * `nodeBin` 未打包态为 `target/debug/node`，打包态为 `.app/Contents/MacOS/node`。
 */
export function listShellNodeProcesses(nodeBin = SHELL_NODE_BIN) {
  let out;
  try {
    out = execFileSync("ps", ["-eo", "pid=,ppid=,command="], { encoding: "utf8" });
  } catch {
    return [];
  }
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
      return m ? { pid: Number(m[1]), ppid: Number(m[2]), command: m[3] } : null;
    })
    .filter(Boolean)
    // 只认「可执行文件就是随包 node」的进程，即命令行以其绝对路径起头。
    .filter((p) => p.command.startsWith(nodeBin));
}

export function countShellNodeProcesses(nodeBin = SHELL_NODE_BIN) {
  return listShellNodeProcesses(nodeBin).length;
}

/**
 * 轮询直至再无该壳的 node 后代。
 *
 * 收尾是异步的：端口可能先于进程表清理而释放（SIGTERM → server 退出 → runner 退出 → 内核回收）。
 * 与端口释放一样给一个收敛窗口，而不是立即断言。剥空 PATH 的场景下 runner 退出更慢。
 * 超时即打印残留详情，便于定位真正的孤儿。
 */
export async function waitNoShellNodeProcesses(nodeBin = SHELL_NODE_BIN, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (countShellNodeProcesses(nodeBin) === 0) return true;
    await sleep(200);
  }
  for (const p of listShellNodeProcesses(nodeBin)) {
    console.error(`[e2e] 孤儿残留 pid=${p.pid} ppid=${p.ppid}\n        ${p.command.slice(0, 120)}`);
  }
  return countShellNodeProcesses(nodeBin) === 0;
}

/**
 * 用普通浏览器访问壳拉起的**同一个回环端点**跑一次真实会话。
 *
 * 这不验证 Tauri 窗口内的渲染（macOS 无 WebDriver），但完整验证了
 * 壳 → server → pi runner 子进程 → mock provider 这条链路。
 */
export async function runSessionViaBrowser(port, replyToken, { screenshotPath } = {}) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-pi-input-textarea]", { timeout: 30_000 });
    const onSessionUrl = /\/session\//.test(page.url());

    await page.fill("[data-pi-input-textarea]", "say the magic token");
    await page.getByRole("button", { name: "发送" }).click();
    await page.waitForFunction(
      (t) => document.body.innerText.includes(t),
      replyToken,
      { timeout: 60_000 },
    );
    if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
    return { onSessionUrl, sawToken: true };
  } catch (err) {
    console.error(`[e2e] 会话失败: ${err?.message ?? err}`);
    return { onSessionUrl: false, sawToken: false, error: err };
  } finally {
    await browser.close();
  }
}
