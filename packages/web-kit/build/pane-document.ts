/**
 * pane 文档构建的**通用层**(spec panes-only-right-panel;1.5 的分层修正)。
 *
 * pane 文档不是 URL,而是一整份内联 HTML:入口打成自足 IIFE + 内联 CSS + 内容安全策略,
 * 由宿主以 srcDoc 挂载。任何要迁进 pane 的 agent 面板都需要这条流水线。
 *
 * ## 为什么单独有这一层
 *
 * 1.5 最初把流水线抽在了 canvas-ui 里 —— 那对画布类 pane 合适(它要 canvas 的样式与源码
 * 扫描),但**非画布**的面板(如权威快照演示、共享状态演示)不该为了构建一个 pane 而依赖
 * 整个画布包。故通用部分下沉到这里,画布特化在 canvas-ui 里叠加。
 *
 * ## 双形态(cli-agent-build 任务 2.1)
 *
 * 同一份打包出的脚本可以渲染成两种文档:
 * - **内联形态**(`renderPaneDocument`):脚本以 `<script>` 内联,由宿主以 `srcDoc` 挂载
 *   —— 无法被外部寻址,天然不需要 `'self'` 之类的来源许可。
 * - **URL 形态**(`renderPaneUrlDocument`):脚本落盘为独立文件,文档以 `<script src>`
 *   引用它 —— 这份文档本身**可寻址**(有自己的 origin),CSP 必须放行自身来源脚本。
 *
 * 两种形态共用同一次 `bundlePaneEntry` 产出的脚本字节,调用方(构建编排层)决定把它内联
 * 进文档还是写成 sidecar 文件。
 *
 * 本模块是**构建期**代码,依赖 node 与 esbuild;不要从浏览器侧入口引用。
 */
import { build } from "esbuild";
import type { Plugin } from "esbuild";
import { fileURLToPath } from "node:url";

/** pane 内没有宿主的 body 样式,得自带高度与配色基线。 */
export const PANE_BASE_CSS = String.raw`
html,body,#root{height:100%;margin:0}
body{background:hsl(var(--background));color:hsl(var(--foreground))}
*{box-sizing:border-box}
`;

/**
 * 内容安全策略的可定制项。
 *
 * 未提供时各项均取通用层默认值(与迁移前的 `PANE_CSP` 逐字节一致)。
 */
export interface PaneCspOptions {
  /** 覆盖 `script-src`(默认 `'unsafe-inline'`)。URL 形态需放行 `'self'`。 */
  readonly scriptSrc?: readonly string[];
  /** 追加 `connect-src`(默认不声明该指令 —— 受管数据一律走 MessageChannel,不受此限)。 */
  readonly connectSrc?: readonly string[];
  /** 追加 `media-src`(默认不声明该指令)。 */
  readonly mediaSrc?: readonly string[];
}

const DEFAULT_IMG_SRC: readonly string[] = ["blob:", "data:", "http:", "https:"];
const DEFAULT_STYLE_SRC: readonly string[] = ["'unsafe-inline'"];
const DEFAULT_SCRIPT_SRC: readonly string[] = ["'unsafe-inline'"];

/**
 * 组装内容安全策略字符串。
 *
 * `default-src 'none'` 起步,只放开:内联/自身来源脚本(视调用方而定)、图片到
 * blob:/data:/http(s):(要显示附件签名 URL 与本地预览)。`connect-src`/`media-src`
 * 只在显式提供时才追加指令,不提供则维持既有的「未声明」形态(不放宽既有策略)。
 *
 * ★ 已知缺口:内联形态默认不放开 `connect-src`,pane 内直接发起的取数会被拦(受管数据
 * 一律走 MessageChannel,不受此限)。这是 `isolated-panes` 波次的未完成部分,实机可见。
 * 集中在此处的好处正是:将来要补只改一处,不会漏掉某个 source。
 */
export function buildPaneCsp(options: PaneCspOptions = {}): string {
  const scriptSrc = options.scriptSrc ?? DEFAULT_SCRIPT_SRC;
  const directives = [
    "default-src 'none'",
    `img-src ${DEFAULT_IMG_SRC.join(" ")}`,
    `style-src ${DEFAULT_STYLE_SRC.join(" ")}`,
    `script-src ${scriptSrc.join(" ")}`,
  ];
  if (options.connectSrc !== undefined && options.connectSrc.length > 0) {
    directives.push(`connect-src ${options.connectSrc.join(" ")}`);
  }
  if (options.mediaSrc !== undefined && options.mediaSrc.length > 0) {
    directives.push(`media-src ${options.mediaSrc.join(" ")}`);
  }
  return directives.join("; ");
}

