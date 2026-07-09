#!/usr/bin/env node
/**
 * pi-web — 全局可安装 CLI 启动器(spec pi-web-cli)。
 *
 * 薄启动器:把命令行参数翻译为应用已识别的运行时配置(`loadConfig()` 读取的 env),
 * 再拉起 Next standalone 自包含产物的 `server.js`,业务代码零改动。
 *
 *   pi-web [source] [options]
 *
 * source 省略时默认当前工作目录。纯函数 `parseCliArgs` / `buildEnv` 被导出以便单测;
 * 副作用(spawn / open)集中在 `main()`,仅在作为程序入口执行时触发。
 */
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { get as httpGet } from "node:http";
import { connect as netConnect } from "node:net";
import { platform } from "node:os";

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 300;

/** 可读的用法错误;main 捕获后打印并以非零退出,不启动服务器。 */
export class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
  }
}

/** source 是否为 git 形态(不可当本地路径绝对化)。 */
function looksLikeGitSource(source) {
  return /^(git:|https?:|ssh:|git@)/.test(source) || source.includes("://");
}

/**
 * 解析 argv 为结构化选项。未知/非法选项抛 CliUsageError(Req 5.3);
 * --help/-h、--version/-v 经 intent 短路(Req 5.1, 5.2)。
 * @param {readonly string[]} argv  process.argv.slice(2)
 */
export function parseCliArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        port: { type: "string", short: "p" },
        host: { type: "string" },
        cwd: { type: "string" },
        "agent-dir": { type: "string" },
        open: { type: "boolean", default: false },
        stub: { type: "boolean", default: false },
        watch: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const m = raw.match(/Unknown option '([^']+)'/);
    throw new CliUsageError(m ? `未知选项 ${m[1]}` : raw);
  }

  const { values, positionals } = parsed;
  if (values.help) return { intent: "help", open: false, stub: false };
  if (values.version) return { intent: "version", open: false, stub: false };

  let port;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new CliUsageError(`--port 取值非法: "${values.port}"(应为 1-65535 的整数)`);
    }
  }
  if (positionals.length > 1) {
    throw new CliUsageError(`只接受一个位置参数 [source],收到 ${positionals.length} 个`);
  }

  return {
    intent: "run",
    source: positionals[0],
    port,
    host: values.host,
    cwd: values.cwd,
    agentDir: values["agent-dir"],
    open: values.open,
    stub: values.stub,
    watch: values.watch,
  };
}

/**
 * 选项 → 运行时 env 映射(纯函数, Req 2.x)。
 * 相对 source/cwd 以 baseCwd(用户调用 CLI 的目录)为基准绝对化,因 standalone server
 * 进程的 cwd 会变(research §2.2)。仅透传凭据,不在此打印任何值(Req 2.7)。
 * @param {object} opts   parseCliArgs 的 run 结果
 * @param {string} baseCwd 用户调用 CLI 时的工作目录
 * @param {NodeJS.ProcessEnv} baseEnv
 * @returns {Record<string, string | undefined>}
 */
export function buildEnv(opts, baseCwd, baseEnv) {
  const rawSource = opts.source ?? baseCwd; // 省略 → 当前目录(Req 1.3)
  const source = looksLikeGitSource(rawSource)
    ? rawSource
    : isAbsolute(rawSource)
      ? rawSource
      : resolve(baseCwd, rawSource);
  const cwd = opts.cwd
    ? isAbsolute(opts.cwd)
      ? opts.cwd
      : resolve(baseCwd, opts.cwd)
    : baseCwd;

  const env = {
    ...baseEnv,
    PI_WEB_DEFAULT_SOURCE: source,
    PI_WEB_DEFAULT_CWD: cwd,
    PORT: String(opts.port ?? DEFAULT_PORT),
    HOSTNAME: opts.host ?? DEFAULT_HOST,
    // CLI 已确定 agent source → 直接进会话、跳过选源页(前端读此信号)。
    PI_WEB_AUTOSTART: "1",
  };
  if (opts.agentDir) {
    env.PI_WEB_AGENT_DIR = isAbsolute(opts.agentDir)
      ? opts.agentDir
      : resolve(baseCwd, opts.agentDir);
  }
  if (opts.stub) env.PI_WEB_STUB_AGENT = "1";
  // --watch:监视本地 agent source 目录,变化时让活跃会话 runner 空闲重启(续会话)。
  // 复用既有 hot-reload 机制:PI_WEB_WATCH 放开 dev 门控,PI_RUNNER_HOT_RELOAD_PATHS 指定路径。
  // git 来源无本地目录可监视,跳过(纯函数静默;告警在 main)。
  if (opts.watch && !looksLikeGitSource(rawSource)) {
    env.PI_WEB_WATCH = "1";
    env.PI_RUNNER_HOT_RELOAD_PATHS = source;
  }
  return env;
}

