/**
 * webext-registry — app 侧「构建期集成」的扩展注册表(agent-web-extension)。
 *
 * 对仓库内已知示例 agent source,直接静态 import 其 `.pi/web/web.config`(由 Next 编译,
 * react/web-kit 为 app 单例),按 source 路径匹配返回 WebExtension 传给 <PiChat>。
 * 这是设计中「构建期集成」车道(对白名单/本地源),与「独立预构建 + import map」(对 git 源)
 * 并存;浏览器 e2e 走本车道以验证渲染闭环。
 */
import type { WebExtension } from "@blksails/pi-web-kit";
import layoutExt from "../../examples/webext-layout-agent/.pi/web/web.config";
import slotsExt from "../../examples/webext-slots-agent/.pi/web/web.config";
import rendererExt from "../../examples/webext-renderer-agent/.pi/web/web.config";
import contribExt from "../../examples/webext-contrib-agent/.pi/web/web.config";
import artifactExt from "../../examples/webext-artifact-agent/.pi/web/web.config";
import backgroundExt from "../../examples/webext-background-agent/.pi/web/web.config";
import aigcExt from "../../examples/aigc-agent/.pi/web/web.config";
import aigcCanvasExt from "../../examples/aigc-canvas-agent/.pi/web/web.config";
import aigcCanvasNoSurfaceExt from "../../examples/aigc-canvas-nosurface-agent/.pi/web/web.config";
import canvasPluginStickersExt from "../../examples/canvas-plugin-stickers/.pi/web/web.config";
import loggingDemoExt from "../../examples/logging-demo-agent/.pi/web/web.config";
import stateBridgeExt from "../../examples/state-bridge-agent/.pi/web/web.config";
import surfaceDemoExt from "../../examples/surface-demo-agent/.pi/web/web.config";
import codeReviewExt from "../../examples/plugin-code-review-agent/.pi/web/web.config";

// 纯声明式扩展(零代码):仅靠 config 让宿主把可见效果应用上身。与
// examples/webext-declarative-agent/.pi/web/manifest.json 保持一致(此处是构建期集成
// 车道的内联镜像)。演示四类零代码可见效果:
//  - theme:覆盖宿主真实 token(`--primary`/`--accent`/`--ring`/`--border`)→ 全局重着色(紫);
//  - layout="wide":对话列加宽(max-w-5xl)→ 与默认 centered 可见区别;
//  - empty:自定义空态标题/副标题/建议项;
//  - documentTitle:浏览器标签页标题。
const DECLARATIVE: WebExtension = {
  manifestId: "webext-declarative",
  config: {
    documentTitle: "Declarative · pi-web",
    theme: {
      "--primary": "262 83% 58%",
      "--primary-foreground": "0 0% 100%",
      "--accent": "262 90% 96%",
      "--accent-foreground": "262 83% 38%",
      "--ring": "262 83% 58%",
      "--border": "262 44% 86%",
      "--pw-webext-declarative-accent": "#7c3aed",
    },
    layout: "wide",
    empty: {
      title: "纯声明式扩展 · 零代码",
      subtitle:
        "紫色主题、宽版布局、这些建议项与标签页标题——全部来自声明式 config,不携带任何 bundle。",
      starters: [
        {
          id: "decl-theme",
          label: "🎨 主题色从哪来?",
          value: "我看到的紫色主题色是怎么配置的?",
          mode: "fill",
        },
        {
          id: "decl-layout",
          label: "📐 这是什么布局?",
          value: "当前用的是哪个 layout 预设,为什么更宽?",
          mode: "fill",
        },
        {
          id: "decl-zero",
          label: "⚡ 零代码怎么生效的?",
          value: "纯声明式 UI 扩展是如何不打包就生效的?",
          mode: "send",
        },
      ],
      mergeCommands: "prepend",
    },
  },
};

