import { describe, it, expect, vi } from "vitest";
import { persistPicked, resolveInputToDataUri } from "../../src/attachment/persist.js";
import type { AttachmentToolContext, AttachmentToolHandle, ToolOutputRef } from "@blksails/agent-kit";
import type { PickedResult } from "../../src/engine/types.js";

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeImageResponse(mimeType = "image/png"): Response {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
  return new Response(bytes, {
    status: 200,
    headers: { "content-type": mimeType },
  });
}

function makeCtx(): {
  ctx: AttachmentToolContext;
  putOutputCalls: Array<{ bytes: Uint8Array; name: string; mimeType: string }>;
} {
  const putOutputCalls: Array<{ bytes: Uint8Array; name: string; mimeType: string }> = [];
  let seq = 0;

  const ctx: AttachmentToolContext = {
    available: true,
    async resolve(id: string): Promise<AttachmentToolHandle> {
      return {
        meta: {
          id,
          name: "input.png",
          mimeType: "image/png",
          size: 4,
          origin: "upload",
          sessionId: "s1",
          createdAt: new Date().toISOString(),
        },
        async bytes() {
          return new Uint8Array([0x01, 0x02, 0x03, 0x04]);
        },
        async localPath() { return "/tmp/input.png"; },
        async url() { return "http://localhost/att/input.png"; },
      };
    },
    async putOutput(input): Promise<ToolOutputRef> {
      putOutputCalls.push({ bytes: input.bytes, name: input.name, mimeType: input.mimeType });
      seq++;
      return {
        attachmentId: `att_test_${seq}`,
        displayUrl: `http://localhost/att/test_${seq}`,
        name: input.name,
        mimeType: input.mimeType,
      };
    },
  };

  return { ctx, putOutputCalls };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("persistPicked — image-set", () => {
  it("calls putOutput once per url and returns PersistedAsset for each", async () => {
    const { ctx, putOutputCalls } = makeCtx();

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse("image/png"))
      .mockResolvedValueOnce(makeImageResponse("image/jpeg"));

    const picked: PickedResult = {
      kind: "image-set",
      urls: ["https://cdn.example.com/a.png", "https://cdn.example.com/b.jpg"],
    };

    const assets = await persistPicked(picked, ctx, { fetchImpl });

    expect(putOutputCalls).toHaveLength(2);
    expect(assets).toHaveLength(2);

    expect(assets[0]?.attachmentId).toBe("att_test_1");
    expect(assets[0]?.mimeType).toBe("image/png");
    expect(assets[0]?.name).toBe("aigc-0.png");

    expect(assets[1]?.attachmentId).toBe("att_test_2");
    expect(assets[1]?.mimeType).toBe("image/jpeg");
    expect(assets[1]?.name).toBe("aigc-1.jpg");
  });

  it("uses custom namePrefix", async () => {
    const { ctx } = makeCtx();
    const fetchImpl = vi.fn().mockResolvedValue(makeImageResponse());

    const picked: PickedResult = { kind: "image", url: "https://cdn.example.com/x.png" };
    const assets = await persistPicked(picked, ctx, { fetchImpl, namePrefix: "gen" });

    expect(assets[0]?.name).toBe("gen-0.png");
  });

  it("returns empty array for non-image kinds", async () => {
    const { ctx } = makeCtx();
    const picked: PickedResult = { kind: "text", text: "hello" };
    const assets = await persistPicked(picked, ctx);
    expect(assets).toEqual([]);
  });

  it("throws immediately if putOutput fails (no partial refs)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeImageResponse())
      .mockResolvedValueOnce(makeImageResponse());

    let callCount = 0;
    const ctx: AttachmentToolContext = {
      available: true,
      async resolve() {
        throw new Error("not used");
      },
      async putOutput() {
        callCount++;
        if (callCount >= 1) throw new Error("store failure");
        return { attachmentId: "att_x", displayUrl: "u", name: "n", mimeType: "image/png" };
      },
    };

    const picked: PickedResult = {
      kind: "image-set",
      urls: ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"],
    };

    await expect(persistPicked(picked, ctx, { fetchImpl })).rejects.toThrow("store failure");
  });
});

describe("resolveInputToDataUri", () => {
  it("returns a valid data URI with correct mime type", async () => {
    const { ctx } = makeCtx();
    const dataUri = await resolveInputToDataUri("att_input_1", ctx);

    expect(dataUri).toMatch(/^data:image\/png;base64,/);

    // Verify the base64 payload is decodable and matches the mock bytes.
    const b64Part = dataUri.split(",")[1] ?? "";
    const decoded = Buffer.from(b64Part, "base64");
    expect(Array.from(decoded)).toEqual([0x01, 0x02, 0x03, 0x04]);
  });
});
