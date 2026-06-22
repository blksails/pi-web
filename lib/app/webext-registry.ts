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
import aigcExt from "../../examples/aigc-agent/.pi/web/web.config";

const DECLARATIVE: WebExtension = {
  manifestId: "webext-declarative",
  config: { theme: { "--pw-webext-declarative-accent": "#7c3aed" }, layout: "split" },
};

const REGISTRY: ReadonlyArray<{ match: string; ext: WebExtension }> = [
  { match: "webext-layout-agent", ext: layoutExt },
  // webext-slots-agent 同时演示 Tier1 全槽 + Tier5 声明式空态配置(config.empty)。
  { match: "webext-slots-agent", ext: slotsExt },
  { match: "webext-renderer-agent", ext: rendererExt },
  { match: "webext-contrib-agent", ext: contribExt },
  { match: "webext-artifact-agent", ext: artifactExt },
  { match: "webext-background-agent", ext: backgroundExt },
  // aigc-agent:Tier2 工具渲染器,把 text_to_image / image_edit 产物渲染为 <img>。
  { match: "aigc-agent", ext: aigcExt },
  { match: "webext-declarative-agent", ext: DECLARATIVE },
];

/** 按 source 路径匹配返回扩展(无匹配 undefined → 宿主默认 UI)。 */
export function resolveExtensionForSource(
  source: string | undefined,
): WebExtension | undefined {
  if (source === undefined) return undefined;
  return REGISTRY.find((e) => source.includes(e.match))?.ext;
}
