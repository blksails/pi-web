/**
 * web-ext 契约 — 描述符的「可序列化」部分(SlotKey 枚举 + 声明式 config + artifact 声明)。
 *
 * 注意分层:携带 React 组件的运行时 `WebExtension`(slots/renderers/contributions 的实现)
 * 定义在 `@blksails/pi-web-kit`(可依赖 React);本文件只放与传输/校验相关、不含组件的形状。
 */
import { z } from "zod";
import { WebExtensionCapabilitySchema } from "./manifest.js";
import { WebExtConfigSchema } from "./config.js";

// 兼容 re-export(config schema 抽到 config.ts;此处保持旧导入路径可用)。
export {
  ThemeTokensSchema,
  type ThemeTokens,
  LayoutPresetSchema,
  type LayoutPreset,
  PanelRatioSchema,
  type PanelRatio,
  EmptySuggestionSchema,
  type EmptySuggestion,
  EmptyConfigSchema,
  type EmptyConfig,
  WebExtConfigSchema,
  type WebExtConfig,
} from "./config.js";

/** Tier 1 具名区域插槽 key(宿主让出的放置点)。 */
export const SlotKeySchema = z.enum([
  "background",
  "headerLeft",
  "headerCenter",
  "headerRight",
  "sidebarLeft",
  "panelRight",
  "empty",
  "footer",
  "promptInput",
  "accessoryAboveEditor",
  "accessoryBelowEditor",
  "accessoryInlineLeft",
  "accessoryInlineRight",
  "toolbar",
  "notifications",
  "statusBar",
  "artifactSurface",
  "dialogLayer",
]);
export type SlotKey = z.infer<typeof SlotKeySchema>;

/** artifact 声明(运行时渲染在 iframe;此处仅声明入口与初始尺寸)。 */
export const ArtifactDeclarationSchema = z.object({
  /** artifact iframe 的入口(相对扩展产物;独立 origin sandbox 加载)。 */
  entry: z.string().min(1),
  initialHeight: z.number().positive().optional(),
});
export type ArtifactDeclaration = z.infer<typeof ArtifactDeclarationSchema>;

/**
 * 描述符的可序列化骨架(供宿主在加载/校验阶段读取声明面)。
 * 运行时 `WebExtension`(web-kit)在此基础上附加 slots/renderers/contributions 的组件实现。
 */
export const WebExtensionDescriptorMetaSchema = z.object({
  manifestId: z.string().min(1),
  capabilities: z.array(WebExtensionCapabilitySchema).optional(),
  config: WebExtConfigSchema.optional(),
  artifact: ArtifactDeclarationSchema.optional(),
  /** 声明填充了哪些插槽(放置由宿主据此分配;组件实现在运行时描述符)。 */
  slots: z.array(SlotKeySchema).optional(),
});
export type WebExtensionDescriptorMeta = z.infer<
  typeof WebExtensionDescriptorMetaSchema
>;
