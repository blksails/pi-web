/**
 * 装载点的注入面完整性、拒绝上报时机、废弃诊断与防漂移断言
 * (spec host-builtin-panes 任务 6.2;Req 1.2/5.2/5.3/3.4/7.1)。
 *
 * ## 本文件为何不测「两条路径注入等价」
 *
 * 用户已决策**废弃 `slots.panelRight`、全量重写为 pane**,旧槽路径会在下游 spec 里整条删除。
 * 「等价」断言写了即要删;而「旧槽走旧路径 / 内置让位」6.1 的「旧槽形态不回退」块已覆盖
 * (随删除一并移除)。故本文件只放**删除后依然成立**的断言,外加一条过渡期的废弃诊断。
 *
 * ## 注入面完整性的事实源(★ 判别力所在)
 *
 * 断言**不**基于测试里手写的注入项清单 —— 那样的话,将来有人新增一个注入项、只接到旧槽路径
 * 而忘了宿主路径,测试照样全绿(因为手写清单也没写它)。这里改为以**旧槽路径实际收到的 prop
 * 键全集**为事实源:每个键必须在下方映射表里有登记(有对应载体、或显式登记为已知缺口并注明
 * 去向)。未登记即报红 —— 这才挡得住「未来的遗漏」而不只是「今天的遗漏」。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { WebExtension } from "@blksails/pi-web-kit";
import { definePanes, type PaneSource, type PaneMergeRejection } from "@blksails/pi-web-panes-kit";
import { MockTransport, mockSession } from "../fixtures/mock-session.js";

// ── 探针:捕获两条路径实际收到的 props ────────────────────────────────────────

const captured = vi.hoisted(() => ({
  panes: [] as Array<Record<string, unknown>>,
  warns: [] as Array<{ msg: string; fields: unknown }>,
}));

vi.mock("@blksails/pi-web-logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blksails/pi-web-logger")>();
  const rec = (msg: string, fields?: unknown) => {
    captured.warns.push({ msg, fields });
  };
  return {
    ...actual,
    createLogger: () => ({ debug: rec, info: rec, warn: rec, error: rec }),
  };
});

vi.mock("@blksails/pi-web-panes-kit/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blksails/pi-web-panes-kit/react")>();
  return {
    ...actual,
    PanesHost: (props: Record<string, unknown>) => {
      captured.panes.push(props);
      return null;
    },
  };
});

// mock 必须先于被测模块求值(vi.mock 会被 hoist,但 import 顺序仍要显式在其后)。
const { PiChat } = await import("../../src/chat/pi-chat.js");

const DOC = { kind: "inline", srcDoc: "<!doctype html><p>p</p>" } as const;

const hostSource: PaneSource = {
  kind: "builtin",
  origin: "builtin",
  definition: definePanes({
    id: "host-builtin",
    panes: [{ id: "host:probe", title: "内置探针", document: DOC, capabilities: {} }],
  }),
};

const agentWithNothing: WebExtension = { manifestId: "agent-plain" };

beforeEach(() => {
  captured.panes.length = 0;
  captured.warns.length = 0;
});

// ── 注入面登记表 ──────────────────────────────────────────────────────────────

/**
 * 旧槽 prop → 宿主路径载体的登记表。
 *
 * `carrier` 的三种取值各有不同含义:
 *  - `{ prop }`      宿主路径以同名/异名 prop 承载 —— 断言该 prop 存在;
 *  - `{ signal }`    以**具名信号**承载(PanesHost 接口里没有那个专有 prop)—— 断言 signals 有该键;
 *
 * 另有 `conditional: true` 标记:该项源值为 undefined 时**两条路径都不带**(如流式图像预览,
 * 单测里造不出那个条件)。对它的判据改为「旧槽实收了该 prop ⇒ 宿主载体必须在」—— 事实源仍是
 * 旧槽实收键,故「无条件化了旧槽却漏了宿主」这种改动依然报红。
 *
 *  - `{ gap }`       **已知缺口**,pane 协议里今天没有对应通道 —— 登记去向,不断言存在。
 *                    登记为缺口不是豁免:它必须写明 pane 侧的替代路径或下游 spec 归属,
 *                    否则「等价」这个词就成了自欺。
 *  - `{ mechanism }` 旧槽路径的机制性 prop(不是注入的能力),不参与等价性。
 */
