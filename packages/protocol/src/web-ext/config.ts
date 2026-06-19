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

/** 声明式配置(零代码路径可仅靠此,内联于 manifest)。 */
export const WebExtConfigSchema = z.object({
  theme: ThemeTokensSchema.optional(),
  layout: LayoutPresetSchema.optional(),
});
export type WebExtConfig = z.infer<typeof WebExtConfigSchema>;
