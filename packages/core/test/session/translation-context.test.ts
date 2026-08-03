/**
 * 翻译上下文:partId 单调分配 / 乱序-重复 start-end 容错 / ctx 不可变(Req 4.3, 4.12, 10.1）。
 */
import { describe, expect, it } from "vitest";
import {
  allocatePartId,
  closeTextPart,
  createTranslationContext,
  openReasoningPart,
  openTextPart,
} from "../../src/session/translate/translation-context.js";

describe("TranslationContext (pure)", () => {
  it("allocates monotonically increasing partIds", () => {
    const a = allocatePartId(createTranslationContext());
    const b = allocatePartId(a.ctx);
    const c = allocatePartId(b.ctx);
    expect(a.id).not.toBe(b.id);
    expect(b.id).not.toBe(c.id);
    expect(a.ctx.nextPartId).toBe(2);
    expect(c.ctx.nextPartId).toBe(4);
  });

  it("does not mutate the input ctx (returns a new snapshot)", () => {
    const ctx = createTranslationContext();
    const r = openTextPart(ctx);
    expect(ctx.openTextPartId).toBeUndefined();
    expect(ctx.nextPartId).toBe(1);
    expect(r.ctx.openTextPartId).toBe(r.id);
    expect(r.ctx).not.toBe(ctx);
  });

  it("closeTextPart on a ctx with no open part is a no-op (deterministic)", () => {
    const ctx = createTranslationContext();
    expect(closeTextPart(ctx).openTextPartId).toBeUndefined();
  });

  it("opening reasoning then text yields distinct ids", () => {
    const r = openReasoningPart(createTranslationContext());
    const t = openTextPart(r.ctx);
    expect(r.id).not.toBe(t.id);
    expect(t.ctx.openReasoningPartId).toBe(r.id);
    expect(t.ctx.openTextPartId).toBe(t.id);
  });
});