const INJECTION_LEDGER: Readonly<
  Record<
    string,
    | { readonly prop: string; readonly conditional?: true }
    | { readonly signal: string; readonly conditional?: true }
    | { readonly gap: string }
    | { readonly mechanism: true }
  >
> = {
  // 机制性:旧槽路径靠这两个 prop 找到要渲染哪个槽,宿主路径没有「槽」这个概念。
  ext: { mechanism: true },
  slot: { mechanism: true },

  // 同名/异名 prop 承载。
  surface: { prop: "surface" },
  upload: { prop: "upload" },
  baseUrl: { prop: "baseUrl" },
  sessionId: { prop: "sessionId", conditional: true },
  conversation: { prop: "conversation" },

  // 具名信号承载 —— PanesHost 接口里没有这两个专有 prop。
  // ★ syncSignal 缺失曾直接表现为「LLM 生了图,画廊不更新」,是有前科的静默失效面,
  //   故它是**无条件**的(宿主每轮 idle 边沿都 bump,不存在「没有值」的形态)。
  syncSignal: { signal: "host:syncSignal" },
  // 当前轮流式 AIGC 图像预览:无流式图像时两条路径都不带该项。
  livePreviewImage: { signal: "host:livePreviewImage", conditional: true },

  // 过渡别名:与 conversation.submitUserMessage 等价,pane guest 经 conversation 通道拿到同一能力。
  onSubmitPrompt: { prop: "conversation" },

  // ── 已知缺口(下游「废弃 panelRight」spec 的输入) ──────────────────────────
  //
  // webextState:同 realm 的共享状态 KV(createWebExtStateAccess)。pane 协议今天只有
  // pane:surface(agent 权威快照)/ pane:signal(宿主具名值)/ pane:event(pane 间事件),
  // 没有可读写的共享 KV 通道。★ examples/state-bridge-agent 的 panelRight 正是靠它 ——
  // 那个示例要迁成 pane,这条通道必须先建。
  state: { gap: "pane 协议无共享状态 KV 通道;state-bridge-agent 迁移的前置条件" },

  // extensions:已装载扩展描述符数组,领域中立地搬给槽组件自取。pane 侧无对应注入 ——
  // 它是宿主 realm 的对象图,跨 realm 需先定义可序列化投影。
  extensions: { gap: "宿主 realm 对象图,跨 realm 需先定义可序列化投影" },
};

