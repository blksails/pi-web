/**
 * examples/aigc-agent · 素材域 surface 自检(CONTRACT-11 G2:写命令最小闭环)。
 *
 * 验的是**控制面写通道**:guest 发 `surface.run("materials", …)` → agent 侧
 * `SurfaceCommandHandler` 执行副作用 → 权威快照经宿主状态链回流(单写者 C1-2)。
 * R-0a 只约束数据面(Agent Routes 只读),控制面本就是设计内写路径。
 *
 * 注入 fake seam(getSessionState/getSurfaceRegistry/schedule)驱动 createSurface 全链;
 * 三段断言:① 命令改变权威态 ② 快照可经 `surface:materials` 键读回 ③ 非法参数被拒且快照不动。
 */
import { describe, expect, it } from "vitest";
import { surfaceStateKey } from "@blksails/pi-web-protocol";
import {
  MATERIALS_DOMAIN,
  emptyMaterialsState,
  makeMaterialsSurfaceExtension,
  type MaterialsState,
} from "@/examples/aigc-agent/panes/materials-surface.js";

const KEY = surfaceStateKey(MATERIALS_DOMAIN);

function makeEnv(liveAttachmentIds?: readonly string[]) {
  const store = new Map<string, unknown>();
  const registered: string[] = [];
  const listeners = new Map<string, () => void>();
  const deps = {
    ...(liveAttachmentIds !== undefined
      ? {
          getAttachmentToolContext: () => ({
            available: true,
            listBySession: async () => liveAttachmentIds.map((id) => ({ id })),
          }),
        }
      : {}),
    getSessionState: () => ({
      available: true,
      get: <T,>(k: string): T | undefined => store.get(k) as T | undefined,
      set: (k: string, v: unknown): void => void store.set(k, v),
      delete: (k: string): void => void store.delete(k),
      snapshot: (): Record<string, unknown> => Object.fromEntries(store),
    }),
    getSurfaceRegistry: () => ({
      register: (domain: string): void => void registered.push(domain),
      get: (): undefined => undefined,
    }),
    schedule: (fn: () => void): void => fn(),
  };
  const pi = {
    registerCommand: (): void => {},
    on: (event: string, cb: () => void): void => void listeners.set(event, cb),
  };
  // deps/pi 为最小 fake,形状以 createSurface 实际取用为准(多余成员不取)。
  const handle = makeMaterialsSurfaceExtension(
    deps as unknown as Parameters<typeof makeMaterialsSurfaceExtension>[0],
  )(pi as unknown as Parameters<ReturnType<typeof makeMaterialsSurfaceExtension>>[0]);
  const snap = (): MaterialsState => store.get(KEY) as MaterialsState;
  return { store, registered, listeners, handle, snap };
}

describe("materials surface · 读侧热态(既有)", () => {
  it("装配即推初始快照:选中/过滤/目录/归属四空", () => {
    const { snap, registered } = makeEnv();
    expect(snap()).toEqual(emptyMaterialsState());
    expect(snap().folders).toEqual([]);
    expect(snap().itemFolder).toEqual({});
    expect(registered).toContain(MATERIALS_DOMAIN);
  });

  it("select 整替选中集(去重)", async () => {
    const { handle, snap } = makeEnv();
    const r = await handle.dispatch("select", { ids: ["att_a", "att_b", "att_a"] });
    expect(r.ok).toBe(true);
    expect(snap().selectedIds).toEqual(["att_a", "att_b"]);
  });

  it("select 非法 args → invalid_args 且快照不动", async () => {
    const { handle, store } = makeEnv();
    const r = await handle.dispatch("select", { ids: [1, 2] });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("invalid_args");
    expect(store.get(KEY)).toEqual(emptyMaterialsState());
  });
});

