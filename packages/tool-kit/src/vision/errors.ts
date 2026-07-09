/**
 * vision 失败结果构造器 — 无副作用,唯一的 {@link VisionFail} 出口。
 *
 * 约束:`detail` 只承载人类可读说明,**绝不携带图像字节**(base64 仅具名出口不变式)。
 */
import type { VisionFail, VisionFailureReason } from "./types.js";

/** 构造一个失败结果。 */
export function fail(reason: VisionFailureReason, detail?: string): VisionFail {
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
}

/** 类型守卫:结果是否为失败。 */
export function isFail(value: { readonly ok: boolean }): value is VisionFail {
  return value.ok === false;
}

/**
 * 把未知异常压成人类可读说明(不外泄堆栈对象本身)。
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