/**
 * 轮询 host:port 直至可连(任何 HTTP 响应即视为就绪)。
 * 导出供桌面壳(@blksails/pi-web-desktop,spec pi-web-desktop)复用同一就绪判定,
 * 避免探针逻辑在 CLI 与桌面壳间分叉。
 */
export function waitForReady(host, port, signal) {
  const pollHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  return new Promise((resolveReady, reject) => {
    const tick = () => {
      if (signal?.aborted) return reject(new Error("服务器在就绪前退出"));
      const req = httpGet({ host: pollHost, port, path: "/", timeout: 2000 }, (res) => {
        res.resume();
        resolveReady();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error(`等待服务器就绪超时(${READY_TIMEOUT_MS}ms)`));
        else setTimeout(tick, READY_POLL_MS);
      });
      req.on("timeout", () => req.destroy());
    };
    tick();
  });
}

/** 探测端口是否空闲:能连上=被占用(false),连接被拒=空闲(true)。 */
function isPortFree(host, port) {
  const probeHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return new Promise((res) => {
    const sock = netConnect({ host: probeHost, port, timeout: 1000 });
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

/** 从 startPort 起递增找首个空闲端口(最多 maxTries 个);都被占用返回 undefined。 */
export async function findFreePort(host, startPort, maxTries = 20) {
  for (let i = 0; i < maxTries; i++) {
    const p = startPort + i;
    if (p > 65535) break;
    if (await isPortFree(host, p)) return p;
  }
  return undefined;
}

/** 把通配/未指定主机映射为可导航地址,用于打印与打开浏览器。 */
function displayHostOf(host) {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

/** 按平台用系统默认浏览器打开 url;失败仅告警,不终止(Req 6.3)。 */
export function openBrowser(url) {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "cmd" : "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => console.warn(`[pi-web] 无法自动打开浏览器,请手动访问 ${url}`));
    child.unref();
  } catch {
    console.warn(`[pi-web] 无法自动打开浏览器,请手动访问 ${url}`);
  }
}

/**
 * 自包含产物入口的绝对路径(随包分发)。
 *
 * ★ 入口位于**产物根**(`dist/server.mjs`),不是子目录。`launch()` 以 `dirname(serverJs)`
 * 作 cwd,而 `packages/server` 的 `runnerBootstrapPath()` / `resolvePiCliEntry()` 在
 * `import.meta.url` 被打包器内联后会回退到 `process.cwd()` —— 那个回退必须落在产物根。
 *
 * 导出供桌面壳复用 CLI 布局下的产物定位(桌面打包态另有 process.resourcesPath 路径,见 spec)。
 */
export function distServerJs() {
  const distDir = process.env.PI_WEB_DIST_DIR ?? "dist";
  return join(PKG_ROOT, distDir, "server.mjs");
}

/** @deprecated 旧名(Next standalone 时代);保留一轮以免外部调用方骤断。 */
export const standaloneServerJs = distServerJs;

/** 随包载荷目录(npm `files` 与 tauri `bundle.resources` 都以此名分发)。 */
const PAYLOAD_DIR = join(PKG_ROOT, "payload");

/**
 * 载入随包解包器。`payload/unpack.mjs` 是构建生成物,仓库里可能不存在,故必须运行时载入。
 *
 * ★ 用 `createRequire` 而非 `await import(变量)`:后者经 vite 的 ssrTransform 会产出
 *   rollup 解析不了的代码(`Expected ident`),使 test/cli/cli-args.test.ts 整个套件无法收集
 *   —— 该测试经 `@/bin/pi-web.mjs` 别名导入本文件。字面量 import 无此问题,`@vite-ignore`
 *   与包一层函数都无效,唯一不引入 eval 的出路是 `require`。
 *   Node >= 22.12 的 `require(esm)` 可同步加载无顶层 await 的 ESM,`engines` 已要求 >= 22.19。
 */
function loadUnpacker() {
  return createRequire(import.meta.url)(join(PAYLOAD_DIR, "unpack.mjs"));
}

/**
 * 解析出可用的产物入口(spec shared-runtime-payload,Req 1.x / 8.1)。
 *
 * 三级解析,命中即停：
 *   ① `PI_WEB_DIST_DIR` 覆盖      —— 隔离构建 / e2e,不解包
 *   ② `PKG_ROOT/dist/server.mjs` —— 仓库内已构建的产物(开发态),不解包
 *   ③ 随包载荷 → 共享运行时目录  —— npm 安装态,首次触发解包
 *
 * ★ 分支 ①② 的存在使既有的 cli-smoke / cli-real / cli-watch 与桌面壳的未打包 e2e
 *   零改动继续通过,也让开发迭代不被首启解包拖慢、不污染 ~/.pi/web。
 *   **代价**：它们因此完全测不到解包路径,那只由 cli-reloc 与 desktop-packaged 覆盖。
 *
 * @returns {Promise<{serverJs: string, runtime?: {runtimeRoot: string, runtimeDir: string}}>}
 */
export async function resolveRuntime() {
  const direct = distServerJs();
  if (process.env.PI_WEB_DIST_DIR || existsSync(direct)) {
    return { serverJs: direct };
  }

  const { ensureRuntime } = loadUnpacker();
  const res = await ensureRuntime({ payloadDir: PAYLOAD_DIR });
  if (res.unpacked) {
    console.log(`[pi-web] 首次启动,已解包运行时 → ${res.distRoot}(${res.elapsedMs}ms)`);
  }
  return { serverJs: res.serverJs, runtime: { runtimeRoot: res.runtimeRoot, runtimeDir: res.runtimeDir } };
}

/**
 * 回收旧运行时目录。**尽力而为**：必须在后端已拉起之后调用,任何失败都被吞掉(Req 5.4/5.5)。
 *
 * `load` 是注入接缝：解包器是构建生成物,仓库里未构建时它不存在。单测须能**强制**触发
 * 「解包器缺失」这条分支,而不是依赖 `payload/` 恰好没被构建 —— 那样测试会在标准
 * `pnpm build:dist` 流程下静默退化成另一个用例的重复。
 */
export function scheduleRuntimeGc(runtime, load = loadUnpacker) {
  if (!runtime) return;
  void (async () => {
    try {
      const { gcRuntimeRoot } = load();
      await gcRuntimeRoot(runtime.runtimeRoot, runtime.runtimeDir);
    } catch {
      // GC 永不影响启动(Req 5.4)。
    }
  })();
}

/**
 * 启动并监管 standalone server(Req 3.x, 4.4, 1.4)。
 * @returns {Promise<number>} 子进程退出码
 */
export async function launch({ serverJs, host, port, env, open, onStarted }) {
  if (!existsSync(serverJs)) {
    console.error(
      `[pi-web] 未找到自包含产物 ${serverJs}\n` +
        `  请先构建: \`pnpm build:dist\`(或 \`npm run build:dist\`)。`,
    );
    return 1;
  }
  // 端口选择(Req 2.8):从指定/默认端口起自动递增找空闲端口。被占不报错而是自动切换,
  // 避免就绪探测打到占用方误判就绪、--open 打开陌生服务(审查 M1)。
  const chosen = await findFreePort(host, port, 20);
  if (chosen === undefined) {
    console.error(
      `[pi-web] 端口 ${port}~${port + 19} 均被占用,请用 -p 指定其他端口。`,
    );
    return 1;
  }
  if (chosen !== port) {
    console.log(`[pi-web] 端口 ${port} 被占用,自动改用 ${chosen}。`);
    port = chosen;
    env = { ...env, PORT: String(port) };
  }
  // ★ cwd = 产物根。runnerBootstrapPath()/resolvePiCliEntry() 的 cwd 回退依赖它。
  const distRoot = dirname(serverJs);
  const child = spawn(process.execPath, [serverJs], {
    cwd: distRoot,
    env,
    stdio: "inherit",
  });

  // 后端已拉起。此后才允许触发运行时回收(Req 5.5:GC 不得阻塞后端拉起)。
  onStarted?.();

  let exited = false;
  const exitPromise = new Promise((resolveExit) => {
    child.on("exit", (code) => {
      exited = true;
      resolveExit(code ?? 0);
    });
    child.on("error", (err) => {
      exited = true;
      console.error(`[pi-web] 启动服务器失败: ${err.message}`);
      resolveExit(1);
    });
  });

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      if (!child.killed) child.kill(sig);
    });
  }

  const url = `http://${displayHostOf(host)}:${port}`;
  waitForReady(host, port, { get aborted() { return exited; } })
    .then(() => {
      if (exited) return;
      console.log(`\n[pi-web] 就绪 → ${url}`);
      if (open) openBrowser(url);
    })
    .catch((err) => {
      // 端口占用等导致子进程早退或就绪超时(Req 3.4):若子进程已退,退出码透传即可。
      if (!exited) console.error(`[pi-web] ${err.message}(端口 ${port} 可能被占用)`);
    });

  return exitPromise;
}

