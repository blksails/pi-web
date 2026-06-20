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

const DECLARATIVE: WebExtension = {
  manifestId: "webext-declarative",
  config: { theme: { "--pw-webext-declarative-accent": "#7c3aed" }, layout: "split" },
};

// 纯声明式空态配置(prepend):配置建议项排在 agent 命令之前。
// 注:与 DECLARATIVE 一样走「构建期集成」车道,config 在此内联(权威来源);
// examples/webext-empty-*-agent/.pi/web/manifest.json 与此等价,仅作文档/独立预构建车道之用,
// 本注册表不读取它。
const EMPTY_CONFIG: WebExtension = {
  manifestId: "webext-empty-config",
  config: {
    empty: {
      title: "需要我帮忙吗?",
      subtitle: "选择一个起点,或直接提问。",
      starters: [
        { id: "empty-explain", label: "解释这个项目的结构", value: "请解释这个项目的结构", mode: "fill" },
        { id: "empty-test", label: "生成单元测试", value: "为当前模块生成单元测试", mode: "send" },
      ],
      mergeCommands: "prepend",
    },
  },
};

// 纯声明式空态配置(replace):仅展示配置建议项,隐藏 agent 命令。
const EMPTY_REPLACE: WebExtension = {
  manifestId: "webext-empty-replace",
  config: {
    empty: {
      title: "只看这几个入口",
      subtitle: "命令已隐藏,从下面的精选项开始。",
      starters: [
        { id: "replace-only", label: "开始一个新任务", value: "我想开始一个新任务", mode: "fill" },
      ],
      mergeCommands: "replace",
    },
  },
};

const REGISTRY: ReadonlyArray<{ match: string; ext: WebExtension }> = [
  { match: "webext-layout-agent", ext: layoutExt },
  { match: "webext-slots-agent", ext: slotsExt },
  { match: "webext-renderer-agent", ext: rendererExt },
  { match: "webext-contrib-agent", ext: contribExt },
  { match: "webext-artifact-agent", ext: artifactExt },
  { match: "webext-background-agent", ext: backgroundExt },
  { match: "webext-empty-config-agent", ext: EMPTY_CONFIG },
  { match: "webext-empty-replace-agent", ext: EMPTY_REPLACE },
  { match: "webext-declarative-agent", ext: DECLARATIVE },
];

/** 按 source 路径匹配返回扩展(无匹配 undefined → 宿主默认 UI)。 */
export function resolveExtensionForSource(
  source: string | undefined,
): WebExtension | undefined {
  if (source === undefined) return undefined;
  return REGISTRY.find((e) => source.includes(e.match))?.ext;
}
