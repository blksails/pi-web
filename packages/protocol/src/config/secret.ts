/**
 * secret 字段的跨层契约 — 掩码视图(读)与写回动作(写)。
 *
 * 单一事实源:server(掩码/合并)与 ui(secret 控件)共用,避免两端漂移。
 * 原则:明文绝不从 server 回传到前端(读只给掩码);写用显式 action 区分保留/覆盖/清除。
 */

/** 读:GET 时 secret 字段的掩码占位(不含明文)。 */
export interface SecretMask {
  readonly __secret: true;
  /** 是否已设置(磁盘已有非空值)。 */
  readonly set: boolean;
  /** 可选的末位提示(如末 4 位),仅用于展示,不足以还原明文。 */
  readonly hint?: string;
}

/** 写:PUT 时 secret 字段的动作(显式三态)。 */
export type SecretWrite =
  | { readonly __secret: true; readonly action: "keep" }
  | { readonly __secret: true; readonly action: "clear" }
  | { readonly __secret: true; readonly action: "set"; readonly value: string };

export function isSecretMask(v: unknown): v is SecretMask {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { __secret?: unknown }).__secret === true &&
    "set" in v
  );
}

export function isSecretWrite(v: unknown): v is SecretWrite {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { __secret?: unknown }).__secret === true &&
    "action" in v
  );
}

export const secretKeep: SecretWrite = { __secret: true, action: "keep" };
export const secretClear: SecretWrite = { __secret: true, action: "clear" };
export function secretSet(value: string): SecretWrite {
  return { __secret: true, action: "set", value };
}