const HELP = `pi-web — 启动一个本地 pi-web 实例

用法:
  pi-web [source] [options]

参数:
  source              agent source(本地目录或 git 来源);省略则用当前目录

选项:
  -p, --port <n>      监听端口(默认 ${DEFAULT_PORT})
      --host <h>      绑定主机(默认 ${DEFAULT_HOST})
      --cwd <dir>     会话工作目录(默认当前目录)
      --agent-dir <dir> pi 配置目录(默认 ~/.pi/agent)
      --open          就绪后用默认浏览器打开
      --stub          以确定性 stub agent 运行(离线冒烟)
      --watch         监视 agent source 目录,文件变化时重载会话(仅本地目录)
  -h, --help          显示本帮助并退出
  -v, --version       显示版本并退出

示例:
  pi-web                       # 用当前目录作为 agent source
  pi-web ./examples/hello-agent -p 8080 --open
`;

/** 解包失败的判别式错误码 → 用户下一步该做什么。文案与 payload/unpack.mjs 的 describeErrorCode 同源。 */
const RUNTIME_ERROR_HINTS = {
  "runtime-root-unwritable":
    "运行时目录不可写。请检查该路径的权限,或经 PI_WEB_RUNTIME_ROOT 指定其他位置。",
  "disk-full": "磁盘空间不足,无法解包运行时。请清理磁盘后重试。",
  "payload-missing": "随包运行时载荷缺失。请重新安装 @blksails/pi-web。",
  "payload-corrupt": "随包运行时载荷已损坏。请重新安装 @blksails/pi-web。",
  "zstd-unsupported": "当前 Node 版本过低,不支持 zstd 解压。请升级到 Node >= 22.15.0。",
  "lock-timeout": "等待其他进程完成运行时解包超时。请确认没有其他实例卡住,然后重试。",
  default: "解包运行时失败。",
};

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseCliArgs(argv);
  } catch (err) {
    console.error(`[pi-web] ${err instanceof Error ? err.message : String(err)}`);
    console.error(`\n运行 \`pi-web --help\` 查看用法。`);
    return 1;
  }
  if (opts.intent === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (opts.intent === "version") {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }
  if (opts.watch && opts.source && looksLikeGitSource(opts.source)) {
    console.warn("[pi-web] --watch 仅适用于本地目录 source,git 来源已跳过文件监视。");
  }
  const env = buildEnv(opts, process.cwd(), process.env);

  let resolved;
  try {
    resolved = await resolveRuntime();
  } catch (err) {
    // 解包失败的判别式错误码由 payload/unpack.mjs 给出;此处只翻成可读文案(Req 4.1-4.4)。
    const code = err?.code ?? "extract-failed";
    console.error(`[pi-web] 无法准备运行时(${code}): ${err?.message ?? err}`);
    console.error(`  ${RUNTIME_ERROR_HINTS[code] ?? RUNTIME_ERROR_HINTS.default}`);
    return 1;
  }

  return launch({
    serverJs: resolved.serverJs,
    host: env.HOSTNAME,
    port: Number(env.PORT),
    env,
    open: opts.open,
    onStarted: () => scheduleRuntimeGc(resolved.runtime),
  });
}

// process.argv[1] 经 npm link / 全局安装可能是符号链接,需 realpath 后再与
// import.meta.url(已解析的真实路径)比较,否则作为命令调用时 main() 不触发。
let invoked = "";
try {
  if (process.argv[1]) invoked = realpathSync(process.argv[1]);
} catch {
  invoked = process.argv[1] ?? "";
}
// 当本模块被**内联打包**进别的入口(如桌面壳 @blksails/pi-web-desktop 经 esbuild 复用纯函数)时,
// argv[1] 会等于宿主入口 → 入口守卫误判为 main 而在宿主内二次执行 CLI。宿主在打包 banner 里置
// `globalThis.__PI_WEB_CLI_EMBEDDED__=true` 声明「仅复用库、勿自跑」;进程内标记不随子进程传播,
// 且 CLI 正常运行时该标记恒未定义,故本守卫向后兼容、零行为变更。
const isMain =
  import.meta.url === pathToFileURL(invoked).href &&
  globalThis.__PI_WEB_CLI_EMBEDDED__ !== true;
if (isMain) {
  main().then((code) => {
    process.exitCode = code;
  });
}
