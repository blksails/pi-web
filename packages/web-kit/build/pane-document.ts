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
 * 本模块是**构建期**代码,依赖 node 与 esbuild;不要从浏览器侧入口引用。
 */
import { build } from "esbuild";

/** pane 内没有宿主的 body 样式,得自带高度与配色基线。 */
export const PANE_BASE_CSS = String.raw`
html,body,#root{height:100%;margin:0}
body{background:hsl(var(--background));color:hsl(var(--foreground))}
*{box-sizing:border-box}
`;

/**
 * 单一权威的内容安全策略。
 *
 * `default-src 'none'` 起步,只放开:内联 style/script(文档自足,无外链)、
 * 图片到 blob:/data:/http(s):(要显示附件签名 URL 与本地预览)。
 *
 * ★ 已知缺口:未放开 `connect-src`,故 pane 内直接发起的取数会被拦(受管数据一律走
 * MessageChannel,不受此限)。这是 `isolated-panes` 波次的未完成部分,实机可见。
 * 集中在此处的好处正是:将来要补只改一处,不会漏掉某个 source。
 */
export const PANE_CSP =
  "default-src 'none'; img-src blob: data: http: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'";

/** 把 bundle 与样式拼成自足文档。 */
export function renderPaneDocument(title: string, script: string, css: string): string {
  // ★ `</script` 出现在 bundle 字面量里会提前闭合标签,整份文档就此损坏 —— 必须转义。
  const safeScript = script.replace(/<\/script/gi, "<\\/script");
  return (
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width">` +
    `<meta http-equiv="Content-Security-Policy" content="${PANE_CSP}">` +
    `<title>${title}</title><style>${css}</style></head>` +
    `<body><div id="root"></div><script>${safeScript}</script></body></html>`
  );
}

/** 把入口打成自足 IIFE(浏览器目标、生产模式、无注释)。 */
export async function bundlePaneEntry(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    legalComments: "none",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const output = result.outputFiles?.[0];
  if (output === undefined) throw new Error(`pane 未生成 bundle: ${entry}`);
  return output.text;
}

export interface PaneDocumentOptions {
  readonly entry: string;
  readonly title: string;
  /** 额外内联的样式(默认只有 pane 基线)。 */
  readonly css?: string;
}

/** 构建一份 pane 文档,返回完整 HTML 字符串。 */
export async function buildPaneDocument(options: PaneDocumentOptions): Promise<string> {
  const script = await bundlePaneEntry(options.entry);
  const css = `${options.css ?? ""}\n${PANE_BASE_CSS}`.trim();
  return renderPaneDocument(options.title, script, css);
}
