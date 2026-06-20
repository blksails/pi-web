/**
 * pi-web 自定义传输层 — server-driven UI 规格(UiSpec)schema。
 *
 * 让 pi agent 作者从后端声明富 UI(图表/表格/卡片/指标),前端零配置渲染。
 * 采用「1+2 组合」信任模型:
 *   - kind:"builtin"  → 内置白名单组件:仅给出组件名 + JSON props,前端用预置组件渲染。
 *   - kind:"sandbox"  → 沙箱组件:给出**可序列化的声明式节点树**(非原始 HTML/JSX),
 *                       由宿主解释器仅按白名单元素 + 设计令牌渲染。
 *
 * 沙箱安全边界(schema 层即收口,渲染层再次校验作纵深防御):
 *   - 元素类型白名单(el 判别),未知元素直接拒绝;
 *   - 无任意 className/style 字符串 —— 样式只接受令牌化枚举(UiStyle),杜绝 CSS 注入;
 *   - 无事件处理器、无脚本、无 dangerouslySetInnerHTML(渲染层保证);
 *   - link.href / image.src 仅允许安全协议(http/https/mailto、data:image);
 *   - 节点树深度由渲染层限制,防止深层嵌套 DoS。
 *
 * 这是 pi-web 自定义契约(非 pi 原生派生),与 rpc/* 分层。
 */
import { z } from "zod";

/** 语气令牌:映射设计系统配色,不接受任意颜色。 */
export const UiToneSchema = z.enum([
  "default",
  "muted",
  "primary",
  "success",
  "warning",
  "danger",
  "info",
]);
export type UiTone = z.infer<typeof UiToneSchema>;

/** 尺寸令牌:映射间距/字号刻度。 */
export const UiSizeSchema = z.enum(["xs", "sm", "md", "lg", "xl"]);
export type UiSize = z.infer<typeof UiSizeSchema>;

/** 受限内联样式:仅令牌化字段,渲染层映射为固定类名;无任意 CSS。 */
export const UiStyleSchema = z
  .object({
    tone: UiToneSchema.optional(),
    size: UiSizeSchema.optional(),
    align: z.enum(["start", "center", "end", "between"]).optional(),
    weight: z.enum(["normal", "medium", "semibold", "bold"]).optional(),
    gap: UiSizeSchema.optional(),
    pad: UiSizeSchema.optional(),
  })
  .strict();
export type UiStyle = z.infer<typeof UiStyleSchema>;

/** 安全 href:仅 http/https/mailto。 */
const SafeHrefSchema = z
  .string()
  .min(1)
  .refine((s) => /^(https?:|mailto:)/i.test(s), {
    message: "href 仅允许 http/https/mailto",
  });

/** 安全图片源:仅 https/http 或 data:image/*。 */
const SafeImageSrcSchema = z
  .string()
  .min(1)
  .refine((s) => /^(https?:|data:image\/)/i.test(s), {
    message: "image src 仅允许 http/https/data:image",
  });

/**
 * 沙箱 UI 节点(声明式、可序列化)。仅 box 可递归承载子节点,其余为叶子,
 * 收敛攻击面与渲染复杂度。判别字段为 `el`。
 */
export type UiNode =
  | { el: "box"; direction?: "row" | "col"; style?: UiStyle; children?: UiNode[] }
  | { el: "text"; text: string; style?: UiStyle }
  | { el: "heading"; level?: 1 | 2 | 3; text: string; style?: UiStyle }
  | { el: "badge"; text: string; style?: UiStyle }
  | { el: "divider" }
  | { el: "code"; text: string; lang?: string; block?: boolean }
  | { el: "link"; text: string; href: string }
  | { el: "list"; ordered?: boolean; items: string[] }
  | { el: "keyValue"; rows: { key: string; value: string }[] }
  | { el: "table"; columns: string[]; rows: string[][]; caption?: string }
  | { el: "image"; src: string; alt?: string; style?: UiStyle };

