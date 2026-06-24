/**
 * Compile-time type tests for the author-facing attachment tool context
 * (attachment-tool-bridge task 4.1; Req 4.1). Validated by `tsc --noEmit`
 * (the package `typecheck` script): asserts a tool author can reference the
 * `AttachmentToolContext` / `AttachmentToolHandle` types via `@blksails/pi-web-agent-kit`
 * and that the structural contract (available / resolve / putOutput) holds.
 *
 * Type-level only — no runtime test cases. Lives in test/ so it is type-checked.
 */
import type {
  AttachmentToolContext,
  AttachmentToolHandle,
  ToolOutputRef,
} from "../src/index.js";
import type { Attachment } from "@blksails/pi-web-protocol";

// A tool author types the injected context via the agent-kit re-export.
declare const ctx: AttachmentToolContext;

// `available` is a boolean capability flag.
export const available: boolean = ctx.available;

// `resolve(id)` yields a handle carrying the upstream Attachment descriptor.
export async function useResolve(id: string): Promise<Attachment> {
  const handle: AttachmentToolHandle = await ctx.resolve(id);
  const bytes: Uint8Array = await handle.bytes();
  void bytes;
  const path: string = await handle.localPath();
  void path;
  const url: string = await handle.url();
  void url;
  return handle.meta;
}

// `putOutput(...)` takes bytes + metadata (no sessionId — bound by the context)
// and returns a reference (no inline bytes).
export async function usePutOutput(): Promise<ToolOutputRef> {
  return ctx.putOutput({
    bytes: new Uint8Array([1, 2, 3]),
    name: "out.png",
    mimeType: "image/png",
  });
}

// putOutput input must not require sessionId (the context injects it).
// @ts-expect-error — sessionId is not part of the author-supplied putOutput input.
ctx.putOutput({ bytes: new Uint8Array(), name: "x", mimeType: "y", sessionId: "s" });
