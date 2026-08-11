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
import { parseArgs, parseEnv } from "node:util";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, extname, join, resolve, isAbsolute } from "node:path";
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

/**
 * Load caller-side env files before spawning the relocated standalone server.
 * The child runs from `dist/`, so the server-side loader cannot see the user's
 * `.env` / `.env.local` in the invocation directory.
 *
 * @param {string} [cwd]
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [targetEnv]
 * @returns {readonly string[]}
 */
export function loadEnvFiles(cwd = process.cwd(), targetEnv = process.env) {
  const merged = {};
  const loaded = [];
  for (const name of [".env", ".env.local"]) {
    let raw;
    try {
      raw = readFileSync(join(cwd, name), "utf8");
    } catch {
      continue;
    }
    try {
      Object.assign(merged, parseEnv(raw));
    } catch {
      process.stderr.write(`[pi-web] ${name} 解析失败,已跳过\n`);
      continue;
    }
    loaded.push(name);
  }
  for (const [key, value] of Object.entries(merged)) {
    if (targetEnv[key] === undefined) targetEnv[key] = value;
  }
  return loaded;
}

/** source 是否为 git 形态(不可当本地路径绝对化)。 */
function looksLikeGitSource(source) {
  return /^(git:|https?:|ssh:|git@)/.test(source) || source.includes("://");
}

/**
 * 已知子命令名(spec cli-package-commands,Req 1.2, 1.6;`add` 归 spec cli-component-add;
 * `build` 归 spec cli-agent-build 任务 4.1,Req 1.1)。
 * @typedef {"add" | "build" | "create" | "install" | "uninstall" | "list" | "update" | "publish" | "run"} SubcommandName
 */
