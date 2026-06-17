/**
 * session-engine / translate — 翻译层类型(仅引用 @pi-web/protocol 帧类型)。
 */
import type { SseFrame } from "@pi-web/protocol";
import type { TranslationContext } from "./translation-context.js";

/** 翻译结果:零或多个 protocol 定义的 SSE 帧 + 推进后的不可变上下文。 */
export interface TranslateResult {
  readonly frames: readonly SseFrame[];
  readonly ctx: TranslationContext;
}
