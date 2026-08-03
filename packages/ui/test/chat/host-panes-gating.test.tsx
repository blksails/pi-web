/**
 * 面板启用判据矩阵(spec host-builtin-panes 任务 6.1;Req 1.1/1.7)。
 *
 * 判据现为「宿主内置非空 ∨ agent 声明键」——右侧面板槽已删除(spec panes-only-right-panel)。
 * 该判据不成立时缺的不只是 pane —— 面板容器、显示/隐藏开关、比例切换器、连续宽度拖拽
 * **整套**都不存在。故这里按四种输入组合逐格断言。
 *
 * ★ 「不应出现」类断言的判别力问题:「正确地没出现」与「判据根本没装上」在观察上同形。
 * 故本文件同时断言**正向**格子里这些元素确实出现 —— 两者合起来才排除了「什么都没渲染」这种
 * 假绿。判据被篡改时至少一格会红,这一点在实现期以篡改法逐条验过。
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { WebExtension } from "@blksails/pi-web-kit";
import { definePanes, type PaneSource } from "@blksails/pi-web-panes-kit";
import { PiChat } from "../../src/chat/pi-chat.js";
import { mockSession } from "../fixtures/mock-session.js";

const DOC = { kind: "inline", srcDoc: "<!doctype html><p>p</p>" } as const;

/** 宿主内置来源(标识须带保留前缀,否则合并期被拒)。 */
const hostSource: PaneSource = {
  kind: "builtin",
  origin: "builtin",
  definition: definePanes({
    id: "host-builtin",
    panes: [{ id: "host:probe", title: "内置探针", document: DOC, capabilities: {} }],
  }),
};

/** 只声明 pane 键、不声明旧槽的 agent。 */
const agentWithPanesKey: WebExtension = {
  manifestId: "agent-panes-key",
  panes: definePanes({
    id: "agent",
    panes: [{ id: "agent:p", title: "Agent Pane", document: DOC, capabilities: {} }],
  }),
};

/** 既不声明槽也不声明 pane 键的 agent(绝大多数第三方 agent 的形态)。 */
const agentWithNothing: WebExtension = { manifestId: "agent-plain" };

function query(): {
  readonly aside: Element | null;
  readonly ratioSwitch: Element | null;
  readonly panelContent: Element | null;
} {
  return {
    aside: document.querySelector("[data-pi-chat-aside]"),
    ratioSwitch: document.querySelector("[data-pi-panel-ratio-switch]"),
    panelContent: document.querySelector("[data-pi-panel-content]"),
  };
}

describe("面板启用判据矩阵(内置有无 × agent 贡献有无)", () => {
  it("① 内置有 + agent 无任何贡献 → 面板容器与比例切换器出现(Req 1.1/1.3)", () => {
    render(<PiChat session={mockSession()} extension={agentWithNothing} hostPaneSource={hostSource} />);
    const { aside, ratioSwitch, panelContent } = query();
    // 这是本 spec 的核心行为:不带 web extension 的 agent 也能见到面板。
    expect(aside).not.toBeNull();
    expect(panelContent).not.toBeNull();
    expect(ratioSwitch).not.toBeNull();
  });

  it("② 内置有 + agent 也声明 pane 键 → 面板出现(两来源合并路径)", () => {
    render(
      <PiChat session={mockSession()} extension={agentWithPanesKey} hostPaneSource={hostSource} />,
    );
    expect(query().aside).not.toBeNull();
    expect(query().panelContent).not.toBeNull();
  });

  it("③ 内置无 + agent 声明 pane 键 → 面板出现(仅 agent 来源也成立)", () => {
    render(<PiChat session={mockSession()} extension={agentWithPanesKey} />);
    expect(query().aside).not.toBeNull();
    expect(query().panelContent).not.toBeNull();
  });

  it("★ ④ 内置无 + agent 无贡献 → 面板容器/内容区/比例切换器均不出现(Req 1.7)", () => {
    render(<PiChat session={mockSession()} extension={agentWithNothing} />);
    const { aside, ratioSwitch, panelContent } = query();
    expect(aside).toBeNull();
    expect(panelContent).toBeNull();
    expect(ratioSwitch).toBeNull();
  });

  it("★ ④' 完全不传 extension 且无内置 → 同样不出现(最小形态也不回归)", () => {
    render(<PiChat session={mockSession()} />);
    expect(query().aside).toBeNull();
    expect(query().ratioSwitch).toBeNull();
  });

  it("★ 内置来源存在但其 panes 全被拒(冒用/非法)→ 退回不渲染,而不是留一块空面板", () => {
    // 内置项漏保留前缀 → 合并期被拒 → 无可用定义 → 判据应落到「不渲染」。
    const badSource: PaneSource = {
      kind: "builtin",
      origin: "builtin",
      definition: { id: "bad", panes: [{ id: "no-prefix", title: "X", document: DOC, capabilities: {} }] },
    };
    render(<PiChat session={mockSession()} extension={agentWithNothing} hostPaneSource={badSource} />);
    expect(query().aside).toBeNull();
    expect(query().panelContent).toBeNull();
  });
});

