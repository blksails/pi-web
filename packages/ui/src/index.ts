/**
 * @pi-web/ui — shadcn/AI-Elements 有样式组件层(npm 聚合导出面)。
 *
 * 拖入组件 `<PiChat>` + 细粒度组件 + 渲染器注册表 + 公开类型。
 * 主题经 shadcn CSS 变量(见 ./styles.css),继承宿主主题。
 */

// 拖入聊天组件 + 插槽
export { PiChat, type PiChatProps } from "./chat/pi-chat.js";
export type { PiChatSlots } from "./chat/slots.js";

// part 分派
export { PartRenderer, type PartRendererProps } from "./chat/part-renderer.js";

// parts 层默认渲染组件
export {
  PiToolPart,
  type PiToolPartProps,
  type ToolPart,
} from "./parts/pi-tool-part.js";
export {
  PiReasoning,
  type PiReasoningProps,
  type ReasoningPart,
} from "./parts/pi-reasoning.js";

// controls 层
export {
  PiModelSelector,
  type PiModelSelectorProps,
  type PiModelOption,
} from "./controls/pi-model-selector.js";
export {
  PiThinkingLevel,
  type PiThinkingLevelProps,
} from "./controls/pi-thinking-level.js";
export {
  PiSessionStats,
  type PiSessionStatsProps,
} from "./controls/pi-session-stats.js";
export {
  PiCommandPalette,
  type PiCommandPaletteProps,
} from "./controls/pi-command-palette.js";

// dialog 层
export {
  PiPermissionDialog,
  type PiPermissionDialogProps,
} from "./dialog/pi-permission-dialog.js";

// 渲染器注册表
export {
  registerToolRenderer,
  registerDataPartRenderer,
  createRendererRegistry,
  defaultRendererRegistry,
  type RendererRegistry,
  type ToolRenderer,
  type DataPartRenderer,
} from "./registry/renderer-registry.js";

// className 合并工具(供宿主复用)
export { cn } from "./lib/cn.js";
