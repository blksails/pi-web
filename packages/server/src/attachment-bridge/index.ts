/**
 * attachment-tool-bridge · 模块公共出口(barrel)。
 *
 * 随波次推进逐步补齐:本切片(task 1.1)首批导出子进程 store 客户端工厂与门面别名类型;
 * 后续任务在此追加 AttachmentHandle/resolve、TempFileTracker、ownership-guard、base64-gate、
 * tool-output、reference-injection、tool-context 等。
 */
export {
  createChildAttachmentStore,
  type ChildAttachmentStore,
} from "./child-store.js";
export {
  createTempFileTracker,
  type TempFileTracker,
  type TempFileTrackerOptions,
} from "./temp-files.js";
export {
  type AttachmentHandle,
  createAttachmentHandle,
  AttachmentLocalPathUnavailableError,
} from "./attachment-handle.js";
export { resolveAttachment, AttachmentResolveError } from "./resolve.js";
export {
  makeBeforeToolCall,
  type ToolCallGuardEvent,
  type ToolCallGuardResult,
} from "./ownership-guard.js";
export {
  KEEP_INLINE_FLAG,
  makeAfterToolCall,
  type AfterToolCallGuardEvent,
  type AfterToolCallGuardResult,
  type ToolResultContent,
  type TextContent,
  type ImageContent,
} from "./base64-gate.js";
export {
  putToolOutput,
  ToolOutputPutError,
  type PutToolOutputInput,
  type ToolOutputRef,
} from "./tool-output.js";
export {
  buildAttachmentRefs,
  injectAttachmentRefs,
} from "./reference-injection.js";
