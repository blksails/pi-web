/**
 * canvas pane 文档的构建流水线(spec panes-only-right-panel 任务 1.5;Req 4.1/4.5;
 * spec cli-agent-build 任务 2.3 重构:Req 4.5)。
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
 * ## Req 4.5 重构(spec cli-agent-build 任务 2.3)
 *
 * 旧实现接收一个 `repoRoot`,内部拼出 `resolve(repoRoot, "packages", "ui", "tailwind-preset.js")`
 * 去 `import()` 样式预设 —— 两处问题:
 *
 *  1. 假定「调用方传入的就是 pi-web 仓库根」,agent source 在仓库外构建时这个假设不成立;
 *     且该拼接连扩展名都是错的(`.js`,而磁盘上是 `.ts`,只是从未被真实构建路径踩到)。
 *     样式预设的真实解析属于「候选路径注入 + 取第一个存在者」这套已建立的机制
 *     (`bin/pi-web.mjs` 的 `buildCandidatePathDeps()`/`resolveFirstExistingCandidate()`,
 *     spec cli-agent-build 任务 1.4/1.5),故本层只消费调用方已解析好的 `presetPath`,
 *     不再自己猜仓库物理路径。
 *  2. `ui`/`canvas-ui`/`canvas-kit`/`primitives` 这四个包是 pi-web **自带**的画布 UI 工具集
 *     (Req 4.2:「由 pi-web 侧提供构建所需的全部工具链与样式预设」),不是 agent source 的
 *     依赖 —— 它们与本模块自身**永远同处一棵 `packages/` 树**(dev 仓库如此,
 *     `scripts/pack-dist.mjs` 的 `packWorkspacePackages()` 把每个包的 `src/`(与本包的
 *     `build/`)按原始相对结构整体拷进 `dist/packages/<pkg>/` 也如此)。故它们改用
 *     `import.meta.url` 做包内自解析,不再依赖调用方注入 `repoRoot`——agent source 因此
 *     无需知道、也无需引用 pi-web 仓库内部的物理布局(Req 4.5)。
 *
 * 样式扫描基准也从 `dirname(entry)` 改为调用方显式声明的 `packageRoot`:entry 若只是一个
 * 转发文件、或(更危险地)落在依赖目录深处,`dirname(entry)` 会把扫描范围带偏,轻则漏扫真正
 * 带类名的组件,重则把无关的依赖树一并扫入。`packageRoot` 由调用方按「声明 pane 的模块所在
 * 包根」显式给出,消除这一整类漂移。
 *
 * 样式编译也从「每个 pane 各跑一次」拆成「一次解析、多 pane 复用」:`resolveCanvasCss()`
 * 独立导出,调用方对同一 agent source 的多个 pane 只需调一次,把结果分发给每个
 * `buildCanvasPaneDocument()` 调用 —— 该函数本身不再重新计算样式,只做 bundle + 拼装。
 *
 * 本模块是**构建期**代码,依赖 node 与 esbuild;不要从浏览器侧入口引用它。
 */
import { bundlePaneEntry, renderPaneDocument, PANE_BASE_CSS } from "@blksails/pi-web-kit/build/pane-document";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import type { Config } from "tailwindcss";

// ★ 内容安全策略、pane 基线样式与 `</script` 转义都在**通用层**(web-kit/build/pane-document),
// 本模块只叠加画布特有的样式与源码扫描。非画布的 pane 直接用通用层,不必依赖整个画布包。

/**
 * 本文件自身所在目录 → 本包(`canvas-ui`)根 → `packages/` 根。
 *
 * `ui`/`canvas-ui`/`canvas-kit`/`primitives` 四个 pi-web 自带包永远与本文件同处一棵
 * `packages/` 树(见上方模块注释),故用 `import.meta.url` 自解析取代调用方注入的
 * `repoRoot`。
 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const CANVAS_UI_ROOT = resolve(MODULE_DIR, "..");
/**
 * ★ 仅作**开发形态**的缺省值，不可单独依赖。
 *
 * 本文件在分发形态下会被 esbuild **内联进 `dist/cli-commands.mjs`**，届时
 * `import.meta.url` 指向的是那个打包产物而非本文件，于是「与 packages/ 同处一棵树」
 * 的前提不成立，自解析会错位两级（实测算成 `<agents>/canvas-ui/src/styles.css`）。
 * 调用方应经 `CanvasCssOptions.packagesRoot` 显式注入 —— 与 `presetPath` 同一套
 * 候选路径机制（`bin/pi-web.mjs` 的 `buildCandidatePathDeps()`）。
 */
const PACKAGES_ROOT_FALLBACK = resolve(CANVAS_UI_ROOT, "..");

