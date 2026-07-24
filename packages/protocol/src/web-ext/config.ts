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
 * panelRight 让位比例(对话区 : 右侧领域检视面板)。声明的是「初始」比例;
 * 宿主在有 panelRight 时渲染一个段控切换器,允许运行时在四档间动态切换:
 * - `centered` 收起面板、对话居中(经典版面);
 * - `2:1` 对话 ~66% / 面板 ~33%;
 * - `4:6` 对话 40% / 面板 60%(面板主导,适合 Canvas 等创作台型 agent);
 * - `3:7` 对话 30% / 面板 70%(面板为主,适合检视/仪表盘型 agent)。
 */
export const PanelRatioSchema = z.enum(["centered", "2:1", "4:6", "3:7"]);
export type PanelRatio = z.infer<typeof PanelRatioSchema>;

/**
 * 日志面板位置(声明式,per-source 覆盖宿主全局默认):
 * - `bottom`(默认)对话区下方;`right` 进右侧 aside 与 panelRight 垂直堆叠;
 * - `drawer` 底部抽屉;`top` 对话区上方。
 * 占 panelRight 的 source(如 Canvas)宜声明 `bottom`,避免日志面板挤占右侧 aside。
 */
export const LogsPanelPositionSchema = z.enum(["bottom", "right", "drawer", "top"]);
export type LogsPanelPosition = z.infer<typeof LogsPanelPositionSchema>;

/**
 * 空态建议项(可序列化)。字段与 `@blksails/pi-web-react` 的 `Suggestion` 对齐:
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
  /** panelRight 让位的初始比例(运行时可由宿主切换器改写)。 */
  panelRatio: PanelRatioSchema.optional(),
  /**
   * panelRight 连续拖拽模式的初始像素宽度。存在即由宿主以受控模式接入 PiChat
   * `panelWidth/onPanelWidthChange`，并隐藏离散比例切换器。
   */
  panelWidth: z.number().finite().int().min(240).max(4096).optional(),
  /** 连续拖拽最小宽度；仅与 panelWidth 同时生效。 */
  minPanelWidth: z.number().finite().int().min(160).max(4096).optional(),
  /** 连续拖拽最大宽度；仅与 panelWidth 同时生效。 */
  maxPanelWidth: z.number().finite().int().min(240).max(8192).optional(),
  /** 日志面板位置(覆盖宿主全局默认);占 panelRight 的 source 宜声明 `bottom`。 */
  logsPanelPosition: LogsPanelPositionSchema.optional(),
  empty: EmptyConfigSchema.optional(),
  /**
   * 浏览器标签页标题(document.title)。agent source 载入后由宿主同步;
   * 会话卸载(回选源页)或切到无此声明的 source 时还原为载入前的标题。
   */
  documentTitle: z.string().optional(),
}).superRefine((config, ctx) => {
  if (config.panelWidth === undefined && (config.minPanelWidth !== undefined || config.maxPanelWidth !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["panelWidth"], message: "panelWidth is required when width bounds are declared" });
    return;
  }
  if (config.minPanelWidth !== undefined && config.maxPanelWidth !== undefined && config.minPanelWidth > config.maxPanelWidth) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxPanelWidth"], message: "maxPanelWidth must be >= minPanelWidth" });
  }
  if (config.panelWidth !== undefined && config.minPanelWidth !== undefined && config.panelWidth < config.minPanelWidth) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["panelWidth"], message: "panelWidth must be >= minPanelWidth" });
  }
  if (config.panelWidth !== undefined && config.maxPanelWidth !== undefined && config.panelWidth > config.maxPanelWidth) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["panelWidth"], message: "panelWidth must be <= maxPanelWidth" });
  }
});
export type WebExtConfig = z.infer<typeof WebExtConfigSchema>;
