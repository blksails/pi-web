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
// ★ 静态车道必须 import **同源产物**而非 `web-extension.mjs`（后者自 cli-agent-build 起
// 是运行时**分派器**：按宿主形态动态 import 同源/隔离两份产物）。本注册表是构建期静态
// 集成车道，只服务同源宿主；若经分派器，打包器会把隔离产物（单个示例即 500KB+，六个
// 示例合计 2MB+）一并拖进 jsdom 测试环境，实测直接 V8 OOM、worker 被杀，且该文件会从
// vitest 汇总里**静默消失**（既不计 passed 也不计 failed）。
//
// ★ 未列 `examples/aigc-agent`：该目录不在本仓（`pnpm-workspace.yaml` 里是悬空条目），
//   静态 import 它会让任何干净检出构建失败（CI 实证 `Cannot find module`）。待该 agent
//   真正入库或改由运行时解析车道装载后再接。
import aigcCanvasExt from "../../examples/aigc-canvas-agent/.pi/web/dist/web-extension.same-origin.mjs";
import panesExt from "../../examples/panes-agent/.pi/web/dist/web-extension.same-origin.mjs";
import aigcCanvasNoSurfaceExt from "../../examples/aigc-canvas-nosurface-agent/.pi/web/dist/web-extension.same-origin.mjs";
import canvasPluginStickersExt from "../../examples/canvas-plugin-stickers/.pi/web/dist/web-extension.same-origin.mjs";
import loggingDemoExt from "../../examples/logging-demo-agent/.pi/web/web.config";
import stateBridgeExt from "../../examples/state-bridge-agent/.pi/web/dist/web-extension.same-origin.mjs";
import surfaceDemoExt from "../../examples/surface-demo-agent/.pi/web/dist/web-extension.same-origin.mjs";
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

const REGISTRY: ReadonlyArray<{ match: string; ext: WebExtension }> = [
  { match: "webext-layout-agent", ext: layoutExt },
  // webext-slots-agent 同时演示 Tier1 全槽 + Tier5 声明式空态配置(config.empty)。
  { match: "webext-slots-agent", ext: slotsExt },
  { match: "webext-renderer-agent", ext: rendererExt },
  { match: "webext-contrib-agent", ext: contribExt },
  { match: "webext-artifact-agent", ext: artifactExt },
  { match: "webext-background-agent", ext: backgroundExt },
  // aigc-agent:搜图 / 素材 / 画布三 pane；宿主据 `extension.panes` 统一创建 PanesHost。
  // aigc-canvas-agent:Canvas(domain=canvas 的 AAS 实例)——已迁隔离 Pane 形态
  // (isolated-panes Wave 5):panelRight 挂 PanesHost,画廊跑在独立 iframe;promptToolbar 保留。
  // 与 panes-agent 同,本项刻意导入**编译产物**(pane srcDoc 由 build.ts 内联生成),
  // `.pi/web` 不存作者源码——源在 `web/`。
  // 注:曾有一条 "aigc-agent" 表项在此之前(main 的 e3b10665 已把该 example 移出本仓),
  // 故原先关于 includes 首命中顺序的提醒不再适用。
  { match: "aigc-canvas-agent", ext: aigcCanvasExt },
  // aigc-canvas-nosurface-agent:贡献 Canvas 面板但 agent 无 canvas surface —— 降级
  // (unavailable / 只读图库)端到端验证 fixture。source 路径含子串 "aigc-canvas-nosurface-agent",
  // 不含 "aigc-canvas-agent"(-nosurface- 打断),故独立命中。
  { match: "aigc-canvas-nosurface-agent", ext: aigcCanvasNoSurfaceExt },
  // canvas-plugin-stickers(canvas-plugins-m3):Canvas 插件双端范例 source —— 复用 CanvasLauncher/
  // CanvasPanel + 车道① canvasPlugins:[stickersBundle](贴纸图层/工具 + 风格迁移动作)。canvasPlugins
  // 含 React 组件(Render/Inspector),故必须走构建期静态 import 车道(运行时 /api/webext/resolve
  // 无法承载组件)。source 路径含子串 "canvas-plugin-stickers",不与既有 match 互串(独立命中)。
  { match: "canvas-plugin-stickers", ext: canvasPluginStickersExt },
  { match: "webext-declarative-agent", ext: DECLARATIVE },
  // logging-demo-agent:浏览器侧 webext 日志总线验收(webext:logging-demo 命名空间)。
  { match: "logging-demo-agent", ext: loggingDemoExt },
  // state-bridge-agent:状态注入桥「人侧」面板 —— 已迁 pane 形态(任务 3.1),是本 spec
  // 新增共享状态通道的活体验证(人点 +1 → agent 工具下次读到新值)。导入编译产物。
  { match: "state-bridge-agent", ext: stateBridgeExt },
  // surface-demo-agent:agent 权威 surface 领域无关示例(命令闭环 + 能力退化浏览器验收)。
  // 已迁 pane 形态(spec panes-only-right-panel 任务 2.2),故导入**编译产物**
  // (pane srcDoc 由其 build.ts 内联生成),`.pi/web` 不存作者源码 —— 源在 `web/`。
  { match: "surface-demo-agent", ext: surfaceDemoExt },
  // plugin-code-review-agent(plugin-system-unification):统一插件包的 webext 层——
  // Tier2 渲染器把 pi 扩展 `code_review` 工具产出渲染为富卡(CodeReviewCard)。
  { match: "plugin-code-review-agent", ext: codeReviewExt },
  // panes-agent:五个独立 iframe panes,已迁到**可枚举的 pane 声明键**(spec host-builtin-panes
  // 任务 5.1),不再自渲染 panelRight 槽 —— 宿主据此把它与内置 pane 合并。
  //
  // 本项刻意导入**编译产物**(pane srcDoc 由 build.ts 内联生成),`.pi/web` 不存作者源码。
  // b181e677 曾以「stale static import」移除本项;现产物随 `build:webext-examples` 常规产出,
  // 且迁移后本 webext 不含 React 组件,故可稳定走构建期静态车道。
  //
  // ⚠ 为何不走运行时 `/api/webext/resolve` 车道:该车道要求代码 webext **已签名**,未签名会被
  // 拒(实测 `rejectedReason: "代码 webext 未签名"`)。示例产物不签名,故只能走静态车道。
  { match: "panes-agent", ext: panesExt },
];

/** 按 source 路径匹配返回扩展(无匹配 undefined → 宿主默认 UI)。 */
export function resolveExtensionForSource(
  source: string | undefined,
): WebExtension | undefined {
  if (source === undefined) return undefined;
  return REGISTRY.find((e) => source.includes(e.match))?.ext;
}