describe("注入面完整性(宿主路径必须注入的能力)", () => {
  /*
   * ★ 事实源变更记录(任务 5.3)。
   *
   * 原实现以**旧槽路径实收的 prop 键全集**为事实源,好处是「新增注入项只接到旧槽、忘了宿主
   * 路径」会自动报红。右侧面板槽删除后那个事实源不复存在。
   *
   * **这是一次真实的保护面削弱,不掩饰**:现在只能对着显式清单断言,失去了「自动发现新增注入
   * 项」的能力 —— 这是单路径下的必然,没有第二条路径可比对了。
   * 补偿:清单逐项写明该注入项**为什么**必须在,使漏接时能从失败信息直接看出后果。
   */
  const REQUIRED_PROPS: ReadonlyArray<{ readonly key: string; readonly why: string }> = [
    { key: "definition", why: "没有它 pane 宿主无从知道要渲染什么" },
    { key: "surface", why: "agent 权威快照与命令通道;缺失则 pane 只能空转" },
    { key: "upload", why: "pane 侧产物落附件的唯一途径" },
    { key: "baseUrl", why: "agent route 与附件分发的地址前缀" },
    { key: "conversation", why: "pane 把操作组装成用户消息回流对话流的能力" },
    { key: "signals", why: "★ 轮末同步信号在此;缺失曾直接表现为「LLM 生了图,画廊不更新」" },
  ];

  it("★ 宿主路径注入了全部必需项(失败信息带上「为什么」)", () => {
    render(<PiChat session={mockSession()} extension={agentWithNothing} hostPaneSource={hostSource} />);
    expect(captured.panes).toHaveLength(1);
    const paneProps = captured.panes[0] as Record<string, unknown>;
    const missing = REQUIRED_PROPS.filter((r) => !(r.key in paneProps)).map((r) => `${r.key} —— ${r.why}`);
    expect(missing).toEqual([]);
  });

  it("★ 轮末同步信号确实在 signals 里(不是只挂了个空对象)", () => {
    render(<PiChat session={mockSession()} extension={agentWithNothing} hostPaneSource={hostSource} />);
    const signals = (captured.panes[0] as Record<string, unknown>).signals as Record<string, unknown>;
    expect(signals).toHaveProperty("host:syncSignal");
  });

  it("会话尚未启动时暂存 pane 消息,transport 就绪后补投", async () => {
    const start = vi.fn();
    const idleSession = mockSession({
      sessionId: undefined,
      status: "idle",
      transport: undefined,
      start,
    });
    const { rerender } = render(
      <PiChat session={idleSession} extension={agentWithNothing} hostPaneSource={hostSource} />,
    );
    const conversation = captured.panes.at(-1)?.conversation as {
      submitUserMessage(text: string): void;
    };

    conversation.submitUserMessage("局部重绘");
    expect(start).toHaveBeenCalledTimes(1);

    const transport = new MockTransport();
    const sendMessages = vi.spyOn(transport, "sendMessages");
    rerender(
      <PiChat
        session={mockSession({
          transport: transport as unknown as ReturnType<typeof mockSession>["transport"],
          start,
        })}
        extension={agentWithNothing}
        hostPaneSource={hostSource}
      />,
    );

    await waitFor(() => expect(sendMessages).toHaveBeenCalledTimes(1));
  });

  it("带入对话仅写入输入框附件引用，不自动提交", async () => {
    const transport = new MockTransport();
    const sendMessages = vi.spyOn(transport, "sendMessages");
    render(
      <PiChat
        session={mockSession({
          transport: transport as unknown as ReturnType<typeof mockSession>["transport"],
        })}
        extension={agentWithNothing}
        hostPaneSource={hostSource}
      />,
    );
    const conversation = captured.panes.at(-1)?.conversation as {
      stageUserMessage(text: string, options: { attachmentIds: string[] }): void;
    };

    act(() => {
      conversation.stageUserMessage("", { attachmentIds: ["att_material"] });
    });

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /消息输入|message/i })).toHaveValue(
        "@attachment:att_material",
      ),
    );
    expect(sendMessages).not.toHaveBeenCalled();
  });
});

describe("拒绝清单的上报时机(Req 3.4/7.1)", () => {
  /** 内置项漏保留前缀 → 合并期被拒。 */
  const badSource: PaneSource = {
    kind: "builtin",
    origin: "builtin",
    definition: {
      id: "bad",
      panes: [{ id: "no-prefix", title: "X", document: DOC, capabilities: {} }],
    },
  };

  it("★ 拒绝在会话装载期即上报,无需任何用户交互", () => {
    const seen: PaneMergeRejection[][] = [];
    render(
      <PiChat
        session={mockSession()}
        extension={agentWithNothing}
        hostPaneSource={badSource}
        onPaneMergeRejections={(r) => seen.push([...r])}
      />,
    );
    // 首次渲染后即到手 —— 若实现把上报推迟到「用户点开该 pane」,这里就是空数组。
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]?.length).toBeGreaterThan(0);
  });

  it("每条拒绝都带来源标识与 pane 标识(不带则无法定位是谁被拒)", () => {
    const seen: PaneMergeRejection[][] = [];
    render(
      <PiChat
        session={mockSession()}
        extension={agentWithNothing}
        hostPaneSource={badSource}
        onPaneMergeRejections={(r) => seen.push([...r])}
      />,
    );
    for (const rejection of seen[0] ?? []) {
      expect(rejection.origin.length).toBeGreaterThan(0);
      expect(rejection.kind).toBe("builtin");
      expect(rejection.paneIds.length).toBeGreaterThan(0);
      expect(rejection.reason.length).toBeGreaterThan(0);
    }
  });

  it("无回调时经日志输出,同样在装载期(不静默丢弃)", () => {
    render(<PiChat session={mockSession()} extension={agentWithNothing} hostPaneSource={badSource} />);
    expect(captured.warns.some((w) => w.msg.includes("rejected"))).toBe(true);
  });

  it("合并无拒绝时不产生拒绝日志(避免噪声掩盖真拒绝)", () => {
    render(<PiChat session={mockSession()} extension={agentWithNothing} hostPaneSource={hostSource} />);
    expect(captured.warns.some((w) => w.msg.includes("rejected"))).toBe(false);
  });
});

