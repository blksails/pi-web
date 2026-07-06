/**
 * @blksails/pi-web-primitives — 共享薄封装唯一出口(出口纪律)。
 *
 * 纪律(Req 1.1/1.2/1.4,canvas-ui-m15 design「Boundary Commitments」):
 * - 此出口只收纳下沉的 6 个 shadcn 薄封装(Button/Card/Input/Popover/Select/
 *   Textarea 及其子件)与 cn 工具,实现语义与迁移前 packages/ui/src/ui/* 与
 *   src/lib/cn.ts 逐一致;
 * - 主题量(颜色/边框/圆角)一律经 design tokens(CSS 变量)表达,
 *   本包**不**引入独立主题体系;
 * - 依赖方向:ui/领域包消费 primitives,反向禁止(本包零 @blksails/* 依赖);
 * - 此出口是 semver 承诺面:任何导出的增删改按 semver 语义对待;
 *   显式清单 re-export,禁 export *(防内部件经链泄漏成既成公开面)。
 */
// Button(含 CVA 变体函数与 Props 类型)。
export { Button, buttonVariants } from "./button.js";
export type { ButtonProps } from "./button.js";
// Card。
export { Card } from "./card.js";
// Input。
export { Input } from "./input.js";
export type { InputProps } from "./input.js";
// Popover(Radix 封装:Root/Trigger/Anchor/Content)。
export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "./popover.js";
// Select(Radix 封装:Root/Group/Value/Trigger/Content/Item)。
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select.js";
// Textarea。
export { Textarea } from "./textarea.js";
export type { TextareaProps } from "./textarea.js";
// cn — className 合并工具(clsx + tailwind-merge)。
export { cn } from "./cn.js";
