/**
 * examples/aigc-agent · `session-gallery` route 自检(素材面板双数据源的另一半)。
 *
 * 验三件:① 与 `assets-list` 同构(web 侧零适配并入同一网格)② kind 过滤按 mimeType 前缀
 * ③ seam 未装配 / 快照缺席 → 稳定空结构且**不抛**(画布没起来不该让素材面板报错)。
 *
 * 走的是 `getSessionState()` 的 globalThis seam —— 与 gallery-stats 同一快照键
 * `surface:canvas`,故这里直接铺快照即可驱动 handler,无须起真实会话。
 */
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRouteRequest } from "@blksails/pi-web-agent-kit";
import { sessionGalleryHandler } from "@/examples/aigc-agent/routes/session-gallery.js";

/** state-injection-bridge 的注入点(packages/tool-kit `SESSION_STATE_SEAM_KEY`)。 */
const SEAM = "__piWebSessionState__";

function installSnapshot(snapshot: unknown): void {
  const store = new Map<string, unknown>([["surface:canvas", snapshot]]);
  (globalThis as Record<string, unknown>)[SEAM] = {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => void store.set(k, v),
    delete: (k: string) => void store.delete(k),
    snapshot: () => Object.fromEntries(store),
  };
}

const req = (query: Record<string, string> = {}): AgentRouteRequest =>
  ({ query }) as unknown as AgentRouteRequest;

const asset = (id: string, mimeType: string, name: string) => ({
  attachmentId: id,
  displayUrl: `/api/attachments/${id}`,
  mimeType,
  name,
  createdAt: "2026-01-01T00:00:00.000Z",
  origin: "tool-output" as const,
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[SEAM];
});

describe("session-gallery", () => {
  it("与 assets-list 同构:assetId/attachmentId/displayUrl/createdAt/meta 齐备", () => {
    installSnapshot({ assets: [asset("att_a", "image/png", "海报")] });
    const r = sessionGalleryHandler(req()) as { items: readonly Record<string, unknown>[] };
    expect(r.items).toEqual([
      {
        assetId: "att_a",
        attachmentId: "att_a",
        displayUrl: "/api/attachments/att_a",
        createdAt: "2026-01-01T00:00:00.000Z",
        meta: { name: "海报", mimeType: "image/png", origin: "tool-output" },
      },
    ]);
  });

  it("kind 按 mimeType 前缀过滤;未知 kind 不过滤", () => {
    installSnapshot({
      assets: [asset("att_i", "image/png", "图"), asset("att_v", "video/mp4", "片")],
    });
    const ids = (q: Record<string, string>): string[] =>
      (sessionGalleryHandler(req(q)) as { items: readonly { attachmentId: string }[] }).items.map(
        (a) => a.attachmentId,
      );
    expect(ids({ kind: "image" })).toEqual(["att_i"]);
    expect(ids({ kind: "video" })).toEqual(["att_v"]);
    expect(ids({})).toEqual(["att_i", "att_v"]);
    expect(ids({ kind: "nonsense" })).toEqual(["att_i", "att_v"]);
  });

  it("seam 未装配 / 快照缺席 / assets 非数组 → 空列表 + note,不抛", () => {
    expect(sessionGalleryHandler(req())).toEqual({
      items: [],
      note: "canvas surface not registered",
    });
    installSnapshot(undefined);
    expect(sessionGalleryHandler(req())).toEqual({
      items: [],
      note: "canvas surface not registered",
    });
    installSnapshot({ assets: "nope" });
    expect(sessionGalleryHandler(req())).toEqual({
      items: [],
      note: "canvas surface not registered",
    });
  });
});
