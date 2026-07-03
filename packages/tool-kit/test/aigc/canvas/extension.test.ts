import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SurfaceConfig, SurfaceHandle } from "../../../src/surface/create-surface.js";
import {
  makeCanvasSurfaceExtension,
  CANVAS_DOMAIN,
} from "../../../src/aigc/canvas/extension.js";
import {
  emitLivePreview,
  installLivePreviewSink,
} from "../../../src/surface/live-preview-seam.js";
import type { GalleryState } from "../../../src/aigc/canvas/schema.js";

const fakePi = {} as ExtensionAPI;

function spyCreateSurface(): {
  fn: (pi: ExtensionAPI, config: SurfaceConfig<GalleryState>) => SurfaceHandle<GalleryState>;
  configs: SurfaceConfig<GalleryState>[];
} {
  const configs: SurfaceConfig<GalleryState>[] = [];
  const fn = vi.fn((_pi: ExtensionAPI, config: SurfaceConfig<GalleryState>) => {
    configs.push(config);
    return {
      domain: config.domain,
      update: () => undefined,
      dispatch: async () => ({ domain: config.domain, action: "x", ok: true }),
      replay: () => undefined,
    } as SurfaceHandle<GalleryState>;
  });
  return { fn: fn as unknown as typeof fn, configs };
}

describe("canvasSurfaceExtension 装配", () => {
  it("经上游 createSurface 注册 domain=canvas + 命令表挂全 + hydrate 传入", () => {
    const spy = spyCreateSurface();
    const factory = makeCanvasSurfaceExtension({ createSurface: spy.fn as never });
    factory(fakePi);

    expect(spy.configs).toHaveLength(1);
    const cfg = spy.configs[0]!;
    expect(cfg.domain).toBe(CANVAS_DOMAIN);
    expect(cfg.domain).toBe("canvas");
    expect(Object.keys(cfg.commands).sort()).toEqual(
      [
        "delete",
        "edit",
        "inpaint",
        "outpaint",
        "reference",
        "reframe",
        "register",
        "sync",
        "variants",
      ].sort(),
    );
    expect(typeof cfg.hydrate).toBe("function");
    expect(cfg.initialState).toEqual({ assets: [] });
  });

  it("装 live-preview sink:emitLivePreview → handle.update 投影进 livePreview,null 清除", () => {
    // 带 update spy 的 fake handle;记录 reducer 施加到初始 state 的结果。
    const updates: GalleryState[] = [];
    let state: GalleryState = { assets: [] };
    const fn = vi.fn((_pi: ExtensionAPI, config: SurfaceConfig<GalleryState>) => ({
      domain: config.domain,
      update: (reducer: (s: GalleryState) => GalleryState) => {
        state = reducer(state);
        updates.push(state);
      },
      dispatch: async () => ({ domain: config.domain, action: "x", ok: true }),
      replay: () => undefined,
    }) as SurfaceHandle<GalleryState>);

    const factory = makeCanvasSurfaceExtension({ createSurface: fn as never });
    factory(fakePi);

    // sink 刻意只取 stage、丢弃大图 displayUrl(避免 fd1 大帧损坏)。
    emitLivePreview({ displayUrl: "data:image/png;base64,AA", stage: "partial" });
    expect(updates.at(-1)?.livePreview).toEqual({ stage: "partial" });
    emitLivePreview(null);
    expect(updates.at(-1)?.livePreview).toBeNull();

    // 清理全局 seam。
    installLivePreviewSink(() => undefined)();
  });

  it("initialState 不跨实例共享引用", () => {
    const spy = spyCreateSurface();
    const factory = makeCanvasSurfaceExtension({ createSurface: spy.fn as never });
    factory(fakePi);
    factory(fakePi);
    expect(spy.configs).toHaveLength(2);
    expect(spy.configs[0]!.initialState).not.toBe(spy.configs[1]!.initialState);
    expect(spy.configs[0]!.initialState.assets).not.toBe(spy.configs[1]!.initialState.assets);
  });

  it("hydrate 经注入的 attachment seam 枚举重建", async () => {
    const spy = spyCreateSurface();
    const listBySession = vi.fn(async () => [
      {
        id: "att_1",
        name: "n.png",
        mimeType: "image/png",
        size: 1,
        origin: "tool-output" as const,
        sessionId: "s1",
        createdAt: "2026-07-02T10:00:00.000Z",
      },
    ]);
    const attachments = {
      available: true,
      listBySession,
      async resolve() {
        return {
          meta: {
            id: "att_1",
            name: "n.png",
            mimeType: "image/png",
            size: 1,
            origin: "tool-output" as const,
            sessionId: "s1",
            createdAt: "2026-07-02T10:00:00.000Z",
          },
          async bytes() {
            return new Uint8Array();
          },
          async localPath() {
            return "/tmp/x";
          },
          async url() {
            return "signed";
          },
        };
      },
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
    const factory = makeCanvasSurfaceExtension({
      createSurface: spy.fn as never,
      surfaceDeps: { getAttachmentToolContext: () => attachments as never },
    });
    factory(fakePi);
    const rebuilt = await spy.configs[0]!.hydrate!();
    expect(listBySession).toHaveBeenCalled();
    expect(rebuilt.assets[0]?.attachmentId).toBe("att_1");
    expect(rebuilt.assets[0]?.displayUrl).toBe("signed");
  });
});
