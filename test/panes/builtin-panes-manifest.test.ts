/**
 * 内置 pane 清单与会话信号组装(spec host-builtin-panes 任务 3.2)。
 *
 * 这里守两件事:① 清单里每一项都带保留前缀 —— 否则它会在合并期被拒,而表现是「内置 panes
 * 全没了」;② 空清单返回 undefined 而不是空来源 —— 后者会被合并函数记成一条噪音拒绝。
 */
import { describe, expect, it, vi } from "vitest";
import {
  BUILTIN_PANE_ID_PREFIX,
  BROWSER_PANE_ID,
  SESSION_INFO_PANE_ID,
  SESSION_SIGNAL_NAME,
  buildSessionSignals,
  builtinPaneSource,
  builtinPanes,
} from "../../lib/app/builtin-panes/index.js";
import { mergePaneSources } from "@blksails/pi-web-panes-kit";

describe("内置 pane 清单", () => {
  it("★ 每一项标识都带保留前缀(否则合并期被拒,表现为内置 panes 全没了)", () => {
    const panes = builtinPanes();
    expect(panes.length).toBeGreaterThan(0);
    for (const pane of panes) {
      expect(pane.id.startsWith(BUILTIN_PANE_ID_PREFIX)).toBe(true);
    }
  });

  it("★ 清单产物能通过真实合并函数(而不只是长得像合法)", () => {
    const source = builtinPaneSource();
    expect(source).toBeDefined();
    const merged = mergePaneSources([source!]);
    // 端到端判据:合并后确有内容、且零拒绝。任一项标识漏前缀或定义非法都会在这里现形。
    expect(merged.rejections).toEqual([]);
    expect(merged.definition?.panes.map((p) => p.id)).toContain(SESSION_INFO_PANE_ID);
    expect(merged.definition?.panes.map((p) => p.id)).toContain(BROWSER_PANE_ID);
  });

  it("会话信息 pane 的 capabilities 为空(内置身份不提权的活体证据)", () => {
    const pane = builtinPanes().find((p) => p.id === SESSION_INFO_PANE_ID);
    expect(pane).toBeDefined();
    expect(pane?.capabilities).toEqual({});
  });

  it("浏览器 pane 不获得宿主能力", () => {
    const pane = builtinPanes().find((p) => p.id === BROWSER_PANE_ID);
    expect(pane).toBeDefined();
    expect(pane?.capabilities).toEqual({});
  });

  it("来源类型标为 builtin(合并函数据此施加前缀规则)", () => {
    expect(builtinPaneSource()?.kind).toBe("builtin");
  });

  it("★ 构建产物缺席时优雅降级为空,不抛异常", async () => {
    // 产物是 gitignore 的构建输出,一次没跑构建不该让整个会话外壳崩。缺席时该 pane 自行
    // 退出清单 → 清单可能变空 → 装载判据落到「面板整体不渲染」(Req 1.7),即回到实施前外观。
    // 这里直接测 pane 构造器对空产物的反应,不靠改磁盘文件(那会污染并发跑的其他测试)。
    const { sessionInfoPane } = await import("../../lib/app/builtin-panes/session-info.js");
    // 真实产物在场时它应返回定义;这条断言的价值在于与下面的 mock 形成对照。
    expect(sessionInfoPane()).toBeDefined();

    vi.resetModules();
    vi.doMock("../../panes/generated.js", () => ({ builtinPaneDocuments: {} }));
    const fresh = await import("../../lib/app/builtin-panes/session-info.js");
    expect(() => fresh.sessionInfoPane()).not.toThrow();
    expect(fresh.sessionInfoPane()).toBeUndefined();

    const manifest = await import("../../lib/app/builtin-panes/index.js");
    expect(manifest.builtinPanes()).toEqual([]);
    // ★ 空清单必须返回 undefined 而非空来源 —— 空来源会被合并函数记成一条噪音拒绝。
    expect(manifest.builtinPaneSource()).toBeUndefined();

    vi.doUnmock("../../panes/generated.js");
    vi.resetModules();
  });
});

describe("buildSessionSignals — 会话事实载荷", () => {
  it("三个字段齐备时载荷完整", () => {
    const signals = buildSessionSignals({
      sessionId: "s-1",
      agentSource: "builtin:default-agent",
      cwd: "/w",
    });
    expect(signals[SESSION_SIGNAL_NAME]).toEqual({
      sessionId: "s-1",
      agentSource: "builtin:default-agent",
      cwd: "/w",
    });
  });

  it("★ 缺字段就不放进载荷(不补空串)—— 空串与「真的是空值」无法区分", () => {
    const signals = buildSessionSignals({ sessionId: "s-1" });
    expect(signals[SESSION_SIGNAL_NAME]).toEqual({ sessionId: "s-1" });
  });

  it("★ 三字段全缺 → 空映射,而不是含空对象的映射", () => {
    // 推一条内容为空的信号会让 guest 从「从未推送」的空态切到「推了但没内容」的空态,
    // 两者排查方向完全不同。
    expect(buildSessionSignals({})).toEqual({});
    expect(buildSessionSignals({ sessionId: undefined, cwd: "" })).toEqual({});
  });

  it("空串按缺失处理", () => {
    expect(buildSessionSignals({ sessionId: "", agentSource: "a" })[SESSION_SIGNAL_NAME]).toEqual({
      agentSource: "a",
    });
  });

  it("信号名与 guest 侧约定一致(改一边就断链)", () => {
    // guest 侧的常量在 panes/session-info/view.ts;两处必须同名,故此处钉死字面量。
    expect(SESSION_SIGNAL_NAME).toBe("host:session");
  });

  it("载荷不含凭据类字段(边界:只放会话标识/源/工作目录)", () => {
    const facts = buildSessionSignals({
      sessionId: "s",
      agentSource: "src",
      cwd: "/w",
    })[SESSION_SIGNAL_NAME] as Record<string, unknown>;
    expect(Object.keys(facts).sort()).toEqual(["agentSource", "cwd", "sessionId"]);
  });
});
