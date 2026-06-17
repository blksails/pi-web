/**
 * session-engine — 公共导出面。
 *
 * 向 http-api 提供唯一的会话抽象:PiSession(订阅/转发/生命周期)、SessionStore
 * (注册检索)、SessionManager(创建编排 + 优雅停机)与纯函数翻译层。
 */
export { PiSession } from "./pi-session.js";
export {
  SessionManager,
  type SessionManagerOptions,
} from "./session-manager.js";
export {
  InMemorySessionStore,
  type SessionStore,
} from "./session-store.js";
export {
  SessionStoppedError,
  SessionNotFoundError,
  UnknownExtensionUIError,
  MissingInputError,
} from "./session.errors.js";
export type {
  SessionId,
  SessionStatus,
  SessionEndReason,
  SessionDescriptor,
  SubscribeHandle,
  FrameListener,
  SessionEndListener,
  CachedState,
  CreateSessionInput,
  PiSessionOptions,
  SessionChannel,
} from "./session.types.js";
export { DEFAULT_IDLE_MS } from "./session.types.js";
export { translateEvent } from "./translate/translate-event.js";
export type { TranslateResult } from "./translate/translate.types.js";
export {
  createTranslationContext,
  type TranslationContext,
} from "./translate/translation-context.js";
