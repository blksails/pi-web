import { describe, expect, it } from "vitest";
import {
  CUSTOM_UI_OPTIONS_KEY,
  wireCustomUiBridge,
  type StdoutLike,
} from "../../src/runner/custom-ui-wiring.js";

/** 收集写入的 stdout/stderr stub。 */
function makeStdout(): StdoutLike & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    write(chunk: string): boolean {
      writes.push(chunk);
      return true;
    },
  };
}

interface UiContextStub {
  custom?: (factory: unknown, options?: unknown) => Promise<unknown>;
  notify: (m: string) => void;
  notifyCalls: string[];
}

function makeUiContext(): UiContextStub {
  const notifyCalls: string[] = [];
  return {
    notifyCalls,
    notify(m: string) {
      notifyCalls.push(m);
    },
  };
}

/**
 * 每次创建一个**独立的** session 类(prototype 唯一),避免 prototype patch 跨测试泄漏。
 * prototype.bindExtensions 记录每次绑定的 uiContext。
 */
function makeRuntime(): {
  runtime: { session: object };
  bound: UiContextStub[];
} {
  const bound: UiContextStub[] = [];
  class StubSession {
    bindExtensions(bindings: { uiContext?: UiContextStub }): void {
      if (bindings.uiContext) bound.push(bindings.uiContext);
    }
  }
  return { runtime: { session: new StubSession() }, bound };
}

function bind(runtime: { session: object }, ui: UiContextStub): void {
  (runtime.session as { bindExtensions: (b: unknown) => void }).bindExtensions({
    uiContext: ui,
  });
}

const validOptions = {
  [CUSTOM_UI_OPTIONS_KEY]: { component: "demo-metric-card", props: { label: "x", value: 1 } },
};

describe("wireCustomUiBridge", () => {
  it("bind 后 custom 合法 payload → 写一行 extension_ui_request{method:custom} JSONL 帧", async () => {
    const stdout = makeStdout();
    const { runtime } = makeRuntime();
    const w = wireCustomUiBridge(runtime, { stdout, randomId: () => "id-1" });
    expect(w.installed).toBe(true);

    const ui = makeUiContext();
    bind(runtime, ui);
    expect(typeof ui.custom).toBe("function");

    const ret = await ui.custom!(() => undefined, validOptions);
    expect(ret).toBeUndefined(); // fire-and-forget

    expect(stdout.writes).toHaveLength(1);
    const line = stdout.writes[0] ?? "";
    expect(line.endsWith("\n")).toBe(true);
    const frame = JSON.parse(line) as Record<string, unknown>;
    expect(frame).toMatchObject({
      type: "extension_ui_request",
      id: "id-1",
      method: "custom",
      payload: { component: "demo-metric-card", props: { label: "x", value: 1 } },
    });

    w.restore();
  });

  it("custom 缺失/非法 payload → 不发帧(保持 pi 空操作)", async () => {
    const stdout = makeStdout();
    const { runtime } = makeRuntime();
    const w = wireCustomUiBridge(runtime, { stdout });
    const ui = makeUiContext();
    bind(runtime, ui);

    expect(await ui.custom!(() => undefined, undefined)).toBeUndefined();
    expect(await ui.custom!(() => undefined, {})).toBeUndefined();
    expect(
      await ui.custom!(() => undefined, { [CUSTOM_UI_OPTIONS_KEY]: { component: "" } }),
    ).toBeUndefined();
    expect(stdout.writes).toHaveLength(0);

    w.restore();
  });

  it("不触碰 uiContext 其它方法(notify 原样)", () => {
    const stdout = makeStdout();
    const { runtime } = makeRuntime();
    const w = wireCustomUiBridge(runtime, { stdout });
    const ui = makeUiContext();
    bind(runtime, ui);
    ui.notify("hi");
    expect(ui.notifyCalls).toEqual(["hi"]);
    w.restore();
  });

  it("跨 rebind:多次 bind(含更换 uiContext 对象)都装上 custom 覆盖", async () => {
    const stdout = makeStdout();
    const { runtime } = makeRuntime();
    const w = wireCustomUiBridge(runtime, { stdout, randomId: () => "id-x" });

    const ui1 = makeUiContext();
    const ui2 = makeUiContext();
    bind(runtime, ui1);
    bind(runtime, ui2); // 模拟 newSession/fork 后的 rebind(新 uiContext)

    await ui1.custom!(() => undefined, validOptions);
    await ui2.custom!(() => undefined, validOptions);
    expect(stdout.writes).toHaveLength(2);
    w.restore();
  });

  it("幂等:重复 wire 不重复包装(只发一帧)", async () => {
    const stdout = makeStdout();
    const { runtime } = makeRuntime();
    const w1 = wireCustomUiBridge(runtime, { stdout, randomId: () => "id" });
    const w2 = wireCustomUiBridge(runtime, { stdout, randomId: () => "id" });
    expect(w1.installed && w2.installed).toBe(true);

    const ui = makeUiContext();
    bind(runtime, ui);
    await ui.custom!(() => undefined, validOptions);
    expect(stdout.writes).toHaveLength(1); // 未重复包装 → 单帧
    w2.restore();
  });

  it("回归:wire 后 stdout.write 被替换(模拟 pi takeOverStdout)→ 仍写 wire 时捕获的原始写口", async () => {
    // pi 进入 RPC 模式会 takeOverStdout:把 process.stdout.write 换成「写 stderr」的函数。
    // 本桥接必须在 wire 时即时 .bind 捕获原始写口,否则帧会被导去 stderr、永不进 RPC 通道
    // (chrome 实测发现:帧落 proc:stderr、前端无渲染)。此测锁住该修复。
    const original: string[] = [];
    const afterTakeover: string[] = [];
    const stdout: StdoutLike & { write: (c: string) => boolean } = {
      write(chunk: string): boolean {
        original.push(chunk);
        return true;
      },
    };
    const { runtime } = makeRuntime();
    const w = wireCustomUiBridge(runtime, { stdout, randomId: () => "id-cap" });

    // 模拟 takeover:wire 之后把 write 替换为写「另一个流」(stderr 替身)。
    stdout.write = (chunk: string): boolean => {
      afterTakeover.push(chunk);
      return true;
    };

    const ui = makeUiContext();
    bind(runtime, ui);
    await ui.custom!(() => undefined, validOptions);

    // 帧必须落在 wire 时捕获的原始写口,而非 takeover 后替换的写口。
    expect(original).toHaveLength(1);
    expect(afterTakeover).toHaveLength(0);
    expect(JSON.parse(original[0] ?? "{}")).toMatchObject({
      type: "extension_ui_request",
      method: "custom",
      payload: { component: "demo-metric-card" },
    });
    w.restore();
  });

  it("session prototype 无 bindExtensions → 优雅降级(installed:false, 写 stderr, 不抛)", () => {
    const stdout = makeStdout();
    const stderr = makeStdout();
    const runtime = { session: Object.create(null) as object };
    const w = wireCustomUiBridge(runtime, { stdout, stderr });
    expect(w.installed).toBe(false);
    expect(stderr.writes.join("")).toContain("custom-ui bridge not installed");
    expect(() => w.restore()).not.toThrow();
  });

  it("restore 还原原始 bindExtensions(不再装 custom)", () => {
    const stdout = makeStdout();
    const { runtime } = makeRuntime();
    const w = wireCustomUiBridge(runtime, { stdout });
    w.restore();
    const ui = makeUiContext();
    bind(runtime, ui);
    expect(ui.custom).toBeUndefined(); // 已还原 → 不再覆盖
  });
});