export interface CanvasCssOptions {
  /**
   * 画布样式预设(`tailwind-preset`)的已解析绝对路径。
   *
   * 由调用方从候选路径中选出第一个真实存在者后注入(`bin/pi-web.mjs` 的
   * `buildCandidatePathDeps()` → `resolveFirstExistingCandidate()` 同一套机制,
   * spec cli-agent-build 任务 1.4/1.5);本函数不做任何仓库物理路径拼接或猜测。
   */
  readonly presetPath: string;
  /**
   * `packages/` 根的绝对路径（内含 `ui` / `canvas-ui` 等同级包）。
   * 缺省时回落到基于 `import.meta.url` 的自解析 —— 该回落**只在开发形态成立**，
   * 分发形态必须显式注入，理由见 `PACKAGES_ROOT_FALLBACK` 注释。
   */
  readonly packagesRoot?: string;
  /**
   * 参与内容扫描的包根 —— 声明 pane 入口的**模块所在包**的根目录,而非入口文件自身
   * 所在目录。
   *
   * ★ 用 `dirname(entry)` 当扫描基准有两个坑:入口若是只做转发的薄文件,真正带类名的
   * 组件在别的目录,会被漏扫(工具类不生成 ⇒ 布局看似崩了,实际是样式缺失);入口若落在
   * 依赖目录深处,`dirname(entry)/**` 还会把扫描范围一并带进依赖树。显式声明包根,
   * 两个坑都不成立。
   */
  readonly packageRoot: string;
  /**
   * 额外参与样式扫描的源码 glob。
   *
   * 自带插件的 source 必须把插件源码列进来 —— 否则插件用到的样式类不会被生成,
   * 表现为「插件渲染了但没样式」,极易被当成插件本身没生效。
   */
  readonly extraContent?: readonly string[];
}

/**
 * 计算 Tailwind 内容扫描的 glob 列表(纯函数,不触碰文件系统)。
 *
 * 抽出以便单测直接判别式地证明:扫描基准锚定在 `packageRoot`,与入口文件自身的位置
 * 无关 —— 入口即便落在依赖目录深处,产出的 glob 列表也只字不差地基于 `packageRoot`。
 */
export function canvasContentGlobs(
  packageRoot: string,
  extraContent: readonly string[] = [],
  packagesRoot: string = PACKAGES_ROOT_FALLBACK,
): readonly string[] {
  return [
    // ★ 只扫 `src/`,不扫包根 —— 包根下有 node_modules,`**/*.ts` 会把整棵依赖树拖进
    // tailwind 内容扫描（实测 tailwind 自己就会警告「accidentally matching all of
    // node_modules」并严重拖慢构建）。
    resolve(packageRoot, "src", "**", "*.{ts,tsx}"),
    resolve(packageRoot, "panes", "**", "*.{ts,tsx}"),
    resolve(packagesRoot, "canvas-ui", "src", "**", "*.{ts,tsx}"),
    resolve(packagesRoot, "canvas-kit", "src", "**", "*.{ts,tsx}"),
    resolve(packagesRoot, "primitives", "src", "**", "*.{ts,tsx}"),
    ...extraContent,
  ];
}

/**
 * 生成一份画布 pane 的完整样式(宿主基线 + 画布 + 按内容生成的工具类 + pane 基线)。
 *
 * 对同一次构建里的多个画布 pane,调用方只需调用一次、把结果分发给各
 * `buildCanvasPaneDocument()` 调用 —— 取代此前「每个 pane 各自重跑一遍完整样式管线」的
 * 旧实现,各 pane 因此拿到逐字节相同的样式内容。
 */
export async function resolveCanvasCss(options: CanvasCssOptions): Promise<string> {
  const { presetPath, packageRoot, extraContent = [] } = options;
  const packagesRoot = options.packagesRoot ?? PACKAGES_ROOT_FALLBACK;
  const preset = (await import(presetPath)) as { readonly piWebPreset: Config };
  const config: Config = {
    presets: [preset.piWebPreset],
    content: [...canvasContentGlobs(packageRoot, extraContent, packagesRoot)],
  };
  const generated = await postcss([tailwindcss(config)]).process(
    "@tailwind base; @tailwind components; @tailwind utilities;",
    { from: undefined },
  );
  const [uiStyles, canvasStyles] = await Promise.all([
    readFile(resolve(packagesRoot, "ui", "src", "styles.css"), "utf8"),
    readFile(resolve(packagesRoot, "canvas-ui", "src", "styles.css"), "utf8"),
  ]);
  return `${uiStyles}\n${canvasStyles}\n${generated.css}\n${PANE_BASE_CSS}`;
}

export interface CanvasPaneBuildOptions {
  /** pane 入口(.tsx),内含 React 挂载与插件注册。 */
  readonly entry: string;
  /** 文档标题(浏览器不显示,但便于调试识别)。 */
  readonly title: string;
  /**
   * 该 pane 的完整样式,由调用方经 `resolveCanvasCss()` 预先算好后传入。
   *
   * 本函数不再自己计算样式 —— 这正是「一次解析、多 pane 复用」的接缝:同一次构建里的
   * 多个 pane 共享同一次 `resolveCanvasCss()` 调用的结果。
   */
  readonly css: string;
}

/**
 * 构建一份 canvas pane 文档,返回完整 HTML 字符串。
 *
 * 调用方负责把它写到自己的生成文件里并在构建结束后删除(产物不入库的既有纪律)。
 */
export async function buildCanvasPaneDocument(
  options: CanvasPaneBuildOptions,
): Promise<string> {
  const script = await bundlePaneEntry(options.entry);
  // css 已由调用方经 resolveCanvasCss() 算好并注入,此处不再重跑样式管线
  // (PANE_BASE_CSS 已包含在 resolveCanvasCss() 的返回值末尾,不重复叠加)。
  return renderPaneDocument(options.title, script, options.css);
}
