/**
 * `@blksails/tool-kit` attachment seam — reads the runner-injected
 * `AttachmentToolContext` from `globalThis` (or an injected scope).
 *
 * Convention: the runner (`@blksails/server`) places the context under this key
 * before executing tool `execute` callbacks.  Tools call
 * `getAttachmentToolContext()` to obtain the live context; if the runner has
 * not injected it (e.g. dev without attachment bridge wired, or tests), a safe
 * `UNAVAILABLE_CTX` is returned so the tool can degrade gracefully instead of
 * crashing (Req 5.3).
 */
import type { AttachmentToolContext } from "@blksails/agent-kit";

/** Agreement constant shared between runner (injector) and tools (readers). */
export const SEAM_KEY = "__piWebAttachmentToolContext__";

/** Safe degradation context returned when the seam is not wired. */
const UNAVAILABLE_CTX: AttachmentToolContext = {
  available: false,
  async resolve() {
    throw new Error("attachment capability unavailable: context not injected");
  },
  async putOutput() {
    throw new Error("attachment capability unavailable: context not injected");
  },
};

/**
 * Read the runner-injected {@link AttachmentToolContext} from `scope`
 * (defaults to `globalThis`).
 *
 * Returns `UNAVAILABLE_CTX` (available: false) when the seam is absent or
 * malformed, enabling graceful degradation without crashing the sub-process.
 */
export function getAttachmentToolContext(
  scope?: Record<string, unknown>,
): AttachmentToolContext {
  const target = scope ?? (globalThis as Record<string, unknown>);
  const injected = target[SEAM_KEY];
  if (
    injected != null &&
    typeof injected === "object" &&
    "available" in (injected as object)
  ) {
    return injected as AttachmentToolContext;
  }
  return UNAVAILABLE_CTX;
}
