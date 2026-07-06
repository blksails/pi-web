/**
 * Canvas 插件车道:extraCommands / extraActions 接缝专测(canvas-plugins-m3 task 2.2 / Req 6.3/6.5)。
 *
 * design「tool-kit · extraCommands/extraActions」:
 *   - CanvasCommandDeps + `extraCommands`;createCanvasCommands 合并 `{...extra, ...builtin}`
 *     语义=**重名内置优先**(builtin 展开在后覆盖 extra 同名键)。
 *   - buildCanvasCapability(deps.extraActions):actions = [...A 档 6 固定序, ...extraActions 去重保序]。
 *   - 装配级:makeCanvasSurfaceExtension deps 带 extraCommands+extraActions → 线上快照
 *     capabilities.actions 含 extra 且 extra 命令经 handle.dispatch 可调。
 */
import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  AttachmentToolContext,
  AttachmentToolHandle,
} from "@blksails/pi-web-agent-kit";
import type { SessionStateAccess } from "../../src/session-state.js";
import { getSurfaceRegistry } from "../../src/surface/surface-registry.js";
import { createCanvasCommands } from "../../src/aigc/canvas/commands.js";
import { buildCanvasCapability } from "../../src/aigc/canvas/capability.js";
import { makeCanvasSurfaceExtension } from "../../src/aigc/canvas/extension.js";
import type {
  SurfaceCommandHandler,
  SurfaceCtx,
} from "../../src/surface/create-surface.js";
import type { GalleryState } from "../../src/aigc/canvas/schema.js";
import type { runImageTool } from "../../src/aigc/run-image-tool.js";

type RunImageTool = typeof runImageTool;

// ── 命令表级 harness(照 canvas-capability-persistence.test.ts 手法)────────────────────
interface CmdHarness {
  ctx: SurfaceCtx<GalleryState>;
  state: () => GalleryState;
}
function makeCmdHarness(seed: GalleryState): CmdHarness {
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
          createdAt: "2026-07-05T08:00:00.000Z",
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

/** 内置 edit 走真实 executeImageEdit,注入 fake runImageTool 产 att_o。 */
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
const NOW = "2026-07-05T12:00:00.000Z";

describe("createCanvasCommands · extraCommands 合并", () => {
  it("extraCommands 并入命令表且经命令表可调", async () => {
    const spy = vi.fn(async () => ({ tag: "style" }));
    const extraCommands: Record<string, SurfaceCommandHandler<GalleryState>> = {
      style_transfer: spy,
    };
    const cmds = createCanvasCommands({ extraCommands });
    // 内置六命令 + register/sync/delete 仍在
    expect(typeof cmds.edit).toBe("function");
    expect(typeof cmds.register).toBe("function");
    // extra 命令进表且可调
    expect(typeof cmds.style_transfer).toBe("function");
    const h = makeCmdHarness({ assets: [] });
    const res = await cmds.style_transfer!({ prompt: "style:x" }, h.ctx);
    expect(res).toEqual({ tag: "style" });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("重名(extra 里放 edit)→ 内置优先(走内置实现,extra 不被调)", async () => {
    const extraEdit = vi.fn(async () => ({ hijacked: true }));
    const cmds = createCanvasCommands({
      runImageTool: okRun(["att_o"]),
      now: () => NOW,
      extraCommands: { edit: extraEdit },
    });
    const h = makeCmdHarness({ assets: [] });
    const res = await cmds.edit!({ image: "att_s", prompt: "p" }, h.ctx);
    // 内置产物形态:prepend 新资产 + 返回 ids;extra 的 hijack 从未发生
    expect(res).toEqual({ ids: ["att_o"] });
    expect(h.state().assets[0]?.attachmentId).toBe("att_o");
    expect(extraEdit).not.toHaveBeenCalled();
  });
});

describe("buildCanvasCapability · extraActions", () => {
  const A_TIER = ["edit", "inpaint", "reference", "variants", "outpaint", "reframe"];

  it("extraActions 并入 A 档之后,A 档六序不变", () => {
    const cap = buildCanvasCapability({
      disabledModels: new Set(),
      extraActions: ["style_transfer"],
    });
    expect(cap.actions).toEqual([...A_TIER, "style_transfer"]);
  });

  it("extraActions 去重保序(与 A 档重名/自重复均剔除)", () => {
    const cap = buildCanvasCapability({
      disabledModels: new Set(),
      extraActions: ["style_transfer", "edit", "style_transfer", "sticker"],
    });
    // "edit" 与 A 档重名剔除;"style_transfer" 仅保留首现;新增按首现序
    expect(cap.actions).toEqual([...A_TIER, "style_transfer", "sticker"]);
  });

  it("无 extraActions 时 actions 恰为 A 档六(向后兼容)", () => {
    const cap = buildCanvasCapability({ disabledModels: new Set() });
    expect(cap.actions).toEqual(A_TIER);
  });
});

// ── 装配级:线上快照 capabilities.actions 含 extra + extra 命令经 handle.dispatch 可调 ────
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
function makeFakePi(): ExtensionAPI {
  return {
    registerCommand: vi.fn(),
    on: vi.fn(),
  } as unknown as ExtensionAPI;
}
function emptyAtt(): AttachmentToolContext {
  return {
    available: true,
    listBySession: vi.fn(async () => []),
    resolve: vi.fn(async (id: string) => ({
      meta: {
        id,
        name: `${id}.png`,
        mimeType: "image/png",
        size: 1,
        origin: "upload" as const,
        sessionId: "s1",
        createdAt: "2026-07-05T08:00:00.000Z",
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
    })),
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

describe("makeCanvasSurfaceExtension · extraCommands + extraActions 装配", () => {
  it("线上快照 capabilities.actions 含 extra 且 extra 命令经 handle.dispatch 可调", async () => {
    const rec = makeStateRecorder();
    const scope: Record<string, unknown> = {};
    const styleSpy = vi.fn(async () => ({ ok: true, tag: "style" }));
    const handle = makeCanvasSurfaceExtension({
      // 不注入 capability → 走 buildCanvasCapability({ extraActions }),验证真实并入
      extraActions: ["style_transfer"],
      commandDeps: { extraCommands: { style_transfer: styleSpy } },
      surfaceDeps: {
        scope,
        getSessionState: () => rec.access,
        getSurfaceRegistry: (s) => getSurfaceRegistry(s ?? scope),
        getAttachmentToolContext: () => emptyAtt(),
        schedule: (fn) => fn(),
      },
    })(makeFakePi());

    await vi.waitFor(() => {
      expect(lastCanvasSnapshot(rec)?.capabilities).toBeDefined();
    });
    const snap = lastCanvasSnapshot(rec)!;
    // A 档六 + extra 并入
    expect(snap.capabilities?.actions).toContain("style_transfer");
    expect(snap.capabilities?.actions.slice(0, 6)).toEqual([
      "edit",
      "inpaint",
      "reference",
      "variants",
      "outpaint",
      "reframe",
    ]);

    // extra 命令经 handle.dispatch 派发到注入的处理器
    const result = await handle.dispatch("style_transfer", { prompt: "style:x" });
    expect(result.ok).toBe(true);
    expect(styleSpy).toHaveBeenCalledOnce();
  });
});