describe("materials surface · 写命令闭环(G2)", () => {
  it("create-folder 落权威态并回目录;父可嵌套", async () => {
    const { handle, snap } = makeEnv();
    const a = await handle.dispatch("create-folder", { name: " 素材 A " });
    expect(a.ok).toBe(true);
    const rootId = (a.data as { folder: { id: string; name: string } }).folder.id;
    // 名字去首尾空白后入快照。
    expect(snap().folders).toEqual([{ id: rootId, name: "素材 A" }]);

    const b = await handle.dispatch("create-folder", { name: "子", parentId: rootId });
    expect(b.ok).toBe(true);
    expect(snap().folders).toHaveLength(2);
    expect(snap().folders[1]?.parentId).toBe(rootId);
  });

  it("create-folder 空名 / 超长名 → invalid_args;父不存在 → not_found", async () => {
    const { handle, store } = makeEnv();
    expect((await handle.dispatch("create-folder", { name: "   " })).error?.code).toBe("invalid_args");
    expect((await handle.dispatch("create-folder", { name: "x".repeat(65) })).error?.code).toBe("invalid_args");
    expect(
      (await handle.dispatch("create-folder", { name: "ok", parentId: "fld_nope" })).error?.code,
    ).toBe("not_found");
    expect(store.get(KEY)).toEqual(emptyMaterialsState());
  });

  it("rename-folder 改名;目标不存在 → not_found", async () => {
    const { handle, snap } = makeEnv();
    const a = await handle.dispatch("create-folder", { name: "旧" });
    const id = (a.data as { folder: { id: string } }).folder.id;
    expect((await handle.dispatch("rename-folder", { id, name: "新" })).ok).toBe(true);
    expect(snap().folders[0]?.name).toBe("新");
    expect((await handle.dispatch("rename-folder", { id: "fld_x", name: "y" })).error?.code).toBe("not_found");
  });

  it("move-folder 防环:不得移入自身或后代", async () => {
    const { handle, snap } = makeEnv();
    const a = await handle.dispatch("create-folder", { name: "A" });
    const aId = (a.data as { folder: { id: string } }).folder.id;
    const b = await handle.dispatch("create-folder", { name: "B", parentId: aId });
    const bId = (b.data as { folder: { id: string } }).folder.id;

    expect((await handle.dispatch("move-folder", { id: aId, parentId: aId })).error?.code).toBe("invalid_args");
    expect((await handle.dispatch("move-folder", { id: aId, parentId: bId })).error?.code).toBe("invalid_args");
    // 合法:B 移到顶层(省略 parentId)。
    expect((await handle.dispatch("move-folder", { id: bId })).ok).toBe(true);
    expect(snap().folders.find((f) => f.id === bId)?.parentId).toBeUndefined();
  });

  it("move-items 归类与移出;目录不存在 → not_found", async () => {
    const { handle, snap } = makeEnv();
    const a = await handle.dispatch("create-folder", { name: "A" });
    const aId = (a.data as { folder: { id: string } }).folder.id;

    expect((await handle.dispatch("move-items", { ids: ["att_1", "att_2", "att_1"], folderId: aId })).ok).toBe(true);
    expect(snap().itemFolder).toEqual({ att_1: aId, att_2: aId });

    // folderId: null = 移出目录(键删除,未分类不占位)。
    await handle.dispatch("move-items", { ids: ["att_1"], folderId: null });
    expect(snap().itemFolder).toEqual({ att_2: aId });

    expect((await handle.dispatch("move-items", { ids: ["att_3"], folderId: "fld_x" })).error?.code).toBe("not_found");
    expect((await handle.dispatch("move-items", { ids: [1] })).error?.code).toBe("invalid_args");
  });

  it("delete-folder 级联删后代并解除其下素材归属(素材本体不动)", async () => {
    const { handle, snap } = makeEnv();
    const a = await handle.dispatch("create-folder", { name: "A" });
    const aId = (a.data as { folder: { id: string } }).folder.id;
    const b = await handle.dispatch("create-folder", { name: "B", parentId: aId });
    const bId = (b.data as { folder: { id: string } }).folder.id;
    const c = await handle.dispatch("create-folder", { name: "C" });
    const cId = (c.data as { folder: { id: string } }).folder.id;

    await handle.dispatch("move-items", { ids: ["att_in_b"], folderId: bId });
    await handle.dispatch("move-items", { ids: ["att_in_c"], folderId: cId });

    const r = await handle.dispatch("delete-folder", { id: aId });
    expect(r.ok).toBe(true);
    expect((r.data as { removed: string[] }).removed.sort()).toEqual([aId, bId].sort());
    // A 与其后代 B 皆去,C 留;att_in_b 归属解除,att_in_c 不受影响。
    expect(snap().folders.map((f) => f.id)).toEqual([cId]);
    expect(snap().itemFolder).toEqual({ att_in_c: cId });
  });

  it("未知命令 → unknown_action", async () => {
    const { handle } = makeEnv();
    const r = await handle.dispatch("nope", {});
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("unknown_action");
  });

  it("rename-item 登记热态覆盖名;空串清除覆盖(回落数据面原名)", async () => {
    const { handle, snap } = makeEnv();
    expect((await handle.dispatch("rename-item", { id: "att_a", name: " 主视觉 " })).ok).toBe(true);
    expect(snap().itemName).toEqual({ att_a: "主视觉" });

    // 空串 = 清除覆盖,该键不留占位。
    expect((await handle.dispatch("rename-item", { id: "att_a", name: "  " })).ok).toBe(true);
    expect(snap().itemName).toEqual({});
  });

  it("rename-item 缺 id / 非串 name / 超长 → invalid_args 且快照不动", async () => {
    const { handle, store } = makeEnv();
    expect((await handle.dispatch("rename-item", { name: "x" })).error?.code).toBe("invalid_args");
    expect((await handle.dispatch("rename-item", { id: "att_a" })).error?.code).toBe("invalid_args");
    expect(
      (await handle.dispatch("rename-item", { id: "att_a", name: "x".repeat(201) })).error?.code,
    ).toBe("invalid_args");
    expect(store.get(KEY)).toEqual(emptyMaterialsState());
  });

  it("agent_end 轮末收敛:剔除已失效的选中 id", async () => {
    const { listeners, handle, snap } = makeEnv(["att_live"]);
    await handle.dispatch("select", { ids: ["att_live", "att_gone"] });
    listeners.get("agent_end")?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(snap().selectedIds).toEqual(["att_live"]);
  });
});
