#!/usr/bin/env node
/**
 * CLI 生成物可直接运行 e2e 验证(spec cli-package-commands,任务 3.3,Req 2.10)。
 *
 * 前置:已构建自包含产物 —— `pnpm build:dist`(本脚本会在产物缺失时自动补跑一次,
 * 见下方 `ensureDist()`)。跑法:`node e2e/cli/cli-create-run.mjs`(或 `pnpm e2e:cli:create`)。
 *
 * 覆盖(观察态,对应任务 3.3):
 *   1. 用真实分发产物 `dist/cli-commands.mjs` 的 `scaffold()` 生成一个 agent 骨架;
 *   2. 断言骨架目录不存在 `node_modules`(Req 2.10「无需额外安装依赖」的前置证据);
 *   3. 以该骨架目录为 agent 源,经 `bin/pi-web.mjs` 启动一个真实 standalone 实例
 *      (`--stub` 免 LLM 凭据);
 *   4. 断言实例真正就绪并可进入会话 —— 用比 `waitForReady()`(任何 HTTP 响应即视为就绪)
 *      更强的断言:`GET /api/bootstrap` 返回 200 且响应体是可解析 JSON。选它的理由:
 *      `/` 在前端产物缺失时会以 500 响应正文(而不是抛连接错误),`waitForReady()` 的探针
 *      逻辑对「连接建立」与「响应状态码」不做区分,500 也会被判定为就绪 —— 这正是文档要求
 *      规避的「被 500 蒙混过关」。`/api/bootstrap` 是纯后端路由,不依赖前端构建产物;
 *      其 200 且 JSON 可解析说明 server 侧路由与运行时确已初始化完毕,不是简单端口占用
 *      误判(裸监听端口不会应答合法 HTTP 语义)。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { get as httpGet } from "node:http";
import { randomUUID } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST_DIR = process.env.PI_WEB_DIST_DIR ?? "dist";
const DIST = join(ROOT, DIST_DIR);
const BIN = join(ROOT, "bin", "pi-web.mjs");

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failures.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 确保自包含产物齐全(server.mjs / cli-commands.mjs / client 前端产物 / examples 副本)。
 * 缺失任一项即视为「未构建或构建不完整」,自动跑一次 `pnpm build:dist`(完整构建含 vite
 * 前端构建,较慢但必要 —— `/` 路由需要 `dist/client/index.html`,否则返回 500,会话页面
 * 与 `/api/bootstrap` 之外的其他证据链路都建立在完整产物之上)。
 */
function ensureDist() {
  const required = [
    join(DIST, "server.mjs"),
    join(DIST, "cli-commands.mjs"),
    join(DIST, "client", "index.html"),
    join(DIST, "examples"),
  ];
  const missing = required.filter((p) => !existsSync(p));
  if (missing.length === 0) return;

  console.log(`[cli-create-run] 产物不完整,缺: ${missing.join(", ")}`);
  console.log("[cli-create-run] 正在运行 `pnpm build:dist`(完整构建,较慢,请稍候)…");
  const build = spawnSync("pnpm", ["build:dist"], { cwd: ROOT, stdio: "inherit" });
  if (build.status !== 0) {
    console.error("[cli-create-run] `pnpm build:dist` 失败,无法继续。");
    process.exit(1);
  }
  const stillMissing = required.filter((p) => !existsSync(p));
  if (stillMissing.length > 0) {
    console.error(
      `[cli-create-run] 构建后仍缺失产物: ${stillMissing.join(", ")},请手动排查 \`pnpm build:dist\`。`,
    );
    process.exit(1);
  }
}