// match 键一律带 `examples/` 段(路径段尾匹配,见 resolveExtensionForSource):只写目录名的话,
// 任何以该名结尾的路径都会撞上——例如同名仓库根 `C:\workcode\aigc-agent` 本身。
const REGISTRY: ReadonlyArray<{ match: string; ext: WebExtension }> = [
  { match: "examples/webext-layout-agent", ext: layoutExt },
  // webext-slots-agent 同时演示 Tier1 全槽 + Tier5 声明式空态配置(config.empty)。
  { match: "examples/webext-slots-agent", ext: slotsExt },
  { match: "examples/webext-renderer-agent", ext: rendererExt },
  { match: "examples/webext-contrib-agent", ext: contribExt },
  { match: "examples/webext-artifact-agent", ext: artifactExt },
  { match: "examples/webext-background-agent", ext: backgroundExt },
  // aigc-agent:AIGC 图像工作台完整 ③(promptToolbar + panelRight 画布 + 图像/媒体渲染器 + 空态)。
  { match: "examples/aigc-agent", ext: aigcExt },
  // 迁移期对照:源仓库 aigc-agent 的 `agents/aigc` 与本仓库 examples/aigc-agent 是同一 agent
  // (examples 内容由 scripts/sync-from-aigc-agent.mjs 自源同步),在本宿主点选源仓库路径时
  // 给同一套 UI;源仓库退役后随 docs/aigc-agent-migration.md §6 一并清理。
  { match: "agents/aigc", ext: aigcExt },
  // aigc-canvas-agent:Canvas(domain=canvas 的 AAS 实例)——launcherRail 入口 + panelRight 画廊/工作台。
  { match: "examples/aigc-canvas-agent", ext: aigcCanvasExt },
  // aigc-canvas-nosurface-agent:贡献 Canvas 面板但 agent 无 canvas surface —— 降级
  // (unavailable / 只读图库)端到端验证 fixture。
  { match: "examples/aigc-canvas-nosurface-agent", ext: aigcCanvasNoSurfaceExt },
  // canvas-plugin-stickers(canvas-plugins-m3):Canvas 插件双端范例 source —— 复用 CanvasLauncher/
  // CanvasPanel + 车道① canvasPlugins:[stickersBundle](贴纸图层/工具 + 风格迁移动作)。canvasPlugins
  // 含 React 组件(Render/Inspector),故必须走构建期静态 import 车道(运行时 /api/webext/resolve
  // 无法承载组件)。
  { match: "examples/canvas-plugin-stickers", ext: canvasPluginStickersExt },
  { match: "examples/webext-declarative-agent", ext: DECLARATIVE },
  // logging-demo-agent:浏览器侧 webext 日志总线验收(webext:logging-demo 命名空间)。
  { match: "examples/logging-demo-agent", ext: loggingDemoExt },
  // state-bridge-agent:状态注入桥「人侧」panelRight 面板(双向闭环浏览器验收)。
  { match: "examples/state-bridge-agent", ext: stateBridgeExt },
  // surface-demo-agent:agent 权威 surface 领域无关示例(命令闭环 + 能力退化浏览器验收)。
  { match: "examples/surface-demo-agent", ext: surfaceDemoExt },
  // plugin-code-review-agent(plugin-system-unification):统一插件包的 webext 层——
  // Tier2 渲染器把 pi 扩展 `code_review` 工具产出渲染为富卡(CodeReviewCard)。
  { match: "examples/plugin-code-review-agent", ext: codeReviewExt },
];

/**
 * 按 source 路径匹配返回扩展(无匹配 undefined → 宿主默认 UI,或交由运行时
 * `/api/webext/resolve` 车道兜底,见 webext-load-client)。
 *
 * 匹配语义 = **路径段尾**,不是子串(上提自源仓库 aigc-agent iteration-8 目标 2 的真 bug 修复):
 *  - 子串匹配下,绝对路径 `C:\workcode\aigc-agent\agents\aigc` 会先命中裸目录名规则
 *    `aigc-agent`(仓库目录名恰好同名)——错拿只有渲染器的范例扩展,空态 / promptToolbar /
 *    panelRight 全部静默回落宿主默认,且 e2e 因走正斜杠相对路径而全绿(「手动点选必坏、e2e 必绿」)。
 *  - Windows 源列表返回原生反斜杠路径,而 match 键是 POSIX 形式,故须先归一分隔符。
 *  - match 键带 `examples/` 段:只写目录名的话,任何以该名结尾的路径(含同名仓库根)都会撞上,
 *    只改匹配算法治不了同名。
 */
function normalizeSource(source: string): string {
  return source
    .replace(/\\/g, "/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

export function resolveExtensionForSource(
  source: string | undefined,
): WebExtension | undefined {
  if (source === undefined) return undefined;
  const norm = normalizeSource(source);
  return REGISTRY.find((e) => norm === e.match || norm.endsWith(`/${e.match}`))
    ?.ext;
}

/** 测试用:注册表 match 键(只读)。钉「全部带路径段」约束,防回归裸目录名子串时代。 */
export const REGISTRY_MATCHES: readonly string[] = REGISTRY.map((e) => e.match);
