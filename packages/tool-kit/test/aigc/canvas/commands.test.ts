import { describe, it, expect, vi } from "vitest";
import type { AttachmentToolContext, AttachmentToolHandle } from "@blksails/pi-web-agent-kit";
import type { SurfaceCtx } from "../../../src/surface/create-surface.js";
import { createCanvasCommands } from "../../../src/aigc/canvas/commands.js";
import type { GalleryState } from "../../../src/aigc/canvas/schema.js";
import type { runImageTool } from "../../../src/aigc/run-image-tool.js";

type RunImageTool = typeof runImageTool;

interface Harness {
  ctx: SurfaceCtx<GalleryState>;
  state: () => GalleryState;
  setMeta: ReturnType<typeof vi.fn>;
  resolve: ReturnType<typeof vi.fn>;
  listBySession: ReturnType<typeof vi.fn>;
}

function makeHarness(over?: Partial<AttachmentToolContext>): Harness {
  let current: GalleryState = { assets: [] };
  const setMeta = vi.fn(async () => undefined);
  const resolve = vi.fn(
    async (id: string): Promise<AttachmentToolHandle> => ({
      meta: {
        id,
        name: `${id}.png`,
        mimeType: "image/png",
        size: 1,
        origin: "upload",
        sessionId: "s1",
        createdAt: "2026-07-02T08:00:00.000Z",
      },
      async bytes() {
        return new Uint8Array();
      },
      async localPath() {
        return "/tmp/x";
      },
      async url() {
        return `signed-${id}`;
      },
    }),
  );
  const listBySession = vi.fn(async () => []);
  const attachments: AttachmentToolContext = {
    available: true,
    resolve,
    listBySession,
    setMeta,
    async putOutput() {
      throw new Error("nope");
    },
    async publish() {
      throw new Error("nope");
    },
    async getMeta() {
      return undefined;
    },
    ...over,
  };
  const ctx: SurfaceCtx<GalleryState> = {
    get: () => current,
    setState: (reducer) => {
      current = reducer(current);
    },
    attachments,
  };
  return { ctx, state: () => current, setMeta, resolve, listBySession };
}

/** 成功返回 assets 的 fake runImageTool。 */
function okRun(assets: { attachmentId: string }[]): RunImageTool {
  return (async () => ({
    content: [{ type: "text", text: "ok" }],
    details: {
      ok: true,
      model: "gpt-image-2",
      assets: assets.map((a) => ({
        attachmentId: a.attachmentId,
        displayUrl: `signed-${a.attachmentId}`,
        mimeType: "image/png",
        name: `${a.attachmentId}.png`,
      })),
    },
  })) as unknown as RunImageTool;
}

const failRun: RunImageTool = (async () => ({
  content: [{ type: "text", text: "fail" }],
  details: { ok: false, error: "provider exploded" },
})) as unknown as RunImageTool;

const NOW = "2026-07-02T12:00:00.000Z";

