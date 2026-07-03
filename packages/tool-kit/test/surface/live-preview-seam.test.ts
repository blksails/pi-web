/**
 * live-preview-seam 单元测试:install/emit/uninstall + 无 sink no-op。
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  installLivePreviewSink,
  emitLivePreview,
  type LivePreviewFrame,
} from "../../src/surface/live-preview-seam.js";

afterEach(() => {
  // 清理全局 seam(卸载任何残留 sink)。
  const un = installLivePreviewSink(() => undefined);
  un();
});

describe("live-preview-seam", () => {
  it("装 sink 后 emit 转发帧(含 null 清除)", () => {
    const seen: (LivePreviewFrame | null)[] = [];
    installLivePreviewSink((f) => seen.push(f));
    emitLivePreview({ displayUrl: "data:image/png;base64,AA", stage: "partial" });
    emitLivePreview({ displayUrl: "data:image/png;base64,BB", stage: "finalizing" });
    emitLivePreview(null);
    expect(seen).toEqual([
      { displayUrl: "data:image/png;base64,AA", stage: "partial" },
      { displayUrl: "data:image/png;base64,BB", stage: "finalizing" },
      null,
    ]);
  });

  it("无 sink → emit 为 no-op(不抛)", () => {
    const un = installLivePreviewSink(() => undefined);
    un(); // 卸载
    expect(() => emitLivePreview({ displayUrl: "x", stage: "partial" })).not.toThrow();
  });

  it("后装 sink 覆盖前者(单一活跃预览目标)", () => {
    const a: unknown[] = [];
    const b: unknown[] = [];
    installLivePreviewSink((f) => a.push(f));
    installLivePreviewSink((f) => b.push(f));
    emitLivePreview({ displayUrl: "x", stage: "partial" });
    expect(a).toHaveLength(0);
    expect(b).toHaveLength(1);
  });

  it("uninstall 只在仍是自己时移除(不误删后装者)", () => {
    const a: unknown[] = [];
    const unA = installLivePreviewSink((f) => a.push(f));
    const b: unknown[] = [];
    installLivePreviewSink((f) => b.push(f));
    unA(); // a 已被 b 覆盖,unA 不应移除 b
    emitLivePreview(null);
    expect(b).toHaveLength(1);
  });
});
