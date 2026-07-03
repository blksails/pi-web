/**
 * @blksails/pi-web-ui — shadcn/AI-Elements 有样式组件层(npm 聚合导出面)。
 *
 * 默认拖入组件 `<PiChat>`(富装配)+ 最小组件 `<PiChatBasic>` + 细粒度组件 +
 * 渲染器注册表 + 公开类型。
 * 主题经 shadcn CSS 变量(见 ./styles.css),继承宿主主题。
 */

// 默认拖入聊天组件(富装配)+ 插槽
export { PiChat, type PiChatProps } from "./chat/pi-chat.js";
export { PiQueuePanel, type PiQueuePanelProps } from "./chat/pi-queue-panel.js";
export type { PiChatSlots } from "./chat/slots.js";

// 最小拖入聊天组件
export { PiChatBasic, type PiChatBasicProps } from "./chat/pi-chat-basic.js";

// 无状态元件层(elements/*)— 含 ChatError(错误提示元件,message 空不渲染,
// 非空 destructive 配色 + role="alert")
export * from "./elements/index.js";

// completion-provider-framework(前端 core 触发符补全)
export * from "./completion/index.js";

// part 分派
export { PartRenderer, type PartRendererProps } from "./chat/part-renderer.js";

// parts 层默认渲染组件
export {
  PiToolPart,
  type PiToolPartProps,
  type ToolPart,
  type ToolPhase,
  // 复合子组件(可独立装配/替换)
  ToolHeader,
  type ToolHeaderProps,
  ToolContent,
  type ToolContentProps,
  ToolInput,
  type ToolInputProps,
  ToolOutput,
  type ToolOutputProps,
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
  type ExtensionCommandPolicy,
} from "./controls/pi-command-palette.js";
export {
  parseCommandStage,
  findSubcommand,
  type CommandArgItem,
  type CommandArgProvider,
  type CommandArgSpec,
  type SubcommandSpec,
  type CommandStage,
} from "./controls/command-arg.js";
export {
  createPluginArgProvider,
  type PluginArgProviderOptions,
} from "./controls/plugin-arg-provider.js";

// interaction 层(原 dialog/PiPermissionDialog 重命名为 elements/PiInteraction)
export {
  PiInteraction,
  type PiInteractionProps,
} from "./elements/pi-interaction.js";

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

// Dialog 原语(shadcn/Radix 封装:焦点捕获 / Esc / 遮罩点击关闭 / aria 对话框语义)
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog.js";

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

// 定制契约(pi-chat-customization):四维定制公开 API
export type { ToolbarControl } from "./chat/pi-chat.js";
export {
  IconsProvider,
  useIcon,
  type IconProps,
  type IconComponent,
  type IconSlot,
  type IconTheme,
  type IconsProviderProps,
  layoutClassNames,
  type LayoutPreset,
  type LayoutClassNames,
  resolveComponent,
  type ComponentOverrides,
  type MessageRole,
} from "./customization/index.js";
export {
  ThemeProvider,
  useTheme,
  type ThemeMode,
  type ThemeProviderProps,
  type UseThemeResult,
} from "./theme/index.js";

// web-ext(agent-web-extension):宿主 UI 集成(Tier1 区域插槽 / Tier4 artifact / Tier3 贡献点)
export {
  SlotHost,
  applyExtensionRenderers,
  resolveSlot,
  type SlotHostProps,
} from "./web-ext/apply-extension.js";
export { ExtErrorBoundary } from "./web-ext/ext-error-boundary.js";
export {
  ArtifactSurface,
  type ArtifactSurfaceProps,
} from "./web-ext/artifact-surface.js";
export {
  createContributionsController,
  type ContributionsController,
} from "./web-ext/contributions-controller.js";

// i18n(轻量自研 i18n 运行时:零第三方依赖,isomorphic)
export * from "./i18n/index.js";

// aigc-canvas(domain="canvas" 的 AAS 实例 UI:画廊 + 二创工作台;门控 NEXT_PUBLIC_PI_WEB_CANVAS)
export { CanvasGallery, type CanvasGalleryProps } from "./canvas/canvas-gallery.js";
export { CanvasWorkbench, type CanvasWorkbenchProps } from "./canvas/canvas-workbench.js";
export {
  CanvasLauncher,
  CanvasPanel,
  isCanvasEnabled,
  type CanvasLauncherProps,
  type CanvasPanelProps,
} from "./canvas/canvas-launcher.js";
export { LineageView, buildLineageTree, type LineageViewProps, type LineageNode } from "./canvas/lineage-view.js";
export {
  useCanvasView,
  useCanvasOpen,
  canvasOpenStore,
  CANVAS_PAGE_SIZE,
  type CanvasDensity,
  type CanvasGroupMode,
  type CanvasViewState,
} from "./canvas/use-canvas-view.js";
export * from "./canvas/client-image-ops.js";