export const SUBCOMMAND_NAMES = /** @type {const} */ ([
  "add",
  "build",
  "create",
  "install",
  "uninstall",
  "list",
  "update",
  "publish",
  "run",
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
  build: {
    summary: "为 agent source 构建 webext / pane 产物(spec cli-agent-build)",
    options: {
      panes: { type: "string" },
      sign: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    usage: `用法: pi-web build [source] [options]

在 agent source 目录内构建 webext / pane 产物,写入约定的产物目录
(默认 .pi/web/dist)。省略 [source] 时以当前工作目录作为 agent source 根,
构建工具链与样式预设由 pi-web 自身提供,agent 侧不必声明或自带构建脚本。

选项:
      --panes <path>  显式指定 pane 声明模块路径(缺省按约定发现)
      --sign <key>    对 manifest 签名的 Ed25519 私钥(base64 pkcs8)
      --out <dir>     产物输出目录(缺省为 agent source 的约定产物目录)
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
      kind: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    usage: `用法: pi-web install <source> [options]

<source> 的形态判别:带来源类型前缀、协议头(git:/https:/ssh:)或文件系统路径形态
的实参视为直接来源,不联系注册表;其余视为注册表包标识,先解析并验签再安装。

选项:
      --project              以项目级作用域安装(默认用户级)
      --kind <agent|plugin>  显式指定包类型(npm/git 直连来源默认按 plugin 处理)
  -h, --help                 显示本帮助并退出
`,
  },
  uninstall: {
    summary: "卸载已安装的 agent 或 plugin",
    options: {
      project: { type: "boolean", default: false },
      kind: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    usage: `用法: pi-web uninstall <name> [options]

选项:
      --project              以项目级作用域卸载(默认用户级)
      --kind <agent|plugin>  显式指定包类型(缺省按已安装状态探测,探测不到则默认 plugin)
  -h, --help                 显示本帮助并退出
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
      --key <path>      签名私钥路径(可选;省略则用本机密钥 ~/.pi-web/keys/publish.json,不存在时自动生成)
      --channel <name>  发布通道(未指定时使用稳定通道)
      --commit-only     只提交版本,不移动发布通道指向
  -h, --help            显示本帮助并退出
`,
  },
  run: {
    summary: "用提示词启动实例并自动创建会话、上传附件、发送首条消息",
    options: {
      source: { type: "string" },
      model: { type: "string", short: "m" },
      provider: { type: "string" },
      "aigc-model": { type: "string" },
      "aigc-size": { type: "string" },
      attachment: { type: "string", multiple: true },
      attachments: { type: "string", multiple: true },
      port: { type: "string", short: "p" },
      host: { type: "string" },
      cwd: { type: "string" },
      "agent-dir": { type: "string" },
      open: { type: "boolean", default: false },
      stub: { type: "boolean", default: false },
      trust: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    usage: `用法: pi-web run <prompt> [options]

用一条提示词拉起 pi-web 实例,自动建会话、上传附件并发出首条消息。
就绪后默认保持服务运行;配合 --open 打开浏览器进入该会话页。

参数:
  <prompt>              首条用户消息(必填)

选项:
      --source <dir>    agent source(本地目录或 git 来源;默认当前目录)
  -m, --model <id>      对话模型 id(写入 PI_WEB_DEFAULT_MODEL,并在会话创建时覆盖)
      --provider <name> 对话 provider 名(写入 PI_WEB_DEFAULT_PROVIDER;与 --model 同时给出时还会 setModel)
      --aigc-model <id> 图像工具默认模型(会话偏好 aigc.model,如 gpt-image-2-cf)
      --aigc-size <size> 图像输出尺寸偏好 aigc.size(如 auto/1024x1024;省略时若设了 --aigc-model 则默认 auto,避免卡在 UI 选尺寸)
      --attachment <path>
                        附件路径(可重复;支持 @path 前缀)
      --attachments <path> [path...]
                        一个或多个附件(逗号分隔或空格分隔;支持 @path)
  -p, --port <n>        监听端口(默认 ${DEFAULT_PORT})
      --host <h>        绑定主机(默认 ${DEFAULT_HOST})
      --cwd <dir>       会话工作目录(默认当前目录)
      --agent-dir <dir> pi 配置目录(默认 ~/.pi/agent)
      --open            就绪并完成首条消息后用默认浏览器打开会话页
      --stub            以确定性 stub agent 运行(离线冒烟)
      --trust           显式信任 agent source 的 .pi/ 扩展
  -h, --help            显示本帮助并退出

示例:
  pi-web run '画一只猫' --source ./examples/aigc-canvas-agent --open
  pi-web run '参考图片生成新设计,保持风格,移除水印' \\
    --source ./aigc-agent -m qwen3.8-max --provider dashscope-token-plan \\
    --aigc-model gpt-image-2-cf \\
    --attachments @images/1.jpg @images/2.jpg --open

输出约定:
  stdout  本轮 assistant 文本(流式 text-delta;可管道)
  stderr  阶段日志 / 后端 PILOG / 会话 URL
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
 * 展开 `run` 子命令的附件参数:把
 *   `--attachments @a.jpg @b.jpg` / `--attachments a,b` / 重复 `--attachment`
 * 统一成可被 `parseArgs({ multiple: true })` 吃掉的重复 `--attachment` 形态。
 * 纯函数,供单测覆盖。
 * @param {readonly string[]} rest
 * @returns {string[]}
 */
export function expandRunAttachmentArgv(rest) {
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (tok === "--attachments" || tok === "--attachment") {
      i += 1;
      /** @type {string[]} */
      const paths = [];
      while (i < rest.length && !rest[i].startsWith("-")) {
        const raw = rest[i];
        for (const part of raw.split(",")) {
          const t = part.trim();
          if (t.length > 0) paths.push(t);
        }
        i += 1;
      }
      i -= 1; // for-loop 会再 +1
      if (paths.length === 0) {
        // 保留原 flag,交给 parseArgs 报「缺值」
        out.push("--attachment");
      } else {
        for (const p of paths) {
          out.push("--attachment", p);
        }
      }
      continue;
    }
    out.push(tok);
  }
  return out;
}

/** 去掉可选的 `@` 附件前缀(shell 友好写法)。 */
export function stripAttachmentAtPrefix(pathLike) {
  return pathLike.startsWith("@") ? pathLike.slice(1) : pathLike;
}

/**
 * 把 `run` 子命令的 parseArgs 结果变成结构化 run-task 意图。
 * @param {{ values: Record<string, unknown>, positionals: string[] }} parsed
 */
function buildRunTaskIntent(parsed) {
  const { values, positionals } = parsed;
  if (positionals.length === 0) {
    throw new CliUsageError("run: 缺少提示词 <prompt>(运行 `pi-web run --help` 查看用法)");
  }
  if (positionals.length > 1) {
    throw new CliUsageError(
      `run: 只接受一个位置参数 <prompt>,收到 ${positionals.length} 个;` +
        `附件请用 --attachment / --attachments(运行 \`pi-web run --help\`)`,
    );
  }

  let port;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new CliUsageError(`run: --port 取值非法: "${values.port}"(应为 1-65535 的整数)`);
    }
  }

  /** @type {string[]} */
  const rawAttachments = Array.isArray(values.attachment) ? values.attachment : [];
  const attachments = rawAttachments.map((p) => stripAttachmentAtPrefix(String(p)));

  return {
    intent: "run-task",
    prompt: positionals[0],
    source: values.source,
    model: values.model,
    provider: values.provider,
    aigcModel: values["aigc-model"],
    // 未显式给 size、但给了 aigc-model 时默认 auto,避免 image_* 在 hasUI 下卡在 select。
    aigcSize:
      values["aigc-size"] ??
      (typeof values["aigc-model"] === "string" && values["aigc-model"].length > 0
        ? "auto"
        : undefined),
    attachments,
    port,
    host: values.host,
    cwd: values.cwd,
    agentDir: values["agent-dir"],
    open: Boolean(values.open),
    stub: Boolean(values.stub),
    trust: Boolean(values.trust),
    watch: false,
  };
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
 * ★ 刻意不写精确的判别联合:`bin/` 不在 tsconfig 的 include 内,且 `allowJs` 会对
 * 多分支 return 做结构推断;若让 `intent` 宽成 `string` 或写出精确联合,既有
 * `cli-*.test.ts` 在未 narrow 时访问 `.source`/`.name`/`.prompt` 就会炸 —— 而
 * 「既有测试零改动且仍通过」正是需求 1.1 的证据本身。故显式 `@returns {any}`。
 *
 * @param {readonly string[]} argv  process.argv.slice(2)
 * @returns {any}
 */
export function parseCliArgs(argv) {
  const first = argv[0];
  if (first !== undefined && isSubcommandName(first)) {
    const rest = argv.slice(1);
    // `run` 在壳层完整解析为 run-task 意图(不走 dist/cli-commands 包管理分发),
    // 以便复用 launch() + HTTP 编排,与 create/install 等包管理子命令分流。
    if (first === "run") {
      const expanded = expandRunAttachmentArgv(rest);
      const parsed = parseSubcommandArgs("run", expanded);
      if (parsed.values.help) {
        return { intent: "help", subcommand: "run" };
      }
      return buildRunTaskIntent(parsed);
    }
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
  // run-task / 显式默认模型:覆盖 settings.json 的 defaultModel / defaultProvider。
  if (typeof opts.model === "string" && opts.model.length > 0) {
    env.PI_WEB_DEFAULT_MODEL = opts.model;
  }
  if (typeof opts.provider === "string" && opts.provider.length > 0) {
    env.PI_WEB_DEFAULT_PROVIDER = opts.provider;
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
 * 解析出可用的子命令实现产物路径(spec cli-agent-build 任务 1.2,Req 1.7)。
 *
 * `distCliCommandsJs()` 只拼 `PKG_ROOT/<dist>/cli-commands.mjs`。分发解包形态下
 * (npm 安装态:包根只有 `bin/` + `payload/`,没有 `dist/`)该路径必然不存在——子命令因此
 * 100% 报「未找到子命令实现产物」,即便随包载荷解包出的运行时里明明有这份产物
 * (research.md F1;e2e/cli/cli-reloc.mjs 任务 1.1 的 F1 守卫复现该红)。
 *
 * 修复策略:`distCliCommandsJs()` 直接命中即用,行为与既有环境变量覆盖(`PI_WEB_DIST_DIR`)
 * 逐字节一致,`distCliCommandsJs()` 自身保持同步纯函数、既有单测零改动;仅在缺失时才
 * 回落 `resolveRuntime()`——与 `launch()` 解析 `server.mjs` 共用同一套三级解析
 * (① `PI_WEB_DIST_DIR` ② 仓库内已构建产物 ③ 随包载荷解包),命中已解包运行时时不重复解包,
 * cli-commands.mjs 与该次解析得到的 `server.mjs` 同处产物根。
 *
 * `existsFn` / `resolveRuntimeFn` 是注入接缝(同 `scheduleRuntimeGc(runtime, load)` 的模式):
 * 默认走真实 `existsSync` / `resolveRuntime`,单测借此在不触碰真实文件系统与解包 I/O 的前提下,
 * 判别式地证明「direct 缺失时确实改用注入解析结果」而非误报绿(见 discriminant-probe 方法论)。
 *
 * @param {{ existsFn?: (p: string) => boolean, resolveRuntimeFn?: () => Promise<{serverJs: string, runtime?: {runtimeRoot: string, runtimeDir: string}}> }} [deps]
 * @returns {Promise<{cliCommandsJs: string, runtime?: {runtimeRoot: string, runtimeDir: string}}>}
 */
export async function resolveCliCommandsJs(deps = {}) {
  const { existsFn = existsSync, resolveRuntimeFn = resolveRuntime } = deps;
  const direct = distCliCommandsJs();
  if (existsFn(direct)) return { cliCommandsJs: direct };
  const resolved = await resolveRuntimeFn();
  return {
    cliCommandsJs: join(dirname(resolved.serverJs), "cli-commands.mjs"),
    runtime: resolved.runtime,
  };
}

/**
 * 构造注入 `runSubcommand` 的候选路径 deps(spec cli-agent-build 任务 1.5,Req 1.7, 4.2, 4.5)。
 *
 * 沿用既有 `examplesRootCandidates` 的两级构造模式(产物根优先、包根兜底),为
 * `pi-web build`(任务 3.2 起实现)追加同构的两组候选:
 *  - `toolchainRootCandidates`:解析构建工具链(esbuild/postcss/tailwindcss/autoprefixer)
 *    的 `node_modules` 根 —— 分发形态下这些包由 `scripts/pack-dist.mjs` 的
 *    `RUNTIME_PACKAGES` hoist 进 `<distRoot>/node_modules`(任务 1.3);开发形态下兜底到
 *    `<pkgRoot>/node_modules`。
 *  - `stylePresetCandidates`:解析画布样式预设 `tailwind-preset.ts` —— 分发形态下由
 *    `packWorkspacePackages()` 的第 5 类拷贝写入 `<distRoot>/packages/ui/tailwind-preset.ts`
 *    (任务 1.4);开发形态下兜底到仓库内 `<pkgRoot>/packages/ui/tailwind-preset.ts`。
 *
 * 纯函数:只做字符串拼接,不触碰文件系统 —— 消费方(`server/cli/build/toolchain.ts`,
 * 任务 3.2)用 `resolveFirstExistingCandidate()` 取第一个真实存在者。本任务只建立注入
 * 接缝,尚未接消费方(未来任务职责)。
 *
 * @param {string} distRoot 子命令实现产物所在目录(`cli-commands.mjs` 的 dirname)。
 * @param {string} pkgRoot 包根(即 `PKG_ROOT`,开发期等于仓库根)。
 * @returns {{
 *   examplesRootCandidates: string[],
 *   toolchainRootCandidates: string[],
 *   stylePresetCandidates: string[],
 * }}
 */
export function buildCandidatePathDeps(distRoot, pkgRoot) {
  return {
    examplesRootCandidates: [join(distRoot, "examples"), join(pkgRoot, "examples")],
    toolchainRootCandidates: [join(distRoot, "node_modules"), join(pkgRoot, "node_modules")],
    stylePresetCandidates: [
      join(distRoot, "packages/ui/tailwind-preset.ts"),
      join(pkgRoot, "packages/ui/tailwind-preset.ts"),
    ],
  };
}

/**
 * 从候选路径数组中选出第一个存在者(spec cli-agent-build 任务 1.5,Req 1.7, 4.2, 4.5)。
 *
 * 与 `resolveCliCommandsJs()` 同一 `existsFn` 注入接缝:单测借此在不触碰真实文件系统的
 * 前提下,判别式地证明「首个存在」与「全部缺失」两个分支各自的返回值
 * (discriminant-probe 方法论)。`buildCandidatePathDeps()` 构造的三组候选均可用本函数解析,
 * 真正的消费落在 `server/cli/build/toolchain.ts`(任务 3.2)。
 *
 * @param {readonly string[]} candidates
 * @param {(path: string) => boolean} [existsFn]
 * @returns {string | undefined}
 */
export function resolveFirstExistingCandidate(candidates, existsFn = existsSync) {
  return candidates.find((candidate) => existsFn(candidate));
}

/**
 * 启动并监管 standalone server(Req 3.x, 4.4, 1.4)。
 * @param {object} opts
 * @param {string} opts.serverJs
 * @param {string} opts.host
 * @param {number} opts.port
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} opts.env
 * @param {boolean} [opts.open]
 * @param {() => void} [opts.onStarted]  子进程 spawn 后立刻回调(GC 等)
 * @param {(info: { host: string, port: number, url: string }) => Promise<{ url?: string } | void> | { url?: string } | void} [opts.onReady]
 *   就绪后、打开浏览器前的异步钩子(如 `run` 建会话/传附件/发消息)。可返回 `{ url }` 覆盖浏览器目标。
 * @param {boolean} [opts.serverLogsToStderr=false]
 *   true 时把后端子进程 stdout/stderr 转发到本进程 stderr,腾出 stdout 给 `run` 的 assistant 正文。
 * @returns {Promise<number>} 子进程退出码
 */
export async function launch({ serverJs, host, port, env, open, onStarted, onReady, serverLogsToStderr }) {
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
    // 阶段信息走 stderr:与 run 的 stdout 正文契约一致,默认 start 也不混入管道。
    process.stderr.write(`[pi-web] 端口 ${port} 被占用,自动改用 ${chosen}。\n`);
    port = chosen;
    env = { ...env, PORT: String(port) };
  }
  // ★ cwd = 产物根。runnerBootstrapPath()/resolvePiCliEntry() 的 cwd 回退依赖它。
  const distRoot = dirname(serverJs);
  const child = spawn(process.execPath, [serverJs], {
    cwd: distRoot,
    env,
    // run 任务:管道并转发到 stderr,避免 PILOG 污染 assistant stdout。
    stdio: serverLogsToStderr ? ["inherit", "pipe", "pipe"] : "inherit",
  });
  if (serverLogsToStderr) {
    const forward = (chunk) => {
      try {
        process.stderr.write(chunk);
      } catch {
        // ignore
      }
    };
    child.stdout?.on("data", forward);
    child.stderr?.on("data", forward);
  }

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
    .then(async () => {
      if (exited) return;
      process.stderr.write(`\n[pi-web] 就绪 → ${url}\n`);
      let openTarget = url;
      if (onReady) {
        try {
          const result = await onReady({ host: displayHostOf(host), port, url });
          if (result && typeof result.url === "string" && result.url.length > 0) {
            openTarget = result.url;
          }
        } catch (err) {
          process.stderr.write(
            `[pi-web] 任务引导失败: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
      }
      if (open) openBrowser(openTarget);
    })
    .catch((err) => {
      // 端口占用等导致子进程早退或就绪超时(Req 3.4):若子进程已退,退出码透传即可。
      if (!exited) {
        process.stderr.write(`[pi-web] ${err.message}(端口 ${port} 可能被占用)\n`);
      }
    });

  return exitPromise;
}

const SUBCOMMAND_LIST_TEXT = SUBCOMMAND_NAMES.map(
  (name) => `  ${name.padEnd(11)} ${SUBCOMMAND_SPECS[name].summary}`,
).join("\n");

const HELP = `pi-web — 启动一个本地 pi-web 实例,或调用包管理 / 任务子命令

用法:
  pi-web [source] [options]
  pi-web run <prompt> [options]
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
  pi-web run '参考图片生成新设计' --source ./aigc-agent \\
    -m qwen-3.8-max --provider dashscope-token-plan \\
    --attachments @images/1.jpg @images/2.jpg --open
`;

/** 常见扩展名 → MIME(附件上传用;未知回落 octet-stream)。 */
const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

export function guessMimeFromPath(filePath) {
  const ext = extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** 阶段进度 → stderr,避免污染可管道的 stdout 正文。 */
function runStatus(msg) {
  process.stderr.write(`[pi-web] ${msg}\n`);
}

/**
 * 解析会话 SSE,把 assistant `text-delta` 写到 stdout;遇到 `finish`/`error`/`abort` 结束本轮。
 * 长连接在回合结束后由调用方 abort。
 *
 * @param {ReadableStream<Uint8Array>} body
 * @param {object} [opts]
 * @param {(s: string) => void} [opts.writeText]  默认 process.stdout.write
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ text: string, finishReason: "finish" | "error" | "abort" | "end" | "signal" }>}
 */
export async function pipeAssistantSseToStdout(body, opts = {}) {
  const writeText = opts.writeText ?? ((s) => process.stdout.write(s));
  // text-end 后若无后续 tool/text 活动,视为本轮可结束。
  // AIGC 常先吐一句规划再调 image_* 工具:text-end→tool 间隔可能 >500ms,默认放宽到 15s。
  // stub 挂 extension-ui 时用更短的 softCompleteMs(见 control 分支)。
  const softCompleteMs = typeof opts.softCompleteMs === "number" ? opts.softCompleteMs : 15_000;
  const extensionUiSoftMs =
    typeof opts.extensionUiSoftMs === "number" ? opts.extensionUiSoftMs : 400;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  /** @type {string[]} */
  const textParts = [];
  /** @type {"finish" | "error" | "abort" | "end" | "signal" | "text-end"} */
  let finishReason = "end";
  let done = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let softTimer;

  const stop = (reason) => {
    if (done) return;
    done = true;
    finishReason = reason;
    if (softTimer !== undefined) clearTimeout(softTimer);
    try {
      reader.cancel();
    } catch {
      // ignore
    }
  };

  const armSoftComplete = (ms = softCompleteMs) => {
    if (ms <= 0) return;
    if (softTimer !== undefined) clearTimeout(softTimer);
    softTimer = setTimeout(() => stop("text-end"), ms);
  };
  const clearSoft = () => {
    if (softTimer !== undefined) {
      clearTimeout(softTimer);
      softTimer = undefined;
    }
  };

  const onAbort = () => stop("signal");
  if (opts.signal) {
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    while (!done) {
      const { done: rd, value } = await reader.read();
      if (rd) break;
      buf += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const rawEvent = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const lines = rawEvent.split(/\r?\n/);
        let eventName = "message";
        /** @type {string[]} */
        const dataLines = [];
        for (const line of lines) {
          if (line.startsWith(":") || line.length === 0) continue;
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^\s/, ""));
        }
        if (dataLines.length === 0) continue;
        let data;
        try {
          data = JSON.parse(dataLines.join("\n"));
        } catch {
          continue;
        }
        const kind = data?.kind ?? eventName;
        if (kind === "control") {
          // extension-ui 等 CLI 无法应答:若已有正文则尽快结束本轮 stdout。
          const control = data?.payload?.control;
          if (
            (control === "extension-ui" || control === "extension_ui_request") &&
            textParts.length > 0
          ) {
            armSoftComplete(extensionUiSoftMs);
          }
          continue;
        }
        if (kind !== "uiMessageChunk") continue;
        const chunk = data.chunk ?? data;
        const type = chunk?.type;
        if (type === "text-delta" && typeof chunk.delta === "string") {
          clearSoft();
          textParts.push(chunk.delta);
          writeText(chunk.delta);
        } else if (type === "text-end") {
          armSoftComplete(softCompleteMs);
        } else if (
          type === "tool-input-start" ||
          type === "tool-input-delta" ||
          type === "tool-input-available" ||
          type === "tool-output-available" ||
          type === "tool-output-error" ||
          type === "start-step" ||
          type === "start"
        ) {
          // 工具回合进行中:取消 text-end 软结束,等 finish 或下一轮 text。
          clearSoft();
        } else if (type === "finish") {
          stop("finish");
          break;
        } else if (type === "error") {
          const errText = typeof chunk.errorText === "string" ? chunk.errorText : "stream error";
          runStatus(`assistant error: ${errText}`);
          stop("error");
          break;
        } else if (type === "abort") {
          stop("abort");
          break;
        }
      }
    }
  } catch (err) {
    if (opts.signal?.aborted || finishReason === "signal" || finishReason === "text-end" || finishReason === "finish") {
      // soft/hard stop 经 cancel 触发的读错误:忽略
    } else {
      throw err;
    }
  } finally {
    clearSoft();
    if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  if (textParts.length > 0) writeText("\n");
  return { text: textParts.join(""), finishReason };
}

/**
 * 服务就绪后编排:建会话 → (可选 setModel) → 上传附件 → 先挂 SSE → 发首条消息 →
 * 把本轮 assistant 文本流式写到 **stdout**(阶段日志在 stderr)。
 * 返回会话页 URL,供 --open 直达 `/session/:id`(UI 走 resume + 历史,不另建空会话)。
 *
 * @param {object} opts
 * @param {string} opts.baseUrl  如 http://127.0.0.1:3000
 * @param {string} opts.source
 * @param {string} [opts.cwd]
 * @param {string} opts.prompt
 * @param {string} [opts.model]
 * @param {string} [opts.provider]
 * @param {string} [opts.aigcModel]  图像工具会话偏好 `aigc.model`(如 gpt-image-2-cf)
 * @param {string} [opts.aigcSize]   图像工具会话偏好 `aigc.size`(如 auto)
 * @param {readonly string[]} [opts.attachments]  已剥 @ 的本地路径(相对 baseCwd 或绝对)
 * @param {string} [opts.baseCwd]
 * @param {boolean} [opts.trust]
 * @param {boolean} [opts.printAssistant=true]  是否把 text-delta 打到 stdout
 * @param {(s: string) => void} [opts.writeText]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{ sessionId: string, url: string, assistantText: string }>}
 */
export async function bootstrapRunTask(opts) {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const api = `${baseUrl}/api`;
  const baseCwd = opts.baseCwd ?? process.cwd();
  const printAssistant = opts.printAssistant !== false;

  const createBody = {
    source: opts.source,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.trust ? { trust: true } : {}),
  };
  const createRes = await fetchImpl(`${api}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(createBody),
  });
  if (!createRes.ok) {
    const detail = await createRes.text().catch(() => "");
    throw new Error(`创建会话失败 HTTP ${createRes.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  const created = await createRes.json();
  const sessionId = created?.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("创建会话响应缺少 sessionId");
  }
  runStatus(`会话已创建 → ${sessionId}`);

  if (opts.provider && opts.model) {
    const modelRes = await fetchImpl(`${api}/sessions/${encodeURIComponent(sessionId)}/models`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ provider: opts.provider, modelId: opts.model }),
    });
    if (!modelRes.ok) {
      const detail = await modelRes.text().catch(() => "");
      runStatus(
        `切换模型失败 HTTP ${modelRes.status}${detail ? `: ${detail.slice(0, 200)}` : ""}` +
          `(已继续发送消息,会话仍可能使用默认模型)`,
      );
    } else {
      runStatus(`对话模型已切换 → ${opts.provider}/${opts.model}`);
    }
  }

  // 图像工具偏好:会话 KV `aigc.model` / `aigc.size`。
  // ★ size 很关键:image_edit 在 hasUI 时会对缺省 size 调 ext.ui.select 并一直等待用户点选,
  // 浏览器若没弹窗/用户没注意,就会「只有 tool start、永远无 tool end」(0% CPU、无外连)。
  /** @type {Array<[string, string]>} */
  const aigcPrefs = [];
  if (typeof opts.aigcModel === "string" && opts.aigcModel.length > 0) {
    aigcPrefs.push(["aigc.model", opts.aigcModel]);
  }
  if (typeof opts.aigcSize === "string" && opts.aigcSize.length > 0) {
    aigcPrefs.push(["aigc.size", opts.aigcSize]);
  }
  for (const [key, value] of aigcPrefs) {
    const stateRes = await fetchImpl(`${api}/sessions/${encodeURIComponent(sessionId)}/state`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ key, value, op: "set" }),
    });
    if (!stateRes.ok) {
      const detail = await stateRes.text().catch(() => "");
      runStatus(
        `设置 ${key} 失败 HTTP ${stateRes.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    } else {
      runStatus(`图像偏好 → ${key}=${value}`);
    }
  }

  /** @type {string[]} */
  const attachmentIds = [];
  const attachmentPaths = opts.attachments ?? [];
  for (const raw of attachmentPaths) {
    const abs = isAbsolute(raw) ? raw : resolve(baseCwd, raw);
    if (!existsSync(abs)) {
      throw new Error(`附件不存在: ${raw}(解析为 ${abs})`);
    }
    const bytes = readFileSync(abs);
    const mime = guessMimeFromPath(abs);
    const name = basename(abs);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), name);
    const upRes = await fetchImpl(
      `${api}/sessions/${encodeURIComponent(sessionId)}/attachments`,
      {
        method: "POST",
        body: form,
        headers: { accept: "application/json" },
      },
    );
    if (!upRes.ok) {
      const detail = await upRes.text().catch(() => "");
      throw new Error(
        `上传附件失败 ${name} HTTP ${upRes.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      );
    }
    const up = await upRes.json();
    const id = up?.attachment?.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`上传附件 ${name} 响应缺少 attachment.id`);
    }
    attachmentIds.push(id);
    runStatus(`附件已上传 → ${name} (${id})`);
  }

  // 先挂 SSE,再 POST messages,避免首帧在无订阅者时丢失(见 HTTP API 竞态约定)。
  const streamAbort = new AbortController();
  const streamFetch = fetchImpl(`${api}/sessions/${encodeURIComponent(sessionId)}/stream`, {
    method: "GET",
    headers: { accept: "text/event-stream" },
    signal: streamAbort.signal,
  });

  // 给流一点建立时间(热路径通常 <100ms)。
  await new Promise((r) => setTimeout(r, 80));

  // ★ 只发 attachmentIds(服务端 injectAttachmentRefs → [attachment id=att_…])。
  // 不把多图 base64 塞进 vision `images`:aigc-agent 设计是「工具抄 att_、不见像素」;
  // 4 张 ~3MB 原图 base64 进 prompt 会撑爆回合(实测回合秒 finish、无 toolCall)。
  const msgBody = {
    message: opts.prompt,
    ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
  };
  const msgRes = await fetchImpl(`${api}/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(msgBody),
  });
  if (!msgRes.ok) {
    streamAbort.abort();
    const detail = await msgRes.text().catch(() => "");
    throw new Error(`发送消息失败 HTTP ${msgRes.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  runStatus(`首条消息已发送`);

  /** @type {string} */
  let assistantText = "";
  try {
    const streamRes = await streamFetch;
    if (!streamRes.ok || !streamRes.body) {
      runStatus(`SSE 不可用 HTTP ${streamRes.status};跳过 stdout 正文`);
    } else if (printAssistant) {
      runStatus(`assistant 输出 ↓ (stdout)`);
      const piped = await pipeAssistantSseToStdout(streamRes.body, {
        signal: streamAbort.signal,
        ...(opts.writeText ? { writeText: opts.writeText } : {}),
      });
      assistantText = piped.text;
      runStatus(`assistant 结束 (${piped.finishReason})`);
    } else {
      // 仍 drain 到 finish,避免无订阅语义漂移;不写 stdout。
      await pipeAssistantSseToStdout(streamRes.body, {
        signal: streamAbort.signal,
        writeText: () => {},
      });
    }
  } catch (err) {
    if (!streamAbort.signal.aborted) {
      runStatus(`读取 SSE 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    streamAbort.abort();
  }

  const sessionUrl = `${baseUrl}/session/${encodeURIComponent(sessionId)}`;
  runStatus(`会话页 → ${sessionUrl}`);
  return { sessionId, url: sessionUrl, assistantText };
}

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

/**
 * 间接动态 `import()`:构造成 `new Function` 求值,而非字面 `import(<expr>)` 语法
 * (任务 6.1)。
 *
 * ★ 这不是风格偏好 —— 直接写 `import(spec)`(`spec` 为运行时变量)会在 vitest 的
 * Vite SSR 转换阶段(`ssrTransformScript`,供 `@/bin/pi-web.mjs` 这类测试期 import 使用)
 * 于**解析期**报 `Expected ident` 并使*该文件的全部测试*(含与本子命令无关的
 * `cli-args.test.ts` 26 项)collect 失败 —— 与运行时执行路径无关,是 Vite 的动态 import
 * 静态分析对非字面量 specifier 的已知解析缺陷(`/* @vite-ignore *\/` 注释亦无效,已验证)。
 * `new Function("specifier", "return import(specifier);")` 把 `import()` 移到一个
 * 字符串里按普通 `Function` 构造求值,对 Vite 的源码静态扫描完全不可见,规避了这个解析期
 * 崩溃;运行时语义与直接 `import(spec)` 等价(仍是原生 ESM 动态 import,非 CJS require)。
 * CLI 是本机进程、非浏览器,不涉及 CSP `unsafe-eval` 顾虑。
 */
const dynamicImport = new Function("specifier", "return import(specifier);");

/**
 * 动态加载 `dist/cli-commands.mjs` 并调用其 `runSubcommand(name, argv, deps)`(任务 6.1,
 * Req 1.7)。产物缺失时给出可操作错误并非零退出(与 `launch()` 对 `dist/server.mjs`
 * 缺失的处理一致)。
 *
 * `examplesRootCandidates`(及 spec cli-agent-build 任务 1.5 新增的 `toolchainRootCandidates`
 * / `stylePresetCandidates`)在此(壳层)构造并传入,而非让打包进产物的 `server/cli/index.ts`
 * 自行推断 —— 该模块被 esbuild 打成单文件产物后 `import.meta.url` 会被内联,其"回退
 * process.cwd()"这条路径不可靠(见 `distCliCommandsJs()` 的 docstring)。壳层的 `PKG_ROOT`
 * (真实 `import.meta.url` 解析结果,未被打包)与 `distCliCommandsJs()` 的产物根才是可信来源:
 * `buildCandidatePathDeps()` 按序构造「产物根旁」(分发后布局)与「包根旁」(开发期布局)
 * 两级候选,消费方各自用「首个存在」的纯函数按序取第一个真实存在的。
 */
async function runSubcommandFromDist(name, argv) {
  const { cliCommandsJs } = await resolveCliCommandsJs();
  if (!existsSync(cliCommandsJs)) {
    console.error(
      `[pi-web] 未找到子命令实现产物 ${cliCommandsJs}\n` +
        `  请先构建: \`pnpm build:dist\`(或 \`npm run build:dist\`)。`,
    );
    return 1;
  }
  const distRoot = dirname(cliCommandsJs);
  const deps = buildCandidatePathDeps(distRoot, PKG_ROOT);

  // ★ 工具链预检**必须在动态载入 cli-commands 之前**做。
  // 打包后的 `cli-commands.mjs` 里，构建路径依赖的 `import { build } from "esbuild"` 是
  // **静态 ESM import**——ESM 的 import 声明无论写在文件哪一行都会提升到模块顶层执行，
  // 所以实现层再怎么改成「先 resolveToolchain 再动态 import」，在打包产物里都失效：
  // 工具链缺失时 `import(cli-commands.mjs)` 当场抛裸的 ERR_MODULE_NOT_FOUND，永远走不到
  // 实现层那句友好报错。壳层是唯一能在模块加载前拦截的位置，而它恰好已经持有工具链候选
  // 路径（cli-agent-build 任务 1.5）。此处只用 `node:fs`，不破坏薄壳约束。
  if (name === "build") {
    const required = ["esbuild", "postcss", "tailwindcss", "autoprefixer"];
    const roots = deps.toolchainRootCandidates ?? [];
    const hit = roots.find((root) => required.every((pkg) => existsSync(join(root, pkg, "package.json"))));
    if (hit === undefined) {
      const missingByRoot = roots.length === 0
        ? "  (未构造任何候选 node_modules 根)"
        : roots
            .map((root) => {
              const miss = required.filter((pkg) => !existsSync(join(root, pkg, "package.json")));
              return `  - ${root}\n      缺失: ${miss.join(", ") || "(无)"}`;
            })
            .join("\n");
      console.error(
        `✖ build — [BUILD_TOOLCHAIN_MISSING] 构建工具链在当前安装形态下不可用，已终止(不产出任何产物)。\n` +
          `已尝试的候选根:\n${missingByRoot}\n` +
          `请检查 pi-web 安装是否完整(重新安装，或在源码仓库内执行一次 \`pnpm build:dist\`)。`,
      );
      return 1;
    }
  }

  const mod = await dynamicImport(pathToFileURL(cliCommandsJs).href);
  return mod.runSubcommand(name, argv, deps);
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
    const { cliCommandsJs } = await resolveCliCommandsJs();
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
    return runSubcommandFromDist(opts.name, opts.argv);
  }

  // ── 默认 run 与 run-task 共用启动路径 ──────────────────────────────────
  const isRunTask = opts.intent === "run-task";
  if (opts.watch && opts.source && looksLikeGitSource(opts.source)) {
    console.warn("[pi-web] --watch 仅适用于本地目录 source,git 来源已跳过文件监视。");
  }
  // run-task 的 source 在 --source 上;缺省当前目录。复用 buildEnv 的绝对化逻辑。
  const launchOpts = isRunTask
    ? {
        ...opts,
        intent: "run",
        source: opts.source,
        open: opts.open,
        stub: opts.stub,
        watch: false,
      }
    : opts;
  // standalone child cwd = dist/; caller-side provider credentials must be
  // loaded before `buildEnv()` snapshots process.env for the child.
  loadEnvFiles(process.cwd());
  const env = buildEnv(launchOpts, process.cwd(), process.env);

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
    // run:后端日志进 stderr,stdout 专留给 assistant 文本(可管道)。
    ...(isRunTask ? { serverLogsToStderr: true } : {}),
    ...(isRunTask
      ? {
          onReady: async ({ url }) => {
            const result = await bootstrapRunTask({
              baseUrl: url,
              source: env.PI_WEB_DEFAULT_SOURCE,
              cwd: env.PI_WEB_DEFAULT_CWD,
              prompt: opts.prompt,
              model: opts.model,
              provider: opts.provider,
              aigcModel: opts.aigcModel,
              aigcSize: opts.aigcSize,
              attachments: opts.attachments,
              baseCwd: process.cwd(),
              trust: opts.trust,
            });
            return { url: result.url };
          },
        }
      : {}),
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
