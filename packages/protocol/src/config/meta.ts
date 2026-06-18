/**
 * UI 元数据 — 经 zod `.describe()` 承载的 JSON 元数据(方案 A)。
 *
 * zod 3 无 `.meta()`,故约定把 UI 提示以 JSON 字符串写入 `.describe(...)`,
 * 由 `parseDescribeMeta` 解析;非 JSON 或缺省时安全回退为空元数据。
 * 将来升级 zod 4 后,仅需改 adapter 改读 `.meta()`,本类型与渲染层不变。
 */
import type { FieldKind } from "./form-schema.js";

/** 单字段的 UI 元数据(全部可选)。 */
export interface UIMeta {
  readonly label?: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly group?: string;
  readonly order?: number;
  readonly widget?: string;
  readonly secret?: boolean;
  readonly readOnly?: boolean;
  /** 覆盖推断出的 kind(少数情形,如把 string 显式标 secret/textarea)。 */
  readonly kind?: FieldKind;
  /** enum 值 → 展示名。 */
  readonly enumLabels?: Readonly<Record<string, string>>;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

const EMPTY: UIMeta = Object.freeze({});

/**
 * 解析 `.describe()` 文本为 UIMeta。
 * - 入参为 JSON 对象字符串 → 解析并保留已知字段;
 * - 入参为普通描述文本(非 JSON)→ 视为 `{ description: text }`;
 * - 缺省/空/非法 → 返回空元数据。
 */
export function parseDescribeMeta(description?: string): UIMeta {
  if (description === undefined) return EMPTY;
  const trimmed = description.trim();
  if (trimmed.length === 0) return EMPTY;
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    // 普通文本描述:作为帮助文本承载。
    return { description };
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { description };
    }
    return parsed as UIMeta;
  } catch {
    // 看似 JSON 实则非法 → 退化为普通描述文本。
    return { description };
  }
}

/** 把字段 key 美化为默认 label(camelCase / snake_case → 词组,首字母大写)。 */
export function prettifyKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (spaced.length === 0) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
