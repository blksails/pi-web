/**
 * Memory name normalization and validation.
 * Names are stable slugs: lowercase, [a-z0-9_-], max 128 chars.
 */

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,127}$/;

export type NameResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly message: string };

/**
 * Normalize user-provided name: trim, lowercase, spaces → `-`.
 * Reject empty / illegal characters after normalization.
 */
export function normalizeMemoryName(raw: string): NameResult {
  const trimmed = raw.trim().toLowerCase().replace(/\s+/g, "-");
  if (trimmed.length === 0) {
    return { ok: false, message: "memory name must not be empty" };
  }
  if (!NAME_RE.test(trimmed)) {
    return {
      ok: false,
      message:
        "memory name must match /^[a-z0-9][a-z0-9_-]{0,127}$/ after normalization",
    };
  }
  return { ok: true, name: trimmed };
}

export function isValidMemoryName(name: string): boolean {
  return NAME_RE.test(name);
}
