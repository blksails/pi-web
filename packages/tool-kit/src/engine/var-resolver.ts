/**
 * env-only `${VAR}` placeholder resolver for `@pi-web/tool-kit`.
 *
 * Pure `process.env` — no DB / effective-key resolver (pi-labs carries that
 * complexity for multi-tenant key management; tool-kit Wave 1 is env-only).
 *
 * Three exported surfaces:
 *  - {@link resolveVars}         — throw if any placeholder is missing
 *  - {@link resolveVarsOptional} — return undefined if any placeholder is missing
 *  - {@link checkRequiredVars}   — pre-flight check used by compile-category to decide degradation
 */

const VAR_RE = /\$\{([A-Z0-9_]+)\}/g;

/**
 * Replace every `${VAR_NAME}` in `template` with `process.env[VAR_NAME]`.
 * Each unique var name is read only once.  Throws if any variable is missing.
 */
export function resolveVars(template: string): string {
  const seen = new Map<string, string>();
  const missing: string[] = [];

  for (const m of template.matchAll(VAR_RE)) {
    const name = m[1] as string;
    if (seen.has(name)) continue;
    const value = process.env[name];
    if (value === undefined || value === "") {
      missing.push(name);
    } else {
      seen.set(name, value);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing env variable${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
    );
  }

  if (seen.size === 0) return template;

  return template.replace(VAR_RE, (_, name: string) => seen.get(name) ?? "");
}

/**
 * Like {@link resolveVars} but returns `undefined` instead of throwing when
 * any `${VAR}` is unresolvable.  Used for optional fields like `proxy`.
 */
export function resolveVarsOptional(template?: string): string | undefined {
  if (template === undefined) return undefined;
  const seen = new Map<string, string>();

  for (const m of template.matchAll(VAR_RE)) {
    const name = m[1] as string;
    if (seen.has(name)) continue;
    const value = process.env[name];
    if (value === undefined || value === "") return undefined;
    seen.set(name, value);
  }

  if (seen.size === 0) return template;

  return template.replace(VAR_RE, (_, name: string) => seen.get(name) ?? "");
}

/**
 * Pre-flight check: tests whether all listed env vars are present without
 * actually substituting them.  Returns `{ ok: true }` or `{ ok: false, missing }`.
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