/** 轮询直至 `GET /api/bootstrap` 返回 200 且响应体可解析为 JSON(比「任何响应」更强的就绪断言)。 */
function waitForBootstrapReady(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((res, rej) => {
    const tick = () => {
      const req = httpGet(`${base}/api/bootstrap`, (r) => {
        let body = "";
        r.on("data", (c) => (body += c));
        r.on("end", () => {
          if (r.statusCode === 200) {
            try {
              JSON.parse(body);
              res();
              return;
            } catch (e) {
              // 200 但非法 JSON:视为尚未就绪,继续轮询直至超时。
            }
          }
          if (Date.now() > deadline) {
            rej(
              new Error(
                `/api/bootstrap 未在超时内返回 200+JSON(最近一次: status=${r.statusCode}, body=${body.slice(0, 200)})`,
              ),
            );
          } else {
            setTimeout(tick, 300);
          }
        });
      });
      req.on("error", () => {
        if (Date.now() > deadline) rej(new Error("等待 /api/bootstrap 就绪超时(连接失败)"));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

async function main() {
  ensureDist();

  // 从真实分发产物动态 import,证明「生成能力随产物分发且可被外部消费」这条接缝成立
  // (而不是只在源码 ts-node 环境下工作)。
  const cliCommandsUrl = pathToFileURL(join(DIST, "cli-commands.mjs")).href;
  const { scaffold, resolveExamplesRoot } = await import(cliCommandsUrl);

  // examplesRoot 取 dist/examples(分发产物内的副本,而非仓库 examples/):这是真实用户
  // 拿到发布包后会经历的路径 —— `resolveExamplesRoot` 本身就是按「产物根优先、仓库根兜底」
  // 的候选顺序解析,此处用它验证该纯函数在真实产物布局下选中的确实是 dist/examples。
  const examplesRoot = resolveExamplesRoot([join(DIST, "examples"), join(ROOT, "examples")]);
  check("examplesRoot 解析为 dist/examples(分发产物内副本)", examplesRoot === join(DIST, "examples"));

  const tmpParent = mkdtempSync(join(tmpdir(), "pi-web-cli-create-"));
  const targetDir = join(tmpParent, `agent-${randomUUID().slice(0, 8)}`);
  const bootPort = 3600 + Math.floor(Math.random() * 300);

  let child;
  try {
    const result = await scaffold(
      { name: "cli-create-run-fixture", kind: "agent", templateName: "minimal-agent", targetDir },
      examplesRoot,
    );
    check("scaffold() 生成骨架成功", result.ok === true);
    if (!result.ok) {
      console.error(`[cli-create-run] scaffold 失败: ${JSON.stringify(result.error)}`);
    }

    check("骨架目录存在", existsSync(targetDir));
    check(
      "骨架目录中不存在 node_modules(Req 2.10:无需额外安装依赖)",
      !existsSync(join(targetDir, "node_modules")),
    );
    check(
      "骨架目录内容非空(未被误判为空目录)",
      existsSync(targetDir) && readdirSync(targetDir).length > 0,
    );

    // 从随机起始端口找一个真正空闲的端口,避免历史坑(端口占用致误判)。
    const { findFreePort } = await import(pathToFileURL(BIN).href);
    const port = await findFreePort("127.0.0.1", bootPort, 20);
    check("找到空闲端口", typeof port === "number");
    const base = `http://127.0.0.1:${port}`;

    child = spawn("node", [BIN, targetDir, "--stub", "-p", String(port)], {
      cwd: ROOT,
      env: { ...process.env, PI_WEB_DIST_DIR: DIST_DIR },
      stdio: "inherit",
    });

    await waitForBootstrapReady(base, 30_000);
    check("实例就绪:GET /api/bootstrap 返回 200 且 JSON 可解析(非 500 蒙混)", true);
  } catch (err) {
    check(`实例就绪验证: ${err.message}`, false);
  } finally {
    if (child && !child.killed) {
      child.kill("SIGINT");
      await sleep(500);
      if (!child.killed) child.kill("SIGKILL");
    }
    rmSync(tmpParent, { recursive: true, force: true });
  }

  console.log(failures.length ? `\nFAIL: ${failures.length} 项` : "\nPASS: 全部通过");
  process.exit(failures.length ? 1 : 0);
}

main();
