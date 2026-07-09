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
 * 已知子命令名(spec cli-package-commands,Req 1.2, 1.6;`add` 归 spec cli-component-add)。
 * @typedef {"add" | "create" | "install" | "uninstall" | "list" | "update" | "publish"} SubcommandName
 */
export const SUBCOMMAND_NAMES = /** @type {const} */ ([
  "add",
  "create",
  "install",
  "uninstall",
  "list",
  "update",
  "publish",
]);

/**
 * 各子命令的选项表 + 一句话说明(Req 1.3, 1.4, 1.6)。
 *
 * ★ 此处只承载「分发层判别与校验」需要的选项**形状**,不实现任何子命令的业务逻辑
 * (归任务 3.x-9.x,`server/cli/**`)。选项名取自 requirements.md 已落定的 CLI 面,
 * 后续任务在 `server/cli` 内对同一批 argv 做真正的语义解析——两处选项表如需变化须
 * 保持同步(SubcommandRouter 的选项表是 UX 契约的第一入口)。
 */
const SUBCOMMAND_SPECS = {
  add: {
    summary: "把组件源码安装进 agent source(shadcn 式,代码归你)",
    options: {
      target: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    usage: `用法: pi-web add <source> [options]

把组件包的源码拷贝进目标 agent source 的 .pi/web/components/<id>/,
代码归你所有,可自由修改。重复 add 具备幂等更新语义(未改覆盖新版 /
已改打印 diff 拒绝 / 同版不写)。

<source> 支持(v1):本地目录,或 git 直连(须固定 ref,可带 #<子目录>),
如 git:github.com/org/repo@v1.0.0#packages/my-component。

选项:
      --target <dir>  目标 agent source(缺省当前目录;须含 .pi/web/)
      --dry-run       全部校验并列出将写入的文件与接线指引,不写任何文件
      --force         仅将 peer 基线校验失败降级为警告;不覆盖本地改动
  -h, --help          显示本帮助并退出
`,
  },
  create: {
    summary: "从模板生成 agent/plugin 骨架",
    options: {
      kind: { type: "string" },
      template: { type: "string" },
      list: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    usage: `用法: pi-web create <name> [options]

从随包分发的模板生成 agent/plugin 骨架。

选项:
      --kind <agent|plugin>  包类型(默认 agent)
      --template <name>      指定模板(默认模板见 --list)
      --list                 列出全部可用模板并退出,不创建任何文件
  -h, --help                 显示本帮助并退出
`,
  },
  install: {
    summary: "安装 agent 或 plugin",
    options: {
      project: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    usage: `用法: pi-web install <source> [options]

<source> 的形态判别:带来源类型前缀、协议头(git:/https:/ssh:)或文件系统路径形态
的实参视为直接来源,不联系注册表;其余视为注册表包标识,先解析并验签再安装。

选项:
      --project   以项目级作用域安装(默认用户级)
  -h, --help      显示本帮助并退出
`,
  },
  uninstall: {
    summary: "卸载已安装的 agent 或 plugin",
    options: {
      help: { type: "boolean", short: "h", default: false },
    },
    usage: `用法: pi-web uninstall <name> [options]

选项:
  -h, --help      显示本帮助并退出
`,
  },
  list: {
    summary: "列出已安装的包",
    options: {
      outdated: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    usage: `用法: pi-web list [options]

选项:
      --outdated  仅列出存在可用更新的包
  -h, --help      显示本帮助并退出
`,
  },
  update: {
    summary: "更新已安装的包",
    options: {
      help: { type: "boolean", short: "h", default: false },
    },
    usage: `用法: pi-web update [name] [options]

未指定 name 时更新全部可更新的包。

选项:
  -h, --help      显示本帮助并退出
`,
  },
  publish: {
    summary: "编译清单、校验并发布到注册表",
    options: {
      "dry-run": { type: "boolean", default: false },
      key: { type: "string" },
      channel: { type: "string" },
      "commit-only": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    usage: `用法: pi-web publish [options]

选项:
      --dry-run        演练模式:编译与全部校验但不发起任何外部写操作
      --key <path>      签名私钥路径
      --channel <name>  发布通道(未指定时使用稳定通道)
      --commit-only     只提交版本,不移动发布通道指向
  -h, --help            显示本帮助并退出
`,
  },
};

/** @returns {name is SubcommandName} */
function isSubcommandName(name) {
  return Object.prototype.hasOwnProperty.call(SUBCOMMAND_SPECS, name);
}

/**
 * 解析子命令自身的 argv(Req 1.5, 1.6)。非法选项抛 CliUsageError,消息含选项名与
 * 查看该子命令帮助的提示。纯函数,不触碰文件系统或网络(Req 10.1)。
 * @param {SubcommandName} name
 * @param {readonly string[]} rest  子命令名之后的剩余 argv
 */
function parseSubcommandArgs(name, rest) {
  const spec = SUBCOMMAND_SPECS[name];
  let parsed;
  try {
    parsed = parseArgs({ args: [...rest], allowPositionals: true, options: spec.options });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const m = raw.match(/Unknown option '([^']+)'/);
    const optName = m ? m[1] : undefined;
    throw new CliUsageError(
      optName
        ? `${name}: 未知选项 ${optName}(运行 \`pi-web ${name} --help\` 查看可用选项)`
        : `${name}: ${raw}(运行 \`pi-web ${name} --help\` 查看可用选项)`,
    );
  }
  return parsed;
}

/**
 * 解析 argv 为结构化选项。未知/非法选项抛 CliUsageError(Req 5.3);
 * --help/-h、--version/-v 经 intent 短路(Req 5.1, 5.2)。
 *
 * 首个位置参数若命中已知子命令名(Req 1.2),整段 argv 交由该子命令自身的选项表解析
 * (Req 1.6:各子命令选项互不串味),并短路为 `{ intent: "subcommand", name, argv }`
 * (业务分发归任务 6.1/10.1,此处只判别)。否则回落既有 `run`/`help`/`version` 解析,
 * 与本特性引入前逐字段一致(Req 1.1)。
 *
 * 返回一个以 `intent` 为判别字段的联合:`run`(选项扁平展开,与引入本特性前完全一致)、
 * `help`(可带 `subcommand`)、`version`、`subcommand`(携带**未解析的原始 argv 切片**)。
 *
 * ★ 刻意不写精确的 `@returns` 联合类型:`bin/` 不在 tsconfig 的 include 内,本模块对
 * `test/**` 呈现为 `any`。一旦标注精确联合,既有 26 项 `cli-args.test.ts` 断言就必须
 * 先 narrow 才能访问 `.source`/`.port`,即强制改动那些断言 —— 而「既有测试零改动且仍
 * 通过」正是需求 1.1「逐字节一致」的证据本身。实测标注后 tsc 新增 14 处错误。
 *
 * @param {readonly string[]} argv  process.argv.slice(2)
 */
export function parseCliArgs(argv) {
  const first = argv[0];
  if (first !== undefined && isSubcommandName(first)) {
    const rest = argv.slice(1);
    const parsed = parseSubcommandArgs(first, rest);
    if (parsed.values.help) {
      return { intent: "help", subcommand: first };
    }
    return { intent: "subcommand", name: first, argv: rest };
  }

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

/**
 * 子命令实现产物的绝对路径(spec cli-package-commands 任务 1.1,Req 10.6)。
 *
 * 与 `distServerJs()` 同处**产物根**,同样尊重 `PI_WEB_DIST_DIR`。本任务只建立
 * 「可被动态加载」的接缝:`main()` 对非 run 意图动态 `import()` 该产物并分派子命令
 * 归任务 2.1,此处不接线、不改变既有 `run` 路径行为。
 */
export function distCliCommandsJs() {
  const distDir = process.env.PI_WEB_DIST_DIR ?? "dist";
  return join(PKG_ROOT, distDir, "cli-commands.mjs");
}

/**
 * 启动并监管 standalone server(Req 3.x, 4.4, 1.4)。
 * @returns {Promise<number>} 子进程退出码
 */
export async function launch({ serverJs, host, port, env, open }) {
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

const SUBCOMMAND_LIST_TEXT = SUBCOMMAND_NAMES.map(
  (name) => `  ${name.padEnd(11)} ${SUBCOMMAND_SPECS[name].summary}`,
).join("\n");

const HELP = `pi-web — 启动一个本地 pi-web 实例,或调用包管理子命令

用法:
  pi-web [source] [options]
  pi-web <subcommand> [options]

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

子命令:
${SUBCOMMAND_LIST_TEXT}

  运行 \`pi-web <subcommand> --help\` 查看某个子命令的专属用法。

示例:
  pi-web                       # 用当前目录作为 agent source
  pi-web ./examples/hello-agent -p 8080 --open
`;

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
    if (opts.subcommand) {
      process.stdout.write(SUBCOMMAND_SPECS[opts.subcommand].usage);
    } else {
      process.stdout.write(HELP);
    }
    return 0;
  }
  if (opts.intent === "version") {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }
  if (opts.intent === "subcommand" && opts.name === "add") {
    // `add` 的专用最小分发(spec cli-component-add,任务 4):通用 runSubcommand 分发
    // 仍归 cli-package-commands 任务 6.1,落地时本分支并入其词条表。
    const cliCommandsJs = distCliCommandsJs();
    if (!existsSync(cliCommandsJs)) {
      console.error(
        `[pi-web] 未找到子命令实现产物 ${cliCommandsJs}\n` +
          `  请先构建: \`pnpm build:dist\`(或 \`npm run build:dist\`)。`,
      );
      return 1;
    }
    // ★ 经 Function 间接而非字面量 `import()`:vitest(jsdom web 管线)对本 .mjs 内的
    // 字面量动态 import 在 ssrTransformScript 阶段崩 "Expected ident"(rollup parseAst),
    // 致所有 import 本模块的既有单测整套无法收集(实测 vitest 2.1.9 + vite 5.4.21;
    // 裸 vite 同配置 transform 正常)。Node CLI 无 CSP,此间接仅为绕过测试管线解析缺陷。
    const dynamicImport = new Function("u", "return import(u)");
    const mod = await dynamicImport(pathToFileURL(cliCommandsJs).href);
    return await mod.runAdd(opts.argv);
  }
  if (opts.intent === "subcommand") {
    // 分发接缝(动态加载 dist/cli-commands.mjs、按 name 调用具体实现)归任务 6.1
    // (Wave 1:create/install/uninstall/list/update)与 10.1(publish)。本任务只
    // 判别意图,不实现任何子命令的业务逻辑 —— 此处故意不启动本地实例、不触碰
    // 文件系统或网络,如实反映「尚未接线」的当前状态。
    console.error(
      `[pi-web] 子命令 \`${opts.name}\` 尚未接入(等待后续任务完成分发接线)。`,
    );
    return 1;
  }
  if (opts.watch && opts.source && looksLikeGitSource(opts.source)) {
    console.warn("[pi-web] --watch 仅适用于本地目录 source,git 来源已跳过文件监视。");
  }
  const env = buildEnv(opts, process.cwd(), process.env);
  return launch({
    serverJs: distServerJs(),
    host: env.HOSTNAME,
    port: Number(env.PORT),
    env,
    open: opts.open,
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