export const UiNodeSchema: z.ZodType<UiNode> = z.lazy(() =>
  z.discriminatedUnion("el", [
    z.object({
      el: z.literal("box"),
      direction: z.enum(["row", "col"]).optional(),
      style: UiStyleSchema.optional(),
      children: z.array(UiNodeSchema).optional(),
    }),
    z.object({
      el: z.literal("text"),
      text: z.string(),
      style: UiStyleSchema.optional(),
    }),
    z.object({
      el: z.literal("heading"),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      text: z.string(),
      style: UiStyleSchema.optional(),
    }),
    z.object({
      el: z.literal("badge"),
      text: z.string(),
      style: UiStyleSchema.optional(),
    }),
    z.object({ el: z.literal("divider") }),
    z.object({
      el: z.literal("code"),
      text: z.string(),
      lang: z.string().optional(),
      block: z.boolean().optional(),
    }),
    z.object({
      el: z.literal("link"),
      text: z.string(),
      href: SafeHrefSchema,
    }),
    z.object({
      el: z.literal("list"),
      ordered: z.boolean().optional(),
      items: z.array(z.string()),
    }),
    z.object({
      el: z.literal("keyValue"),
      rows: z.array(z.object({ key: z.string(), value: z.string() })),
    }),
    z.object({
      el: z.literal("table"),
      columns: z.array(z.string()),
      rows: z.array(z.array(z.string())),
      caption: z.string().optional(),
    }),
    z.object({
      el: z.literal("image"),
      src: SafeImageSrcSchema,
      alt: z.string().optional(),
      style: UiStyleSchema.optional(),
    }),
  ]),
) as z.ZodType<UiNode>;

/** 内置白名单组件:组件名 + JSON props,由前端组件注册表解析渲染。 */
export const BuiltinUiSpecSchema = z.object({
  kind: z.literal("builtin"),
  /** 白名单组件名(前端注册表键);未注册则前端回退占位。 */
  component: z.string().min(1),
  /** 透传给组件的 JSON props,由组件自身做形状校验。 */
  props: z.record(z.unknown()).optional(),
  /** 可选标题,渲染在组件容器顶部。 */
  title: z.string().optional(),
});
export type BuiltinUiSpec = z.infer<typeof BuiltinUiSpecSchema>;

/** 沙箱组件:声明式节点树,由受限解释器渲染。 */
export const SandboxUiSpecSchema = z.object({
  kind: z.literal("sandbox"),
  root: UiNodeSchema,
  title: z.string().optional(),
});
export type SandboxUiSpec = z.infer<typeof SandboxUiSpecSchema>;

/** UiSpec 联合,以 `kind` 判别(builtin / sandbox)。 */
export const UiSpecSchema = z.discriminatedUnion("kind", [
  BuiltinUiSpecSchema,
  SandboxUiSpecSchema,
]);
export type UiSpec = z.infer<typeof UiSpecSchema>;

/**
 * agent → server-driven UI 的产帧通道约定。
 *
 * agent 工具在 `execute` 内经 `onUpdate({ content: [], details: { [PI_UI_TOOL_DETAILS_KEY]: UiSpec } })`
 * 发出 UI;pi SDK 据此产生 `tool_execution_update` 事件,server 翻译层识别此 key 后
 * 产出 `data-pi-ui` 帧(而非默认的 `tool-output-available` preliminary)。详见 agent-kit 的 `emitUi` 助手。
 */
export const PI_UI_TOOL_DETAILS_KEY = "__piWebUi" as const;

/**
 * 从 `tool_execution_update.partialResult` 中提取并校验 UiSpec(server 翻译层用)。
 * 形状不符或未携带约定 key 时返回 undefined(回退到 tool-output-available preliminary)。
 */
export function extractToolDetailsUiSpec(partialResult: unknown): UiSpec | undefined {
  if (partialResult === null || typeof partialResult !== "object") return undefined;
  const details = (partialResult as { details?: unknown }).details;
  if (details === null || typeof details !== "object") return undefined;
  const raw = (details as Record<string, unknown>)[PI_UI_TOOL_DETAILS_KEY];
  if (raw === undefined) return undefined;
  const parsed = UiSpecSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
