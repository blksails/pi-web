/**
 * env-only `${VAR}` placeholder resolver for `@pi-web/tool-kit`.
 *
 * Pure `process.env` — no DB / effective-key resolver (pi-labs carries that
 * complexity for multi-tenant key management; tool-kit Wave 1 is env-only).
 *
 * 占位语法:
 *  - `${VAR}`            —— 从 `process.env.VAR` 取值;缺失(未设/空)按调用面语义处理。
 *  - `${VAR:-default}`   —— 缺失时回落到 `default`(default 可含 `:` `/` 等任意非 `}` 字符,
 *                          如 `${DASHSCOPE_BASE_URL:-https://dashscope.aliyuncs.com/api/v1}`),
 *                          故带默认值的占位**永不视为缺失**(声明层可配 base/端点而无需读 env)。
 *
 * Three exported surfaces:
 *  - {@link resolveVars}         — throw if any **无默认值** placeholder is missing
 *  - {@link resolveVarsOptional} — return undefined if any **无默认值** placeholder is missing
 *  - {@link checkRequiredVars}   — pre-flight check used by compile-tool to decide degradation
 */

/** 匹配 `${VAR}` 或 `${VAR:-default}`;group1=var 名(大写),group2=默认值(可选,任意非 `}`)。 */
const VAR_RE = /\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g;

/**
 * Replace every `${VAR}` / `${VAR:-default}` in `template`:
 *  - env 有值 → 用 env 值;
 *  - env 缺失但带默认值 → 用默认值;
 *  - env 缺失且无默认值 → 记为 missing。
 * 任一无默认值占位缺失 → 抛错(列出去重后的缺失变量名)。
 */
export function resolveVars(template: string): string {
  const missing = new Set<string>();
  const out = template.replace(
    VAR_RE,
    (_full, name: string, def: string | undefined) => {
      const value = process.env[name];
      if (value !== undefined && value !== "") return value;
      if (def !== undefined) return def;
      missing.add(name);
      return "";
    },
  );
  if (missing.size > 0) {
    const names = [...missing];
    throw new Error(
      `Missing env variable${names.length > 1 ? "s" : ""}: ${names.join(", ")}`,
    );
  }
  return out;
}

/**
 * Like {@link resolveVars} but returns `undefined` instead of throwing when any
 * **无默认值** `${VAR}` is unresolvable.  Used for optional fields like `proxy`.
 * 带默认值的占位永不导致 undefined(默认值兜底)。
 */
export function resolveVarsOptional(template?: string): string | undefined {
  if (template === undefined) return undefined;
  let failed = false;
  const out = template.replace(
    VAR_RE,
    (_full, name: string, def: string | undefined) => {
      const value = process.env[name];
      if (value !== undefined && value !== "") return value;
      if (def !== undefined) return def;
      failed = true;
      return "";
    },
  );
  return failed ? undefined : out;
}

/**
 * Pre-flight check: tests whether all listed env vars are present without
 * actually substituting them.  Returns `{ ok: true }` or `{ ok: false, missing }`.
 *
 * 注:此处入参是**变量名列表**(`requiredVars`),与模板占位的默认值语法无关——
 * 带默认值的 base/端点不应进 `requiredVars`(它们永远可解析,无需降级门控)。
 */
export function checkRequiredVars(
  vars?: readonly string[],
): { ok: true } | { ok: false; missing: string[] } {
  if (!vars || vars.length === 0) return { ok: true };
  const missing = vars.filter((name) => {
    const v = process.env[name];
    return v === undefined || v === "";
  });
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true };
}
