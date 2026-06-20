/**
 * web-ext 契约 — Tier 5 声明式配置 schema(theme token / layout 预设)。
 *
 * 抽出为独立文件:被 manifest(零代码路径内联 config)与 descriptor 共用,避免循环引用。
 */
import { z } from "zod";

/** 主题 token(token 名 → CSS 值)。扩展只读宿主 token、可加 `--pw-<id>-*` 自定义。 */
export const ThemeTokensSchema = z.record(z.string(), z.string());
export type ThemeTokens = z.infer<typeof ThemeTokensSchema>;

/** 布局预设标识(对齐宿主 LayoutPreset)。 */
export const LayoutPresetSchema = z.string();
export type LayoutPreset = z.infer<typeof LayoutPresetSchema>;

/**
 * 空态建议项(可序列化)。字段与 `@pi-web/react` 的 `Suggestion` 对齐:
 * protocol 不可依赖 react,故在此独立定义;宿主透传时类型相容直接作为 suggestionsPresets。
 */
export const EmptySuggestionSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  /** "fill" 填入输入框;"send" 直接发送。 */
  mode: z.enum(["fill", "send"]),
});
export type EmptySuggestion = z.infer<typeof EmptySuggestionSchema>;

/**
 * 空态(EmptyState)声明式配置。
 * mergeCommands 控制 starters 与 agent slash 命令的合并:
 * append(默认,命令在前)/prepend(配置在前)/replace(仅配置,空则回落命令)。
 */
export const EmptyConfigSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  starters: z.array(EmptySuggestionSchema).optional(),
  mergeCommands: z.enum(["append", "prepend", "replace"]).optional(),
});
export type EmptyConfig = z.infer<typeof EmptyConfigSchema>;

/** 声明式配置(零代码路径可仅靠此,内联于 manifest)。 */
export const WebExtConfigSchema = z.object({
  theme: ThemeTokensSchema.optional(),
  layout: LayoutPresetSchema.optional(),
  empty: EmptyConfigSchema.optional(),
  /**
   * 浏览器标签页标题(document.title)。agent source 载入后由宿主同步;
   * 会话卸载(回选源页)或切到无此声明的 source 时还原为载入前的标题。
   */
  documentTitle: z.string().optional(),
});
export type WebExtConfig = z.infer<typeof WebExtConfigSchema>;