/**
 * 单一权威的默认内容安全策略(内联形态)。
 *
 * 等价于 `buildPaneCsp()` —— 保留具名常量是为了向后兼容既有引用方,值恒与
 * `buildPaneCsp()` 的默认输出一致,不重复维护第二份字面量。
 */
export const PANE_CSP = buildPaneCsp();

/** URL 形态的默认策略:文档可寻址,脚本经 `<script src>` 从自身来源加载。 */
const DEFAULT_URL_CSP = buildPaneCsp({ scriptSrc: ["'self'"] });

/** 转义内联脚本中 HTML 不允许的控制字符，保留脚本运行时字节语义。 */
export function escapeInlineScriptForHtml(script: string): string {
  return script
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    )
    .replace(/<\/script/gi, "<\\/script");
}

/** 把 bundle 与样式拼成自足文档(内联形态)。 */
export function renderPaneDocument(
  title: string,
  script: string,
  css: string,
  csp: string = PANE_CSP,
): string {
  const safeScript = escapeInlineScriptForHtml(script);
  return (
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<title>${title}</title><style>${css}</style></head>` +
    `<body><div id="root"></div><script>${safeScript}</script></body></html>`
  );
}

/**
 * 把样式拼成一份**可寻址**的文档,脚本经 `<script src>` 引用外部文件(URL 形态)。
 *
 * 调用方负责把 `bundlePaneEntry` 的产出字节写到 `scriptSrc` 指向的路径 —— 本函数只
 * 渲染文档骨架,不落盘。
 */
export function renderPaneUrlDocument(
  title: string,
  scriptSrc: string,
  css: string,
  csp: string = DEFAULT_URL_CSP,
): string {
  return (
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<title>${title}</title><style>${css}</style></head>` +
    `<body><div id="root"></div><script src="${scriptSrc}"></script></body></html>`
  );
}

export interface PaneBundleOptions {
  /** pane 入口,接受本地路径字符串或 `file:` URL(两者归一到同一绝对路径)。 */
  readonly entry: string | URL;
  /** 注入的 esbuild 插件(如单例解析插件),与画布样式自注入等场景。 */
  readonly plugins?: readonly Plugin[];
  /** 编译期常量注入,与默认的 `NODE_ENV` 合并(调用方可覆盖)。 */
  readonly define?: Readonly<Record<string, string>>;
  /** 追加的外置清单(pane 默认全量内联,仅按需放行个别模块)。 */
  readonly external?: readonly string[];
}

function resolveEntryPath(entry: string | URL): string {
  return entry instanceof URL ? fileURLToPath(entry) : entry;
}

/** 把入口打成自足 IIFE(浏览器目标、生产模式、无注释)。 */
export async function bundlePaneEntry(
  entryOrOptions: string | URL | PaneBundleOptions,
): Promise<string> {
  const options: PaneBundleOptions =
    typeof entryOrOptions === "string" || entryOrOptions instanceof URL
      ? { entry: entryOrOptions }
      : entryOrOptions;
  const entryPath = resolveEntryPath(options.entry);
  const result = await build({
    entryPoints: [entryPath],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    legalComments: "none",
    define: { "process.env.NODE_ENV": '"production"', ...options.define },
    plugins: options.plugins !== undefined ? [...options.plugins] : undefined,
    external: options.external !== undefined ? [...options.external] : undefined,
  });
  const output = result.outputFiles?.[0];
  if (output === undefined) throw new Error(`pane 未生成 bundle: ${entryPath}`);
  return output.text;
}

export interface PaneDocumentOptions {
  readonly entry: string | URL;
  readonly title: string;
  /** 额外内联的样式(默认只有 pane 基线)。 */
  readonly css?: string;
}

/** 构建一份 pane 内联文档,返回完整 HTML 字符串。 */
export async function buildPaneDocument(options: PaneDocumentOptions): Promise<string> {
  const script = await bundlePaneEntry(options.entry);
  const css = `${options.css ?? ""}\n${PANE_BASE_CSS}`.trim();
  return renderPaneDocument(options.title, script, css);
}
