/**
 * @pi-web/react — headless 客户端层(transport + REST client + hooks)。
 *
 * 唯一公开导入面:PiTransport / createPiClient / usePiSession / usePiControls /
 * useExtensionUI / PiProvider 及公开类型。无样式、无 JSX 组件(那归 ui-components)。
 */

// config(配置表单状态 + 设置面板注册表 + 域 IO)
export * from "./config/index.js";

// transport
export { PiTransport, type PiTransportOptions } from "./transport/pi-transport.js";

// client
export {
  createPiClient,
  type PiClient,
  type FetchLike,
} from "./client/pi-client.js";
export {
  PiHttpError,
  PiProtocolVersionError,
  type PiErrorBody,
} from "./client/errors.js";

// sse / connection / control store
export { PiSessionConnection, type PiSessionConnectionOptions } from "./sse/connection.js";
export {
  ControlStore,
  type ControlSnapshot,
  type QueueSnapshot,
  type SessionErrorSnapshot,
  type ExtensionNotification,
  type ExtensionWidget,
  type EditorTextSignal,
  type AmbientUiSnapshot,
} from "./sse/control-store.js";
export { parseSse, type ParsedSseEvent, type ParseSseResult } from "./sse/parse-sse.js";
export { decodeUiMessageChunk } from "./sse/decode-chunk.js";

// version
export {
  baseProtocolVersion,
  isProtocolVersionCompatible,
  assertProtocolVersion,
} from "./version.js";

// provider
export {
  PiProvider,
  usePiContext,
  type PiProviderProps,
  type PiContextValue,
} from "./provider/pi-provider.js";

// hooks
export {
  usePiSession,
  type UsePiSessionOptions,
  type UsePiSessionResult,
  type PiSessionStatus,
} from "./hooks/use-pi-session.js";
export {
  usePiControls,
  type UsePiControlsOptions,
  type UsePiControlsResult,
  type OperationState,
  type ControlOperation,
} from "./hooks/use-pi-controls.js";
export {
  useExtensionUI,
  type UseExtensionUIOptions,
  type UseExtensionUIResult,
} from "./hooks/use-extension-ui.js";
export {
  useModels,
  type UseModelsOptions,
  type UseModelsResult,
  type ModelGroup,
  type ModelItem,
  type ModelSelection,
} from "./hooks/use-models.js";
export {
  useAttachments,
  type UseAttachmentsOptions,
  type UseAttachmentsResult,
  type PendingAttachment,
} from "./hooks/use-attachments.js";
export {
  useBranches,
  type UseBranchesOptions,
  type UseBranchesResult,
  type BranchInfo,
} from "./hooks/use-branches.js";
export {
  useSuggestions,
  type UseSuggestionsOptions,
  type UseSuggestionsResult,
  type Suggestion,
  type SuggestionMerge,
} from "./hooks/use-suggestions.js";

// web-ext(agent-web-extension):宿主侧加载器 + 安全门 + UI↔agent RPC client
export {
  verifyExtension,
  verifyIntegrity,
  verifySignature,
  isApiCompatible,
  computeSri,
  type GateOptions,
  type GateResult,
} from "./web-ext/extension-gate.js";
export {
  loadExtension,
  browserLoaderDeps,
  buildImportMap,
  type LoaderDeps,
  type LoadOutcome,
  type LoadExtensionInput,
} from "./web-ext/extension-loader.js";
export {
  createUiRpcBus,
  type UiRpcBus,
  type UiRpcBusOptions,
} from "./web-ext/ui-rpc-bus.js";
