/**
 * @pi-web/ui — shadcn/AI-Elements 有样式组件层(npm 聚合导出面)。
 *
 * 默认拖入组件 `<PiChat>`(富装配)+ 最小组件 `<PiChatBasic>` + 细粒度组件 +
 * 渲染器注册表 + 公开类型。`PiChatPro` 为指向 `PiChat` 的废弃别名。
 * 主题经 shadcn CSS 变量(见 ./styles.css),继承宿主主题。
 */

// 默认拖入聊天组件(富装配)+ 插槽
export { PiChat, type PiChatProps } from "./chat/pi-chat.js";
export type { PiChatSlots } from "./chat/slots.js";

// 最小拖入聊天组件
export { PiChatBasic, type PiChatBasicProps } from "./chat/pi-chat-basic.js";

// 废弃别名:PiChatPro → PiChat
export { PiChatPro, type PiChatProProps } from "./chat/pi-chat-pro.js";

// 无状态元件层(elements/*)— 含 ChatError(错误提示元件,message 空不渲染,
// 非空 destructive 配色 + role="alert")
export * from "./elements/index.js";

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

// 配置表单层(由 object schema 生成配置 UI)
export * from "./config/index.js";

// 文本输入基元
export { Input, type InputProps } from "./ui/input.js";

// server-driven UI(自定义渲染扩展):data-pi-ui 渲染器 + 沙箱解释器 + 组件注册表
export { PiUiPart } from "./parts/pi-ui-part.js";
export {
  SandboxRenderer,
  type SandboxRendererProps,
} from "./components/sandbox-renderer.js";
export {
  createUiComponentRegistry,
  defaultUiComponentRegistry,
  registerUiComponent,
  type UiComponentRegistry,
  type UiComponent,
} from "./components/ui-component-registry.js";
export {
  builtinUiComponents,
  registerBuiltinUiComponents,
} from "./components/builtin-components.js";

// className 合并工具(供宿主复用)
export { cn } from "./lib/cn.js";
