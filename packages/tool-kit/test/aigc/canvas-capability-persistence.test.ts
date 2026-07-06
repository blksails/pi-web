/**
 * Canvas 能力清单快照写点保留专测(canvas-actions-m2 task 2.2 / Req 4.1/4.7)。
 *
 * design「快照写点保留清单」列六处必须保留 capabilities(livePreview 刻意丢弃语义不变):
 *   ①extension 初始/hydrate 快照 ②hydrate 重建 ③agent_end 全量重建 ④sync 全量重建
 *   ⑤各命令成功 reducer(edit 类 / variants 汇总)⑥register / delete reducer。
 * 另测 livePreview 更新(installLivePreviewSink 路径)后 capabilities 仍在,及命令 deps.capability
 * 注入接缝(冷快照缺失时兜底填充)。每写点漏保留即前端能力清单被清空退回硬编码(退化)。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  AttachmentToolContext,
  AttachmentToolHandle,
} from "@blksails/pi-web-agent-kit";
import type { SessionStateAccess } from "../../src/session-state.js";
import { getSurfaceRegistry } from "../../src/surface/surface-registry.js";
import { makeCanvasSurfaceExtension } from "../../src/aigc/canvas/extension.js";
import { createCanvasCommands } from "../../src/aigc/canvas/commands.js";
import {
  emitLivePreview,
  installLivePreviewSink,
} from "../../src/surface/live-preview-seam.js";
import type { SurfaceCtx } from "../../src/surface/create-surface.js";
import type {
  CanvasCapability,
  GalleryState,
} from "../../src/aigc/canvas/schema.js";
import type { runImageTool } from "../../src/aigc/run-image-tool.js";

type RunImageTool = typeof runImageTool;

/** 确定性注入的能力清单(避免依赖真实 buildCanvasCapability 推导,断言深相等)。 */
const FAKE_CAP: CanvasCapability = {
  models: [{ id: "m1", label: "M1", sizes: ["1024x1024"] }],
  sizes: [{ label: "1:1", size: "1024x1024" }],
  actions: ["edit"],
};

// ── 观测线上快照:注入 getSessionState 录制器 ──────────────────────────────────────
interface StateRecorder {
  access: SessionStateAccess;
  sets: Array<{ key: string; value: unknown }>;
}
function makeStateRecorder(): StateRecorder {
  const sets: Array<{ key: string; value: unknown }> = [];
  const store = new Map<string, unknown>();
  const access: SessionStateAccess = {
    available: true,
    get: <T,>(key: string) => store.get(key) as T | undefined,
    set: (key, value) => {
      store.set(key, value);
      sets.push({ key, value });
    },
    delete: (key) => {
      store.delete(key);
    },
    snapshot: () => Object.fromEntries(store),
  };
  return { access, sets };
}
function lastCanvasSnapshot(rec: StateRecorder): GalleryState | undefined {
  for (let i = rec.sets.length - 1; i >= 0; i -= 1) {
    if (rec.sets[i]!.key === "surface:canvas") return rec.sets[i]!.value as GalleryState;
  }
  return undefined;
}

function makeFakePi(): { pi: ExtensionAPI; handlers: Map<string, (ev?: unknown) => void> } {
  const handlers = new Map<string, (ev?: unknown) => void>();
  const pi = {
    registerCommand: vi.fn(),
    on: vi.fn((event: string, handler: (ev?: unknown) => void) => {
      handlers.set(event, handler);
    }),
  } as unknown as ExtensionAPI;
  return { pi, handlers };
}

const IMAGE_DESC = {
  id: "att_1",
  name: "n.png",
  mimeType: "image/png",
  size: 1,
  origin: "tool-output" as const,
  sessionId: "s1",
  createdAt: "2026-07-05T10:00:00.000Z",
};

