/**
 * ui-tokens — 设计令牌 → 固定类名映射(server-driven UI 共用)。
 *
 * 沙箱解释器与内置组件都只接受令牌化枚举(tone/size/...),在此集中映射为
 * 经 shadcn CSS 变量主题化的固定类名。绝不拼接任意 CSS/className,确保 agent
 * 无法注入样式 —— 未知令牌一律回退默认。
 */
import type { UiSize, UiStyle, UiTone } from "@pi-web/protocol";

/** 文本语气 → 前景色类。 */
const TONE_TEXT: Record<UiTone, string> = {
  default: "text-[hsl(var(--foreground))]",
  muted: "text-[hsl(var(--muted-foreground))]",
  primary: "text-[hsl(var(--primary))]",
  success: "text-[hsl(var(--success,142_72%_29%))]",
  warning: "text-[hsl(var(--warning,38_92%_40%))]",
  danger: "text-[hsl(var(--destructive))]",
  info: "text-[hsl(var(--primary))]",
};

/** 语气 → 徽标/告示(背景 + 前景)类。 */
const TONE_SOFT: Record<UiTone, string> = {
  default: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  muted: "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
  primary: "bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]",
  success: "bg-[hsl(142_72%_29%/0.12)] text-[hsl(142_72%_29%)]",
  warning: "bg-[hsl(38_92%_40%/0.14)] text-[hsl(38_92%_40%)]",
  danger:
    "bg-[hsl(var(--destructive)/0.12)] text-[hsl(var(--destructive))]",
  info: "bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]",
};

const SIZE_TEXT: Record<UiSize, string> = {
  xs: "text-xs",
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
  xl: "text-2xl",
};

const SIZE_GAP: Record<UiSize, string> = {
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-3",
  lg: "gap-4",
  xl: "gap-6",
};

const SIZE_PAD: Record<UiSize, string> = {
  xs: "p-1",
  sm: "p-2",
  md: "p-3",
  lg: "p-4",
  xl: "p-6",
};

const WEIGHT: Record<NonNullable<UiStyle["weight"]>, string> = {
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
};

const ALIGN: Record<NonNullable<UiStyle["align"]>, string> = {
  start: "items-start justify-start text-left",
  center: "items-center justify-center text-center",
  end: "items-end justify-end text-right",
  between: "items-center justify-between",
};

export function toneText(tone: UiTone | undefined): string {
  return tone === undefined ? "" : (TONE_TEXT[tone] ?? "");
}

export function toneSoft(tone: UiTone | undefined): string {
  return tone === undefined ? TONE_SOFT.default : (TONE_SOFT[tone] ?? TONE_SOFT.default);
}

/** 把受限样式令牌整体映射为类名串(纯文本类语境:tone/size/weight/align)。 */
export function textStyleClasses(style: UiStyle | undefined): string {
  if (style === undefined) return "";
  const out: string[] = [];
  if (style.tone !== undefined) out.push(TONE_TEXT[style.tone] ?? "");
  if (style.size !== undefined) out.push(SIZE_TEXT[style.size] ?? "");
  if (style.weight !== undefined) out.push(WEIGHT[style.weight] ?? "");
  if (style.align !== undefined) out.push(ALIGN[style.align] ?? "");
  return out.filter(Boolean).join(" ");
}

/** 容器类语境:在文本令牌之外追加 gap/pad(box 用)。 */
export function boxStyleClasses(style: UiStyle | undefined): string {
  const out: string[] = [textStyleClasses(style)];
  if (style?.gap !== undefined) out.push(SIZE_GAP[style.gap] ?? "");
  if (style?.pad !== undefined) out.push(SIZE_PAD[style.pad] ?? "");
  return out.filter(Boolean).join(" ");
}
