/**
 * session-engine / translate — TranslationContext(纯、不可变)。
 *
 * 翻译所需的最小状态快照:partId 分配计数与 text/reasoning part 的开闭状态。
 * 所有推进操作返回新的快照,绝不变更入参(Functional Core)。无 I/O、无计时器、
 * 无可变全局(Req 4.1)。乱序/重复 `*_start`/`*_end` 经确定容错分支处理(Req 4.12)。
 */

/** 不可变翻译上下文快照。 */
export interface TranslationContext {
  /** 单调递增的 partId 分配计数。 */
  readonly nextPartId: number;
  /** 是否已开启 assistant message(agent_start 后)。 */
  readonly messageOpen: boolean;
  /** 当前开启中的 text part id(无则 undefined)。 */
  readonly openTextPartId?: string;
  /** 当前开启中的 reasoning part id(无则 undefined)。 */
  readonly openReasoningPartId?: string;
}

/** 初始化一个空的翻译上下文。 */
export function createTranslationContext(): TranslationContext {
  return { nextPartId: 1, messageOpen: false };
}

/** 分配一个新的 partId,返回 `{ id, ctx }`(纯,推进 nextPartId)。 */
export function allocatePartId(ctx: TranslationContext): {
  readonly id: string;
  readonly ctx: TranslationContext;
} {
  const id = `p${ctx.nextPartId}`;
  return { id, ctx: { ...ctx, nextPartId: ctx.nextPartId + 1 } };
}

/** 标记 message 已开启(幂等:重复开启不重复分配)。 */
export function openMessage(ctx: TranslationContext): TranslationContext {
  return ctx.messageOpen ? ctx : { ...ctx, messageOpen: true };
}

/** 开启一个 text part,返回其 id 与推进后的 ctx。 */
export function openTextPart(ctx: TranslationContext): {
  readonly id: string;
  readonly ctx: TranslationContext;
} {
  const { id, ctx: allocated } = allocatePartId(ctx);
  return { id, ctx: { ...allocated, openTextPartId: id } };
}

/** 关闭当前 text part(无开启项时无副作用)。 */
export function closeTextPart(ctx: TranslationContext): TranslationContext {
  if (ctx.openTextPartId === undefined) return ctx;
  const next: TranslationContext = { ...ctx };
  delete (next as { openTextPartId?: string }).openTextPartId;
  return next;
}

/** 开启一个 reasoning part,返回其 id 与推进后的 ctx。 */
export function openReasoningPart(ctx: TranslationContext): {
  readonly id: string;
  readonly ctx: TranslationContext;
} {
  const { id, ctx: allocated } = allocatePartId(ctx);
  return { id, ctx: { ...allocated, openReasoningPartId: id } };
}

/** 关闭当前 reasoning part(无开启项时无副作用)。 */
export function closeReasoningPart(ctx: TranslationContext): TranslationContext {
  if (ctx.openReasoningPartId === undefined) return ctx;
  const next: TranslationContext = { ...ctx };
  delete (next as { openReasoningPartId?: string }).openReasoningPartId;
  return next;
}
