import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import {
  createSurface,
  SurfaceCommandError,
  type CreateSurfaceDeps,
} from "../../src/surface/create-surface.js";
import type { SessionStateAccess } from "../../src/session-state.js";
import { getSurfaceRegistry } from "../../src/surface/surface-registry.js";

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

const UNAVAILABLE_ATT: AttachmentToolContext = {
  available: false,
  async resolve() {
    throw new Error("unavailable");
  },
  async putOutput() {
    throw new Error("unavailable");
  },
  async publish() {
    throw new Error("unavailable");
  },
  async listBySession() {
    throw new Error("unavailable");
  },
  async getMeta() {
    throw new Error("unavailable");
  },
  async setMeta() {
    throw new Error("unavailable");
  },
};

function makeDeps(
  scope: Record<string, unknown>,
  state: SessionStateAccess,
): CreateSurfaceDeps & { registerCommand: ReturnType<typeof vi.fn> } {
  const registerCommand = vi.fn();
  return {
    scope,
    getSessionState: () => state,
    getSurfaceRegistry: (s) => getSurfaceRegistry(s ?? scope),
    getAttachmentToolContext: () => UNAVAILABLE_ATT,
    schedule: (fn) => fn(),
    registerCommand,
  };
}

function fakePi(registerCommand: ReturnType<typeof vi.fn>): ExtensionAPI {
  return { registerCommand } as unknown as ExtensionAPI;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("createSurface", () => {
  it("update → getSessionState().set('surface:<domain>', snapshot)", () => {
    const scope: Record<string, unknown> = {};
    const rec = makeStateRecorder();
    const deps = makeDeps(scope, rec.access);
    const handle = createSurface(
      fakePi(deps.registerCommand),
      { domain: "demo", initialState: { count: 0 }, commands: {} },
      deps,
    );
    handle.update((s) => ({ count: s.count + 1 }));
    const last = rec.sets.at(-1)!;
    expect(last.key).toBe("surface:demo");
    expect(last.value).toEqual({ count: 1 });
  });

  it("探针经 pi.registerCommand('surface:<domain>') 注册", () => {
    const scope: Record<string, unknown> = {};
    const rec = makeStateRecorder();
    const deps = makeDeps(scope, rec.access);
    createSurface(
      fakePi(deps.registerCommand),
      { domain: "demo", initialState: { count: 0 }, commands: {} },
      deps,
    );
    expect(deps.registerCommand).toHaveBeenCalledTimes(1);
    expect(deps.registerCommand.mock.calls[0]?.[0]).toBe("surface:demo");
  });

  it("initialState 不跨 surface 共享引用", () => {
    const scopeA: Record<string, unknown> = {};
    const scopeB: Record<string, unknown> = {};
    const recA = makeStateRecorder();
    const recB = makeStateRecorder();
    const depsA = makeDeps(scopeA, recA.access);
    const depsB = makeDeps(scopeB, recB.access);
    // 两个 surface 各自构造 initialState(下沉到调用点),互不影响。
    const a = createSurface(
      fakePi(depsA.registerCommand),
      { domain: "a", initialState: { items: [] as number[] }, commands: {} },
      depsA,
    );
    const b = createSurface(
      fakePi(depsB.registerCommand),
      { domain: "b", initialState: { items: [] as number[] }, commands: {} },
      depsB,
    );
    a.update((s) => ({ items: [...s.items, 1] }));
    expect((recA.sets.at(-1)?.value as { items: number[] }).items).toEqual([1]);
    // b 的快照未被 a 的变更污染
    b.update((s) => ({ items: [...s.items, 9] }));
    expect((recB.sets.at(-1)?.value as { items: number[] }).items).toEqual([9]);
  });

  it("dispatch 归一化:普通返回值 → {ok:true,data}", async () => {
    const scope: Record<string, unknown> = {};
    const rec = makeStateRecorder();
    const deps = makeDeps(scope, rec.access);
    const handle = createSurface(
      fakePi(deps.registerCommand),
      {
        domain: "demo",
        initialState: { count: 0 },
        commands: {
          increment: (_args, ctx) => {
            ctx.setState((s) => ({ count: s.count + 1 }));
            return { count: ctx.get().count };
          },
        },
      },
      deps,
    );
    const res = await handle.dispatch("increment", undefined);
    expect(res).toEqual({ domain: "demo", action: "increment", ok: true, data: { count: 1 } });
    // 命令内 ctx.setState 推了快照
    expect(rec.sets.at(-1)).toEqual({ key: "surface:demo", value: { count: 1 } });
  });

  it("dispatch 归一化:未知 action → {ok:false, unknown_action}", async () => {
    const scope: Record<string, unknown> = {};
    const rec = makeStateRecorder();
    const deps = makeDeps(scope, rec.access);
    const handle = createSurface(
      fakePi(deps.registerCommand),
      { domain: "demo", initialState: { count: 0 }, commands: {} },
      deps,
    );
    const res = await handle.dispatch("nope", undefined);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("unknown_action");
  });

  it("dispatch 归一化:handler 非抛错显式失败 → 透传 {ok:false, error.code}", async () => {
    const scope: Record<string, unknown> = {};
    const rec = makeStateRecorder();
    const deps = makeDeps(scope, rec.access);
    const handle = createSurface(
      fakePi(deps.registerCommand),
      {
        domain: "demo",
        initialState: { count: 0 },
        commands: {
          edit: () => ({ ok: false, error: { code: "edit_failed", message: "no access" } }),
        },
      },
      deps,
    );
    const res = await handle.dispatch("edit", undefined);
    expect(res.ok).toBe(false);
    expect(res.error).toEqual({ code: "edit_failed", message: "no access" });
  });

  it("dispatch 归一化:handler 抛 SurfaceCommandError → .code 传播", async () => {
    const scope: Record<string, unknown> = {};
    const rec = makeStateRecorder();
    const deps = makeDeps(scope, rec.access);
    const handle = createSurface(
      fakePi(deps.registerCommand),
      {
        domain: "demo",
        initialState: { count: 0 },
        commands: {
          edit: () => {
            throw new SurfaceCommandError("edit_failed", "boom");
          },
        },
      },
      deps,
    );
    const res = await handle.dispatch("edit", undefined);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("edit_failed");
    expect(res.error?.message).toBe("boom");
  });

  it("dispatch 归一化:handler 抛普通 Error → 兜底 dispatch_failed", async () => {
    const scope: Record<string, unknown> = {};
    const rec = makeStateRecorder();
    const deps = makeDeps(scope, rec.access);
    const handle = createSurface(
      fakePi(deps.registerCommand),
      {
        domain: "demo",
        initialState: { count: 0 },
        commands: {
          edit: () => {
            throw new Error("kaboom");
          },
        },
      },
      deps,
    );
    const res = await handle.dispatch("edit", undefined);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("dispatch_failed");
  });

  it("dispatch 归一化不抛、不崩:命中/未知/失败均返回结果", async () => {
    const scope: Record<string, unknown> = {};
    const rec = makeStateRecorder();
    const deps = makeDeps(scope, rec.access);
    const handle = createSurface(
      fakePi(deps.registerCommand),
      { domain: "demo", initialState: { count: 0 }, commands: {} },
      deps,
    );
    await expect(handle.dispatch("x", undefined)).resolves.toBeDefined();
  });

  it("hydrate 重建后推快照", async () => {
    const scope: Record<string, unknown> = {};
    const rec = makeStateRecorder();
    const deps = makeDeps(scope, rec.access);
    createSurface(
      fakePi(deps.registerCommand),
      {
        domain: "demo",
        initialState: { count: 0 },
        commands: {},
        hydrate: async () => ({ count: 42 }),
      },
      deps,
    );
    await flush();
    // 装配期 hydrate 重建 → 推出 count:42 快照
    expect(rec.sets.some((s) => s.key === "surface:demo" && (s.value as { count: number }).count === 42)).toBe(
      true,
    );
  });

  it("注册进 surfaceRegistry seam:server 侧可 get(domain).dispatch", async () => {
    const scope: Record<string, unknown> = {};
    const rec = makeStateRecorder();
    const deps = makeDeps(scope, rec.access);
    createSurface(
      fakePi(deps.registerCommand),
      {
        domain: "demo",
        initialState: { count: 0 },
        commands: { ping: () => ({ pong: true }) },
      },
      deps,
    );
    const entry = getSurfaceRegistry(scope).get("demo");
    expect(entry).toBeDefined();
    const res = await entry!.dispatch("ping", undefined);
    expect(res).toEqual({ domain: "demo", action: "ping", ok: true, data: { pong: true } });
  });
});
