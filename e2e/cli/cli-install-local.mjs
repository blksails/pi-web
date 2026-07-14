#!/usr/bin/env node
/**
 * CLI 离线端到端验证(spec cli-package-commands,任务 6.2,Req 9.3, 9.4, 10.4)。
 *
 * 覆盖:创建 agent 骨架 → 以其为源启动本地实例 → 安装该本地目录(登记,非拷贝)→
 * `GET /api/agent-sources` 真实端点确认源列表包含它 → 卸载 → 该端点确认不再包含。
 *
 * 全程无网络、无注册表:
 *   - `install <本地目录>` 走 `resolveSource()` 的本地路径直连分支(`local:` 前缀展开),
 *     `checkAllowlist` 对本地路径的判定是纯本地逻辑,不联系任何注册表
 *     (`REGISTRY_NOT_IMPLEMENTED` 分支不会被触达)。
 *   - 隔离:临时 `PI_WEB_AGENT_DIR`(`sources.json` 落此)+ 临时(且刻意不存在的)
 *     `PI_WEB_SOURCES_ROOT`,绝不读写用户真实的 `~/.pi/agent` 或 `~/.pi-web/agents`。
 *
 * 前置:已构建自包含产物(缺失时自动 `pnpm build:dist`,同 `cli-create-run.mjs`)。
 * 跑法:`node e2e/cli/cli-install-local.mjs`(或 `pnpm e2e:cli:install`)。
 *
 * ★ CACHE_CHECK(任务 6.2 要求自行查证):`RegistrySourceProvider.list()`
 * (`packages/server/src/agent-source-list/registry-provider.ts`)每次调用都
 * `fs.readFile(registryPath)`,无任何内存缓存 —— 故 uninstall 后**无需重启实例**即可
 * 观察到源列表变化,本脚本对同一个运行中的实例先后两次请求 `GET /api/agent-sources`。
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { get as httpGet } from "node:http";

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

/** 与 `cli-create-run.mjs` 同法:产物不完整则自动补跑一次 `pnpm build:dist`。 */
function ensureDist() {
  const required = [
    join(DIST, "server.mjs"),
    join(DIST, "cli-commands.mjs"),
    join(DIST, "client", "index.html"),
    join(DIST, "examples"),
  ];
  const missing = required.filter((p) => !existsSync(p));
  if (missing.length === 0) return;

  console.log(`[cli-install-local] 产物不完整,缺: ${missing.join(", ")}`);
  console.log("[cli-install-local] 正在运行 `pnpm build:dist`(完整构建,较慢,请稍候)…");
  const build = spawnSync("pnpm", ["build:dist"], { cwd: ROOT, stdio: "inherit" });
  if (build.status !== 0) {
    console.error("[cli-install-local] `pnpm build:dist` 失败,无法继续。");
    process.exit(1);
  }
  const stillMissing = required.filter((p) => !existsSync(p));
  if (stillMissing.length > 0) {
    console.error(
      `[cli-install-local] 构建后仍缺失产物: ${stillMissing.join(", ")},请手动排查 \`pnpm build:dist\`。`,
    );
    process.exit(1);
  }
}

/** 轮询直至 `GET /api/bootstrap` 返回 200 且响应体可解析为 JSON(与 cli-create-run.mjs 同法)。 */
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
            } catch {
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

/** `GET /api/agent-sources` 一次性拉取(不分页,测试规模内一页足够)。 */
function getAgentSources(base) {
  return new Promise((res, rej) => {
    const req = httpGet(`${base}/api/agent-sources`, (r) => {
      let body = "";
      r.on("data", (c) => (body += c));
      r.on("end", () => {
        if (r.statusCode !== 200) {
          rej(new Error(`GET /api/agent-sources 非 200: ${r.statusCode} ${body.slice(0, 200)}`));
          return;
        }
        try {
          res(JSON.parse(body));
        } catch (e) {
          rej(new Error(`GET /api/agent-sources 响应非法 JSON: ${e.message}`));
        }
      });
    });
    req.on("error", rej);
  });
}

/** 用真实 CLI(`node bin/pi-web.mjs <args>`)执行一个子命令,返回 `spawnSync` 结果。 */
function runCli(args, { cwd = ROOT, env = {} } = {}) {
  return spawnSync("node", [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PI_WEB_DIST_DIR: DIST_DIR, ...env },
  });
}