/*
 * 已移除:`describe("旧槽形态不回退(Req 1.2/5.1/5.3)")`(spec panes-only-right-panel 任务 5.3)。
 *
 * **触发条件已不可能成立**:三条用例都以 `slots: { panelRight: … }` 构造被测扩展,而该槽已从
 * 契约中删除 —— 这样的描述符现在连类型都过不了。「旧槽优先」「内置让位」是双机制并存期的
 * 规则,机制收敛后规则本身作废(来自上游 spec 的 design D3,已随本 spec 一并终结)。
 *
 * 保护面未丢:这三条守的是「旧槽存在时内置让位」,而现在**内置永远不让位** ——
 * 由本文件的「面板启用判据矩阵」与下方「宿主装载路径渲染 panes」共同覆盖。
 */

describe("宿主装载路径渲染 panes(Req 1.1/2.1)", () => {
  it("内置 pane 以 iframe 形态挂载(与第三方 pane 同构)", () => {
    render(<PiChat session={mockSession()} extension={agentWithNothing} hostPaneSource={hostSource} />);
    const frame = document.querySelector('iframe[title="内置探针"]');
    expect(frame).not.toBeNull();
    // 同构的关键:同一隔离形态。sandbox 不含 allow-same-origin。
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("★ 两个来源的 pane 都进入合并结果并被渲染(接线验证,Req 2.1/2.2)", () => {
    // ⚠ 这里刻意**不**断言「内置在前」:tab 顺序反映的是已打开实例顺序,即 initialPaneIds,
    // 而按 Req 2.5 那是「agent 优先、内置后补」—— 与定义数组顺序刻意不同。定义顺序已在
    // merge 的纯函数单测里穷举验过(含 5 条篡改自证),此处该验的是**接线**:两个来源确实都
    // 被并进去、并原样交给了 PanesHost。
    //
    // 两来源各自声明初始打开项,否则合并结果只会自动打开第一个 pane,agent 那个不出现 ——
    // 断言就会因「元素不存在」而静默跳过,那是假绿(本用例初版正是这么错的)。
    const hostWithInitial: PaneSource = {
      ...hostSource,
      definition: definePanes({
        id: "host-builtin",
        initialPaneIds: ["host:probe"],
        panes: [{ id: "host:probe", title: "内置探针", document: DOC, capabilities: {} }],
      }),
    };
    const agentWithInitial: WebExtension = {
      manifestId: "agent-panes-key",
      panes: definePanes({
        id: "agent",
        initialPaneIds: ["agent:p"],
        panes: [{ id: "agent:p", title: "Agent Pane", document: DOC, capabilities: {} }],
      }),
    };
    render(
      <PiChat session={mockSession()} extension={agentWithInitial} hostPaneSource={hostWithInitial} />,
    );
    const titles = [...document.querySelectorAll("iframe")].map((el) => el.getAttribute("title"));
    // 两者都必须在 —— 少任一个就说明该来源没被并进去。
    expect(titles).toContain("内置探针");
    expect(titles).toContain("Agent Pane");
    // 顺带钉住 Req 2.5 在 UI 上的体现:初始打开集合里 agent 的在前。
    const tabs = [...document.querySelectorAll('[role="tab"]')].map((el) => el.textContent ?? "");
    expect(tabs.findIndex((t) => t.includes("Agent Pane"))).toBeLessThan(
      tabs.findIndex((t) => t.includes("内置探针")),
    );
  });
});
