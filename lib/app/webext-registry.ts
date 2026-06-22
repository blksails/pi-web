/**
 * webext-registry — app 侧「构建期集成」的扩展注册表(agent-web-extension)。
 *
 * 对仓库内已知示例 agent source,直接静态 import 其 `.pi/web/web.config`(由 Next 编译,
 * react/web-kit 为 app 单例),按 source 路径匹配返回 WebExtension 传给 <PiChat>。
 * 这是设计中「构建期集成」车道(对白名单/本地源),与「独立预构建 + import map」(对 git 源)
 * 并存;浏览器 e2e 走本车道以验证渲染闭环。
 */
import type { WebExtension } from "@pi-web/web-kit";
import layoutExt from "../../examples/webext-layout-agent/.pi/web/web.config";
import slotsExt from "../../examples/webext-slots-agent/.pi/web/web.config";
import rendererExt from "../../examples/webext-renderer-agent/.pi/web/web.config";
import contribExt from "../../examples/webext-contrib-agent/.pi/web/web.config";
import artifactExt from "../../examples/webext-artifact-agent/.pi/web/web.config";
import backgroundExt from "../../examples/webext-background-agent/.pi/web/web.config";

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
  { match: "webext-declarative-agent", ext: DECLARATIVE },
];

/** 按 source 路径匹配返回扩展(无匹配 undefined → 宿主默认 UI)。 */
export function resolveExtensionForSource(
  source: string | undefined,
): WebExtension | undefined {
  if (source === undefined) return undefined;
  return REGISTRY.find((e) => source.includes(e.match))?.ext;
}