describe("canvas commands", () => {
  it("edit 成功 → setState 含 derivedFrom 新资产 + setMeta 被调 + 返回 ids", async () => {
    const h = makeHarness();
    const runImage = okRun([{ attachmentId: "att_out" }]);
    const cmds = createCanvasCommands({ runImageTool: runImage, now: () => NOW });

    const res = await cmds.edit!({ image: "att_src", prompt: "make it blue" }, h.ctx);

    expect(res).toEqual({ ids: ["att_out"] });
    const asset = h.state().assets[0];
    expect(asset?.attachmentId).toBe("att_out");
    expect(asset?.derivedFrom).toBe("att_src");
    expect(asset?.origin).toBe("tool-output");
    expect(asset?.createdAt).toBe(NOW);
    expect(h.setMeta).toHaveBeenCalledWith(
      "att_out",
      expect.objectContaining({ derivedFrom: "att_src" }),
    );
  });

  it("edit details.ok=false → ok:false + edit_failed(不留半态)", async () => {
    const h = makeHarness();
    const cmds = createCanvasCommands({ runImageTool: failRun, now: () => NOW });
    const res = await cmds.edit!({ image: "att_src", prompt: "x" }, h.ctx);
    expect(res).toEqual({ ok: false, error: { code: "edit_failed", message: "provider exploded" } });
    expect(h.state().assets).toEqual([]);
    expect(h.setMeta).not.toHaveBeenCalled();
  });

  it("invalid args → invalid_args,不调 runImageTool", async () => {
    const h = makeHarness();
    const runImage = vi.fn(okRun([{ attachmentId: "att_out" }]));
    const cmds = createCanvasCommands({ runImageTool: runImage, now: () => NOW });
    const res = await cmds.edit!({ prompt: "no image" }, h.ctx);
    expect((res as { ok: boolean }).ok).toBe(false);
    expect((res as { error: { code: string } }).error.code).toBe("invalid_args");
    expect(runImage).not.toHaveBeenCalled();
  });

  it("inpaint 传 mask 给 runImageTool", async () => {
    const h = makeHarness();
    const runImage = vi.fn(okRun([{ attachmentId: "att_o" }]));
    const cmds = createCanvasCommands({ runImageTool: runImage, now: () => NOW });
    await cmds.inpaint!({ image: "att_s", prompt: "p", mask: "att_m" }, h.ctx);
    const params = runImage.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params.mask).toBe("att_m");
    expect(params.image).toBe("att_s");
    // ext=undefined + requiredParams:[] 安全约束。
    expect(runImage.mock.calls[0]?.[1]).toBeUndefined();
    const opts = runImage.mock.calls[0]?.[4] as { requiredParams: readonly unknown[]; toolName: string };
    expect(opts.requiredParams).toEqual([]);
    expect(opts.toolName).toBe("image_edit");
  });

  it("variants 多模型 → 逐一执行汇总 ids", async () => {
    const h = makeHarness();
    let n = 0;
    const runImage = vi.fn((async () => {
      n += 1;
      return {
        content: [],
        details: {
          ok: true,
          model: "m",
          assets: [
            { attachmentId: `att_v${n}`, displayUrl: "u", mimeType: "image/png", name: "v" },
          ],
        },
      };
    }) as unknown as RunImageTool);
    const cmds = createCanvasCommands({ runImageTool: runImage, now: () => NOW });
    const res = await cmds.variants!(
      { image: "att_s", prompt: "p", n: 1, models: ["gpt-image-2", "qwen-image-edit-max"] },
      h.ctx,
    );
    expect(res).toEqual({ ids: ["att_v1", "att_v2"] });
    expect(runImage).toHaveBeenCalledTimes(2);
    expect(h.state().assets.map((a) => a.attachmentId)).toEqual(["att_v2", "att_v1"]);
  });

  it("register(B 档):resolve 校验 + setMeta + setState,不调 runImageTool", async () => {
    const h = makeHarness();
    const runImage = vi.fn(okRun([]));
    const cmds = createCanvasCommands({ runImageTool: runImage, now: () => NOW });
    const res = await cmds.register!(
      { attachmentId: "att_client", derivedFrom: "att_src", genParams: { crop: true } },
      h.ctx,
    );
    expect(res).toEqual({ ids: ["att_client"] });
    expect(runImage).not.toHaveBeenCalled();
    expect(h.resolve).toHaveBeenCalledWith("att_client");
    expect(h.setMeta).toHaveBeenCalledWith(
      "att_client",
      expect.objectContaining({ derivedFrom: "att_src" }),
    );
    const asset = h.state().assets[0];
    expect(asset?.attachmentId).toBe("att_client");
    expect(asset?.displayUrl).toBe("signed-att_client");
    expect(asset?.derivedFrom).toBe("att_src");
  });

  it("register:resolve 抛(越权) → dispatch 侧结算(此处直接抛,createSurface 归一化)", async () => {
    const h = makeHarness({
      async resolve() {
        throw new Error("not owner");
      },
    });
    const cmds = createCanvasCommands();
    await expect(cmds.register!({ attachmentId: "att_x" }, h.ctx)).rejects.toThrow("not owner");
    expect(h.state().assets).toEqual([]);
  });

  it("sync 调 hydrate 枚举重建", async () => {
    const h = makeHarness({
      listBySession: vi.fn(async () => [
        {
          id: "att_hy",
          name: "hy.png",
          mimeType: "image/png",
          size: 1,
          origin: "tool-output",
          sessionId: "s1",
          createdAt: "2026-07-02T09:00:00.000Z",
        },
      ]) as unknown as AttachmentToolContext["listBySession"],
      async getMeta() {
        return undefined;
      },
    });
    const cmds = createCanvasCommands();
    const res = await cmds.sync!({}, h.ctx);
    expect(res).toEqual({ count: 1 });
    expect(h.state().assets[0]?.attachmentId).toBe("att_hy");
  });

  it("delete filter 移除指定资产", async () => {
    const h = makeHarness();
    // 先放两张。
    h.ctx.setState(() => ({
      assets: [
        {
          attachmentId: "att_a",
          displayUrl: "u",
          mimeType: "image/png",
          name: "a",
          createdAt: NOW,
          origin: "tool-output",
        },
        {
          attachmentId: "att_b",
          displayUrl: "u",
          mimeType: "image/png",
          name: "b",
          createdAt: NOW,
          origin: "tool-output",
        },
      ],
    }));
    const cmds = createCanvasCommands();
    const res = await cmds.delete!({ attachmentId: "att_a" }, h.ctx);
    expect(res).toEqual({ deleted: "att_a" });
    expect(h.state().assets.map((a) => a.attachmentId)).toEqual(["att_b"]);
  });

  it("无二进制进 args / 快照(资产无 data/base64 字段)", async () => {
    const h = makeHarness();
    const cmds = createCanvasCommands({ runImageTool: okRun([{ attachmentId: "att_o" }]), now: () => NOW });
    await cmds.edit!({ image: "att_s", prompt: "p" }, h.ctx);
    const asset = h.state().assets[0] as Record<string, unknown>;
    expect("data" in asset).toBe(false);
    expect("base64" in asset).toBe(false);
  });
});