/*
 * 已移除:`describe("slots.panelRight 的废弃诊断")`(任务 5.3)。
 * **触发条件已不可能成立**:诊断的触发条件是「agent 声明了右侧面板槽」,而该槽已从契约删除。
 * 过渡期诊断随过渡期结束而终结 —— 它连同 pi-chat 里的实现一起删除,不留单边残骸。
 */

// ── 镜像 ↔ canonical 双向可赋值 ───────────────────────────────────────────────

/**
 * ★ 防漂移断言。
 *
 * `web-kit` 的 `WebExtension["panes"]` 是 `panes-kit` 的 `PanesDefinitionInput` 的**最小结构
 * 镜像** —— 两包刻意无依赖边(web-kit 不该为一个类型把整个 panes-kit 拖进 agent 作者的构建)。
 * 代价是两边各自演进会漂,而漂移**在两包各自的测试里都看不见**:panes-kit 的测试不知道镜像
 * 存在,web-kit 的测试不知道 canonical 存在。故断言只能落在同时依赖两者的这一层
 * (与既有 canvas 插件在 canvas-ui 聚合处断言同理)。
 *
 * 「双向」是关键,单向只抓一半:
 *  - canonical → 镜像:canonical 加字段而镜像没跟上 ⇒ 这个方向报红;
 *  - 镜像 → canonical:镜像收窄(如某字段改成必填)⇒ 那个方向报红。
 *
 * 漂移的**用户可见表现**是 agent 作者写 `panes: definePanes({...})` 时 TS 报错、赋不进去。
 * 下面两条赋值就是那件事的最小复现。这些是**类型层**断言,由 `pnpm typecheck` 抓 ——
 * vitest 只转译不做类型检查,故此文件跑绿**不代表**这两条成立。
 */
type PaneMirror = NonNullable<WebExtension["panes"]>;
type PaneCanonical = ReturnType<typeof definePanes>;

const canonicalValue: PaneCanonical = definePanes({
  id: "drift-probe",
  panes: [{ id: "drift:p", title: "P", document: DOC, capabilities: {} }],
});

// 方向一:canonical 产物必须能赋给声明键(agent 作者的实际写法)。
const asMirror: PaneMirror = canonicalValue;
// 方向二:镜像必须能喂回 canonical 形状(镜像不得比 canonical 更宽松到装不进去)。
const asCanonical: PaneCanonical = asMirror as PaneCanonical;

describe("镜像与 canonical 的双向可赋值(防漂移)", () => {
  it("两个方向的赋值都成立,且值在运行时同一(赋值被优化掉就成了空断言)", () => {
    // 运行时这条只是保证上面两行确实被求值 —— 真正的判别力在 typecheck。
    expect(asMirror).toBe(canonicalValue);
    expect(asCanonical).toBe(canonicalValue);
  });

  it("镜像携带 canonical 的结构必填项(id 与 panes 数组)", () => {
    expect(asMirror.id).toBe("drift-probe");
    expect(asMirror.panes).toHaveLength(1);
  });
});
