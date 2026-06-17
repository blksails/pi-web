/**
 * http-api — 请求体边界校验(用 @pi-web/protocol DTO `safeParse`,Req 2.2/3.3/4.5)。
 *
 * 成功返回 typed body;失败返回带字段路径的统一 400 错误响应,且不向会话转发。
 */
import type { z } from "zod";
import { errorResponse } from "./error-map.js";

export type ValidateResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly response: Response };

/** 把 JSON body 经 schema 校验;非 JSON 或不符返回 400(含字段路径)。 */
export async function validateBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<ValidateResult<T>> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    return {
      ok: false,
      response: errorResponse(
        400,
        "INVALID_JSON",
        "Request body is not valid JSON.",
      ),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) =>
      i.path.length > 0 ? i.path.join(".") : "(root)",
    );
    return {
      ok: false,
      response: errorResponse(
        400,
        "VALIDATION_FAILED",
        "Request body failed validation.",
        fields,
      ),
    };
  }
  return { ok: true, value: parsed.data };
}
