/**
 * canvas pane 文档的构建流水线(spec panes-only-right-panel 任务 1.5;Req 4.1/4.5)。
 *
 * pane 文档不是一个 URL,而是一整份**内联 HTML 字符串**:入口打成自足 IIFE(React 与画布
 * 组件全打进去)+ 内联 CSS + 内容安全策略,最后由宿主以 srcDoc 挂载。
 *
 * ## 为什么抽出来
 *
 * 迁移后有**两个** source 需要各自的 canvas pane(一个自带插件集),流水线完全相同,差别只有
 * 入口与插件。各抄一份的话仓里就是两份内容安全策略、两份样式内容配置、两份基础 CSS ——
 * 这类东西漂起来无声无息(实测前科:canvas pane 的策略未放开 connect-src,真机报错而单测全绿;
 * 若那时有两份,修一份就会漏另一份)。
 *
 * ## 插件为什么是构建期的事
 *
 * pane 文档里**已经跑着完整的 React**,它不是等宿主投喂组件的瘦壳。所以插件就是和画布组件
 * 一起打包的普通模块,在 iframe 内用既有注册函数接入 —— 不跨 realm 传组件,也不需要新协议。
 * (「运行时车道无法承载组件」那条既有约束针对的是运行时解析车道,与构建期打包无关。)
 *
 * 本模块是**构建期**代码,依赖 node 与 esbuild;不要从浏览器侧入口引用它。
 */
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import type { Config } from "tailwindcss";

/** pane 内没有宿主的 body 样式,得自带高度与配色基线。 */
const PANE_BASE_CSS = String.raw`
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
 * ★ 已知缺口(不在本任务范围):未放开 `connect-src`,故 pane 内发起的取数会被拦。
 * 这是 `isolated-panes` 波次的未完成部分,实机可见。集中在此处的好处正是:将来要补,
 * 只改这一处,不会漏掉另一个 source。
 */
const PANE_CSP =
  "default-src 'none'; img-src blob: data: http: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'";

export interface CanvasPaneBuildOptions {
  /** 仓库根(用于解析各包的样式与源码)。 */
  readonly repoRoot: string;
  /** pane 入口(.tsx),内含 React 挂载与插件注册。 */
  readonly entry: string;
  /** 文档标题(浏览器不显示,但便于调试识别)。 */
  readonly title: string;
  /**
   * 额外参与样式扫描的源码 glob。
   *
   * 自带插件的 source 必须把插件源码列进来 —— 否则插件用到的样式类不会被生成,
   * 表现为「插件渲染了但没样式」,极易被当成插件本身没生效。
   */
  readonly extraContent?: readonly string[];
}

/** 生成该 pane 的完整样式(宿主基线 + 画布 + 按内容生成的工具类 + pane 基线)。 */
async function buildCss(options: CanvasPaneBuildOptions): Promise<string> {
  const { repoRoot, entry, extraContent = [] } = options;
  const preset = (await import(
    resolve(repoRoot, "packages", "ui", "tailwind-preset.js")
  )) as { readonly piWebPreset: Config };
  const config: Config = {
    presets: [preset.piWebPreset],
    content: [
      entry,
      resolve(repoRoot, "packages", "canvas-ui", "src", "**", "*.{ts,tsx}"),
      resolve(repoRoot, "packages", "canvas-kit", "src", "**", "*.{ts,tsx}"),
      resolve(repoRoot, "packages", "primitives", "src", "**", "*.{ts,tsx}"),
      ...extraContent,
    ],
  };
  const generated = await postcss([tailwindcss(config)]).process(
    "@tailwind base; @tailwind components; @tailwind utilities;",
    { from: undefined },
  );
  const [uiStyles, canvasStyles] = await Promise.all([
    readFile(resolve(repoRoot, "packages", "ui", "src", "styles.css"), "utf8"),
    readFile(resolve(repoRoot, "packages", "canvas-ui", "src", "styles.css"), "utf8"),
  ]);
  return `${uiStyles}\n${canvasStyles}\n${generated.css}\n${PANE_BASE_CSS}`;
}

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

/**
 * 构建一份 canvas pane 文档,返回完整 HTML 字符串。
 *
 * 调用方负责把它写到自己的生成文件里并在构建结束后删除(产物不入库的既有纪律)。
 */
export async function buildCanvasPaneDocument(
  options: CanvasPaneBuildOptions,
): Promise<string> {
  const css = await buildCss(options);
  const result = await build({
    entryPoints: [options.entry],
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
  if (output === undefined) throw new Error(`pane 未生成 bundle: ${options.entry}`);
  return renderPaneDocument(options.title, output.text, css);
}

export { PANE_CSP, PANE_BASE_CSS };