/** available attachment 上下文:枚举一张图 + resolve 出签名 URL(供 hydrate / agent_end / sync 重建)。 */
function availableAtt(): AttachmentToolContext {
  return {
    available: true,
    listBySession: vi.fn(async () => [IMAGE_DESC]),
    resolve: vi.fn(
      async (id: string): Promise<AttachmentToolHandle> => ({
        meta: { ...IMAGE_DESC, id },
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
    ),
    async putOutput() {
      throw new Error("no");
    },
    async getMeta() {
      return undefined;
    },
    async setMeta() {
      return undefined;
    },
  };
}

/** 装配 real createSurface 的 canvas 扩展 + 注入 seam;返回录制器与 agent_end 触发器。 */
function mountExtension(): {
  rec: StateRecorder;
  handlers: Map<string, (ev?: unknown) => void>;
} {
  const rec = makeStateRecorder();
  const scope: Record<string, unknown> = {};
  const { pi, handlers } = makeFakePi();
  const att = availableAtt();
  makeCanvasSurfaceExtension({
    capability: FAKE_CAP,
    surfaceDeps: {
      scope,
      getSessionState: () => rec.access,
      getSurfaceRegistry: (s) => getSurfaceRegistry(s ?? scope),
      getAttachmentToolContext: () => att,
      schedule: (fn) => fn(),
    },
  })(pi);
  return { rec, handlers };
}

afterEach(() => {
  // 清全局 live-preview seam(工厂在装配内装过 sink;避免跨用例串扰)。
  installLivePreviewSink(() => undefined)();
});

describe("canvas capability 快照写点保留", () => {
  it("写点①②:初始/hydrate 快照携带 capabilities 且经 hydrate 重建带资产", async () => {
    const { rec } = mountExtension();
    await vi.waitFor(() => {
      expect(lastCanvasSnapshot(rec)?.assets[0]?.attachmentId).toBe("att_1");
    });
    const snap = lastCanvasSnapshot(rec)!;
    expect(snap.capabilities).toEqual(FAKE_CAP);
  });

  it("写点③:agent_end 全量重建后 capabilities 仍在且 livePreview 叠层被清", async () => {
    const { rec, handlers } = mountExtension();
    // 先等装配首帧就绪(current 已带 capabilities),再压入一层 livePreview。
    await vi.waitFor(() => {
      expect(lastCanvasSnapshot(rec)?.capabilities).toEqual(FAKE_CAP);
    });
    emitLivePreview({ displayUrl: "data:image/png;base64,AA", stage: "partial" });
    expect(lastCanvasSnapshot(rec)?.livePreview).toEqual({ stage: "partial" });

    handlers.get("agent_end")!();
    // 等 agent_end 异步重建落地(整替语义 → livePreview 叠层被清)。
    await vi.waitFor(() => {
      expect(lastCanvasSnapshot(rec)?.livePreview ?? null).toBeNull();
    });
    const snap = lastCanvasSnapshot(rec)!;
    expect(snap.assets[0]?.attachmentId).toBe("att_1");
    expect(snap.capabilities).toEqual(FAKE_CAP);
  });

  it("livePreview 更新(sink 路径)后 capabilities 仍在", async () => {
    const { rec } = mountExtension();
    await vi.waitFor(() => {
      expect(lastCanvasSnapshot(rec)?.capabilities).toEqual(FAKE_CAP);
    });
    emitLivePreview({ displayUrl: "data:image/png;base64,AA", stage: "partial" });
    const snap = lastCanvasSnapshot(rec)!;
    expect(snap.livePreview).toEqual({ stage: "partial" });
    expect(snap.capabilities).toEqual(FAKE_CAP);
  });
});

// ── 命令 reducer 写点(SurfaceCtx harness;初值播种 capabilities,验证继承保留)────────
interface CmdHarness {
  ctx: SurfaceCtx<GalleryState>;
  state: () => GalleryState;
}
function makeCmdHarness(
  seed: GalleryState,
  over?: Partial<AttachmentToolContext>,
): CmdHarness {
  let current: GalleryState = seed;
  const attachments: AttachmentToolContext = {
    available: true,
    resolve: vi.fn(
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
    ),
    listBySession: vi.fn(async () => []),
    setMeta: vi.fn(async () => undefined),
    async putOutput() {
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
  return { ctx, state: () => current };
}

function okRun(ids: string[]): RunImageTool {
  return (async () => ({
    content: [{ type: "text", text: "ok" }],
    details: {
      ok: true,
      model: "m1",
      assets: ids.map((id) => ({
        attachmentId: id,
        displayUrl: `signed-${id}`,
        mimeType: "image/png",
        name: `${id}.png`,
      })),
    },
  })) as unknown as RunImageTool;
}
const NOW = "2026-07-02T12:00:00.000Z";

describe("canvas capability 命令 reducer 保留", () => {
  it("写点⑤:edit 成功后 capabilities 从 s 继承保留", async () => {
    const h = makeCmdHarness({ assets: [], capabilities: FAKE_CAP });
    const cmds = createCanvasCommands({ runImageTool: okRun(["att_o"]), now: () => NOW });
    await cmds.edit!({ image: "att_s", prompt: "p" }, h.ctx);
    expect(h.state().assets[0]?.attachmentId).toBe("att_o");
    expect(h.state().capabilities).toEqual(FAKE_CAP);
  });

  it("写点⑤:variants 多模型汇总后 capabilities 仍在", async () => {
    const h = makeCmdHarness({ assets: [], capabilities: FAKE_CAP });
    let n = 0;
    const runImage = (async () => {
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
    }) as unknown as RunImageTool;
    const cmds = createCanvasCommands({ runImageTool: runImage, now: () => NOW });
    await cmds.variants!(
      { image: "att_s", prompt: "p", n: 1, models: ["m1", "m2"] },
      h.ctx,
    );
    expect(h.state().assets.map((a) => a.attachmentId)).toEqual(["att_v2", "att_v1"]);
    expect(h.state().capabilities).toEqual(FAKE_CAP);
  });

  it("写点⑥:register 后 capabilities 仍在", async () => {
    const h = makeCmdHarness({ assets: [], capabilities: FAKE_CAP });
    const cmds = createCanvasCommands();
    await cmds.register!({ attachmentId: "att_client" }, h.ctx);
    expect(h.state().assets[0]?.attachmentId).toBe("att_client");
    expect(h.state().capabilities).toEqual(FAKE_CAP);
  });

  it("写点⑥:delete 后 capabilities 仍在", async () => {
    const h = makeCmdHarness({
      assets: [
        {
          attachmentId: "att_a",
          displayUrl: "u",
          mimeType: "image/png",
          name: "a",
          createdAt: NOW,
          origin: "tool-output",
        },
      ],
      capabilities: FAKE_CAP,
    });
    const cmds = createCanvasCommands();
    await cmds.delete!({ attachmentId: "att_a" }, h.ctx);
    expect(h.state().assets).toEqual([]);
    expect(h.state().capabilities).toEqual(FAKE_CAP);
  });

  it("写点④:sync 全量重建后 capabilities 从 s 继承(不二次生成)", async () => {
    const h = makeCmdHarness(
      { assets: [], capabilities: FAKE_CAP },
      {
        listBySession: vi.fn(async () => [IMAGE_DESC]) as unknown as AttachmentToolContext["listBySession"],
      },
    );
    const cmds = createCanvasCommands();
    const res = await cmds.sync!({}, h.ctx);
    expect(res).toEqual({ count: 1 });
    expect(h.state().assets[0]?.attachmentId).toBe("att_1");
    expect(h.state().capabilities).toEqual(FAKE_CAP);
  });

  it("注入接缝:冷快照缺 capabilities 时经 deps.capability 兜底填充", async () => {
    const h = makeCmdHarness({ assets: [] }); // 无 capabilities
    const cmds = createCanvasCommands({
      runImageTool: okRun(["att_o"]),
      now: () => NOW,
      capability: FAKE_CAP,
    });
    await cmds.edit!({ image: "att_s", prompt: "p" }, h.ctx);
    expect(h.state().capabilities).toEqual(FAKE_CAP);
  });
});
