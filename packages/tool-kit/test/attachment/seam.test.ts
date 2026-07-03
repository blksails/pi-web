import { describe, it, expect } from "vitest";
import { getAttachmentToolContext, SEAM_KEY } from "../../src/attachment/seam.js";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";

describe("getAttachmentToolContext", () => {
  it("returns UNAVAILABLE_CTX when scope is empty", () => {
    const ctx = getAttachmentToolContext({});
    expect(ctx.available).toBe(false);
  });

  it("resolve throws with diagnostic when unavailable", async () => {
    const ctx = getAttachmentToolContext({});
    await expect(ctx.resolve("att_123")).rejects.toThrow(/unavailable/i);
  });

  it("putOutput throws with diagnostic when unavailable", async () => {
    const ctx = getAttachmentToolContext({});
    await expect(
      ctx.putOutput({ bytes: new Uint8Array(1), name: "x.png", mimeType: "image/png" }),
    ).rejects.toThrow(/unavailable/i);
  });

  it("returns the injected ctx from a custom scope", () => {
    const fakeCtx: AttachmentToolContext = {
      available: true,
      async listBySession() {
        throw new Error("not implemented");
      },
      async getMeta() {
        throw new Error("not implemented");
      },
      async setMeta() {
        throw new Error("not implemented");
      },
      async resolve() {
        throw new Error("not implemented");
      },
      async putOutput() {
        throw new Error("not implemented");
      },
    };
    const scope: Record<string, unknown> = { [SEAM_KEY]: fakeCtx };
    const ctx = getAttachmentToolContext(scope);
    expect(ctx.available).toBe(true);
    expect(ctx).toBe(fakeCtx);
  });

  it("returns UNAVAILABLE_CTX when seam key holds a non-object", () => {
    const scope: Record<string, unknown> = { [SEAM_KEY]: "not-an-object" };
    const ctx = getAttachmentToolContext(scope);
    expect(ctx.available).toBe(false);
  });

  it("returns UNAVAILABLE_CTX when seam key holds object without 'available'", () => {
    const scope: Record<string, unknown> = { [SEAM_KEY]: { foo: "bar" } };
    const ctx = getAttachmentToolContext(scope);
    expect(ctx.available).toBe(false);
  });
});
