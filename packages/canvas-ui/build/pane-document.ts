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
import { bundlePaneEntry, renderPaneDocument, PANE_BASE_CSS } from "@blksails/pi-web-kit/build/pane-document";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import type { Config } from "tailwindcss";

// ★ 内容安全策略、pane 基线样式与 `</script` 转义都在**通用层**(web-kit/build/pane-document),
// 本模块只叠加画布特有的样式与源码扫描。非画布的 pane 直接用通用层,不必依赖整个画布包。

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
      // ★ 扫**入口所在目录整棵树**,而不只是入口文件本身。
      //
      // 入口一旦变成一个只做转发的薄文件(`main.tsx` 里只有一行 import + 调用),真正带类名的
      // 组件就不再被扫描 ⇒ 工具类不生成 ⇒ pane 里元素还在、布局却崩了。实测症状极具误导性:
      // 按钮能被定位到、却点不动(被别的元素盖住),看起来像交互缺陷而不是样式缺失。
      resolve(dirname(entry), "**", "*.{ts,tsx}"),
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

/**
 * 构建一份 canvas pane 文档,返回完整 HTML 字符串。
 *
 * 调用方负责把它写到自己的生成文件里并在构建结束后删除(产物不入库的既有纪律)。
 */
export async function buildCanvasPaneDocument(
  options: CanvasPaneBuildOptions,
): Promise<string> {
  const css = await buildCss(options);
  const script = await bundlePaneEntry(options.entry);
  // PANE_BASE_CSS 已由 buildCss 追加在末尾,此处不再叠加(叠两次会让 pane 基线样式重复)。
  return renderPaneDocument(options.title, script, css);
}
