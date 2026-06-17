/**
 * @pi-web/react — headless 客户端层(transport + REST client + hooks)。
 *
 * 唯一公开导入面:PiTransport / createPiClient / usePiSession / usePiControls /
 * useExtensionUI / PiProvider 及公开类型。无样式、无 JSX 组件(那归 ui-components)。
 */

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