async function main() {
  ensureDist();

  const tmpParent = mkdtempSync(join(tmpdir(), "pi-web-cli-install-local-"));
  // ★ 隔离:sources.json 落此临时目录,绝不触碰用户真实 ~/.pi/agent。
  const agentDir = join(tmpParent, "agent");
  // ★ 隔离扫描根:刻意指向一个不存在的临时路径 —— 既证明「本地登记不拷贝目录、不在
  //   源根下创建任何条目」(装完后此目录仍不存在),也避免读到用户真实 ~/.pi-web/agents
  //   下的无关条目干扰断言。
  const sourcesRootIsolated = join(tmpParent, "sources-root-unused");
  const myAgentDir = join(tmpParent, "my-agent");
  const port = 3700 + Math.floor(Math.random() * 200);
  const base = `http://127.0.0.1:${port}`;

  let instance;
  try {
    // 1) 用真实 CLI 创建骨架(Req 9.x 前置:先有一个本地 agent 目录可供登记)。
    const created = runCli(["create", "my-agent"], { cwd: tmpParent });
    check("create 退出 0", created.status === 0);
    if (created.status !== 0) console.error(`[diag] create stderr:\n${created.stderr}`);
    check("骨架目录存在", existsSync(myAgentDir));

    // 2) 用真实 CLI 安装该本地目录(本地路径来源 → 登记,不拷贝,Req 9.2/9.3 既有裁决)。
    const installed = runCli(["install", myAgentDir], { env: { PI_WEB_AGENT_DIR: agentDir } });
    check("install 退出 0", installed.status === 0);
    if (installed.status !== 0) {
      console.error(`[diag] install stdout:\n${installed.stdout}`);
      console.error(`[diag] install stderr:\n${installed.stderr}`);
    }

    const registryPath = join(agentDir, "sources.json");
    check("sources.json 已写入", existsSync(registryPath));
    let registryRaw = "";
    if (existsSync(registryPath)) {
      registryRaw = readFileSync(registryPath, "utf8");
    }
    check("sources.json 含该目录", registryRaw.includes(myAgentDir));
    check(
      "本地登记不拷贝目录(隔离源根下无新目录产生)",
      !existsSync(sourcesRootIsolated),
    );

    // 3) 启动一个真实 standalone 实例,--agent-dir 指向同一个隔离 agentDir(registryPath
    //    与本次安装写入的是同一份文件),--stub 免 LLM 凭据。
    instance = spawn(
      "node",
      [BIN, myAgentDir, "--stub", "-p", String(port), "--agent-dir", agentDir],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          PI_WEB_DIST_DIR: DIST_DIR,
          // 隔离扫描根:避免真实 ~/.pi-web/agents 下的条目混入断言。
          PI_WEB_SOURCES_ROOT: sourcesRootIsolated,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let instanceStderr = "";
    instance.stderr.on("data", (d) => {
      instanceStderr += d.toString();
    });

    await waitForBootstrapReady(base, 30_000);
    check("实例就绪:GET /api/bootstrap 返回 200 且 JSON 可解析", true);

    // 4) 真实端点断言:源列表包含刚安装的目录(Req 9.3,观察态要求「基于真实端点响应」)。
    const beforeUninstall = await getAgentSources(base);
    const myRealpath = realpathSync(myAgentDir);
    const foundBefore = beforeUninstall.sources.some(
      (s) => s.id === myRealpath || s.source === myAgentDir,
    );
    check("GET /api/agent-sources 安装后包含该目录(Req 9.3)", foundBefore);
    if (!foundBefore) {
      console.error(`[diag] /api/agent-sources 响应: ${JSON.stringify(beforeUninstall)}`);
    }

    // 5) 用真实 CLI 卸载该本地目录(Req 9.4)。
    const uninstalled = runCli(["uninstall", myAgentDir], { env: { PI_WEB_AGENT_DIR: agentDir } });
    check("uninstall 退出 0", uninstalled.status === 0);
    if (uninstalled.status !== 0) {
      console.error(`[diag] uninstall stdout:\n${uninstalled.stdout}`);
      console.error(`[diag] uninstall stderr:\n${uninstalled.stderr}`);
    }

    // 6) 真实端点断言:源列表不再包含该目录(Req 9.4)。同一运行中实例、无需重启
    //    (CACHE_CHECK:RegistrySourceProvider.list() 每次都 fs.readFile,零缓存)。
    const afterUninstall = await getAgentSources(base);
    const foundAfter = afterUninstall.sources.some(
      (s) => s.id === myRealpath || s.source === myAgentDir,
    );
    check("GET /api/agent-sources 卸载后不再包含该目录(Req 9.4)", !foundAfter);
    if (foundAfter) {
      console.error(`[diag] /api/agent-sources 响应: ${JSON.stringify(afterUninstall)}`);
    }

    if (/ERR_MODULE_NOT_FOUND|Cannot find (module|package)/.test(instanceStderr)) {
      check("实例无模块解析错误", false);
      console.error(`[diag] instance stderr(尾部):\n${instanceStderr.slice(-2000)}`);
    }
  } catch (err) {
    check(`离线端到端验证: ${err.message}`, false);
  } finally {
    if (instance && !instance.killed) {
      instance.kill("SIGINT");
      await sleep(500);
      if (!instance.killed) instance.kill("SIGKILL");
    }
    rmSync(tmpParent, { recursive: true, force: true });
  }

  console.log(failures.length ? `\nFAIL: ${failures.length} 项` : "\nPASS: 全部通过");
  process.exit(failures.length ? 1 : 0);
}

main();
