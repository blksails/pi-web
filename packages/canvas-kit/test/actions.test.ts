/**
 * actions 契约 + resolveAction 纯函数决策器(task 1.1,Req 1.1/1.2/1.3/1.5/1.7 与 4.5)。
 *
 * 覆盖(design「canvas-kit · actions.ts(核心契约)」+ Error Handling):
 * - 最高分胜出(1.2):多动作数值分,取分值最高者;
 * - false 排除(1.3):match 返回 false 的动作不参与决策;
 * - match 抛错隔离(1.5):match 抛错经 onError 上报 + 按不适用隔离,决策不中断;
 * - buildArgs 抛错剔除后重选次优(1.5):winner buildArgs 抛错→onError→剔除该动作重选;
 * - 同分稳定取先者(1.2):同分并列按注册序取先注册者;
 * - 空候选 null:全部排除或空表→null;
 * - via:"command" 白名单过滤(4.5):command ∉ capability.actions 先行排除,∈ 则参与,
 *   capability.actions 空数组=全部 command 动作排除;
 * - 纯函数(1.7):resolveAction 不修改入参(actions/input/capability);
 * - defineCanvasAction 恒等(纯类型收窄)。
 */
import { describe, it, expect, vi } from "vitest";
import {
  defineCanvasAction,
  resolveAction,
  type ActionInput,
  type CanvasActionPlugin,
  type CanvasCapability,
} from "../src/actions.js";

// ── 测试基建 ──────────────────────────────────────────────────────────────────

const cap = (over: Partial<CanvasCapability> = {}): CanvasCapability => ({
  models: [],
  sizes: [],
  actions: [],
  ...over,
});

const input = (over: Partial<ActionInput> = {}): ActionInput => ({
  imageId: "img-1",
  prompt: "a cat",
  model: "gpt-image-2",
  size: "1024x1024",
  variants: 1,
  hasMask: false,
  hasExpand: false,
  referenceIds: [],
  capability: cap(),
  ...over,
});

/** prompt 通道动作(via:"prompt";buildOp 恒等透传 args 供断言)。 */
const promptAction = (
  id: string,
  score: number | false,
  over: Partial<CanvasActionPlugin<{ tag: string; args: Record<string, unknown> }>> = {},
): CanvasActionPlugin<{ tag: string; args: Record<string, unknown> }> =>
  defineCanvasAction({
    id,
    label: id,
    match: () => score,
    buildArgs: () => ({ from: id }),
    execution: { via: "prompt", buildOp: (args) => ({ tag: id, args }) },
    ...over,
  });

/** command 通道动作(via:"command";参与决策须 command ∈ capability.actions)。 */
const commandAction = (
  id: string,
  command: string,
  score: number | false,
  over: Partial<CanvasActionPlugin> = {},
): CanvasActionPlugin =>
  defineCanvasAction({
    id,
    label: id,
    match: () => score,
    buildArgs: () => ({ from: id }),
    execution: { via: "command", command },
    ...over,
  });

// ── 最高分胜出(1.2)──────────────────────────────────────────────────────────

describe("resolveAction 评分制决策(1.2)", () => {
  it("多动作数值分:取分值最高者", () => {
    const actions = [promptAction("a", 10), promptAction("b", 90), promptAction("c", 50)];
    const r = resolveAction(actions, input());
    expect(r).not.toBeNull();
    expect(r!.plugin.id).toBe("b");
    expect(r!.score).toBe(90);
    expect(r!.args).toEqual({ from: "b" });
  });

  it("同分并列:按注册序取先注册者(稳定)", () => {
    const actions = [promptAction("first", 70), promptAction("second", 70)];
    expect(resolveAction(actions, input())!.plugin.id).toBe("first");
    // 反序注册验证「先注册者」而非「id 字典序」
    const reversed = [promptAction("second", 70), promptAction("first", 70)];
    expect(resolveAction(reversed, input())!.plugin.id).toBe("second");
  });
});

// ── false 排除(1.3)/ 空候选 null ────────────────────────────────────────────

describe("resolveAction 排除与空候选(1.3)", () => {
  it("match 返回 false 的动作被排除,不参与决策", () => {
    const actions = [promptAction("skip", false), promptAction("keep", 5)];
    const r = resolveAction(actions, input());
    expect(r!.plugin.id).toBe("keep");
  });

  it("全部 false → 返回 null", () => {
    const actions = [promptAction("a", false), promptAction("b", false)];
    expect(resolveAction(actions, input())).toBeNull();
  });

  it("空动作表 → 返回 null", () => {
    expect(resolveAction([], input())).toBeNull();
  });
});

// ── 错误隔离(1.5)────────────────────────────────────────────────────────────

describe("resolveAction 错误隔离(1.5)", () => {
  it("match 抛错:经 onError 上报 + 按不适用隔离,次优胜出,决策不中断", () => {
    const onError = vi.fn();
    const boom = new Error("match boom");
    const bad = promptAction("bad", 100, {
      match: () => {
        throw boom;
      },
    });
    const good = promptAction("good", 50);
    const r = resolveAction([bad, good], input(), { onError });
    expect(r!.plugin.id).toBe("good");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("bad", boom);
  });

  it("winner 的 buildArgs 抛错:剔除该动作后重选次优 + onError 上报", () => {
    const onError = vi.fn();
    const boom = new Error("buildArgs boom");
    const top = promptAction("top", 100, {
      buildArgs: () => {
        throw boom;
      },
    });
    const next = promptAction("next", 80);
    const r = resolveAction([top, next], input(), { onError });
    expect(r!.plugin.id).toBe("next");
    expect(r!.score).toBe(80);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("top", boom);
  });

  it("所有候选 buildArgs 均抛错 → 返回 null,每个动作各上报一次", () => {
    const onError = vi.fn();
    const mk = (id: string, score: number) =>
      promptAction(id, score, {
        buildArgs: () => {
          throw new Error(id);
        },
      });
    const r = resolveAction([mk("a", 90), mk("b", 60)], input(), { onError });
    expect(r).toBeNull();
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("无 onError 时 match/buildArgs 抛错仍隔离,不向外抛", () => {
    const bad = promptAction("bad", 100, {
      match: () => {
        throw new Error("x");
      },
    });
    const good = promptAction("good", 10);
    expect(() => resolveAction([bad, good], input())).not.toThrow();
    expect(resolveAction([bad, good], input())!.plugin.id).toBe("good");
  });
});

// ── via:"command" 白名单过滤(4.5)────────────────────────────────────────────

describe("resolveAction command 白名单过滤(4.5)", () => {
  it("command ∈ capability.actions:参与决策", () => {
    const actions = [commandAction("cmd", "inpaint", 90), commandAction("edit", "edit", 10)];
    const r = resolveAction(actions, input({ capability: cap({ actions: ["inpaint", "edit"] }) }));
    expect(r!.plugin.id).toBe("cmd");
  });

  it("command ∉ capability.actions:先行排除(即便分更高)", () => {
    const actions = [commandAction("cmd", "sticker", 90), promptAction("fallback", 10)];
    const r = resolveAction(actions, input({ capability: cap({ actions: ["inpaint"] }) }));
    expect(r!.plugin.id).toBe("fallback");
  });

  it("capability.actions 空数组:全部 command 动作排除,仅 prompt 动作参与", () => {
    const actions = [commandAction("cmd", "inpaint", 90), promptAction("only", 10)];
    const r = resolveAction(actions, input({ capability: cap({ actions: [] }) }));
    expect(r!.plugin.id).toBe("only");
  });

  it("command 动作全被白名单排除且无 prompt 动作 → null", () => {
    const actions = [commandAction("cmd", "sticker", 90)];
    expect(resolveAction(actions, input({ capability: cap({ actions: [] }) }))).toBeNull();
  });
});

// ── 纯函数(1.7)──────────────────────────────────────────────────────────────

describe("resolveAction 纯函数(1.7)", () => {
  it("不修改入参:actions 数组、input、capability 全程不变", () => {
    const actions = [promptAction("a", 10), promptAction("b", 90)];
    const actionsSnapshot = [...actions];
    const inp = input({ referenceIds: ["r1"], capability: cap({ actions: ["inpaint"] }) });
    const inpJson = JSON.stringify(inp);
    resolveAction(actions, inp);
    expect(actions).toEqual(actionsSnapshot); // 引用序不变
    expect(JSON.stringify(inp)).toBe(inpJson); // 值不变
  });

  it("同输入同输出(确定性)", () => {
    const actions = [promptAction("a", 30), promptAction("b", 70)];
    const inp = input();
    expect(resolveAction(actions, inp)).toEqual(resolveAction(actions, inp));
  });
});

// ── defineCanvasAction ────────────────────────────────────────────────────────

describe("defineCanvasAction", () => {
  it("恒等返回(纯类型收窄,defineCanvasTool 先例)", () => {
    const decl: CanvasActionPlugin<{ op: string }> = {
      id: "builtin:edit",
      label: "编辑",
      match: () => 10,
      buildArgs: () => ({ image: "img" }),
      execution: { via: "prompt", buildOp: (args) => ({ op: JSON.stringify(args) }) },
    };
    expect(defineCanvasAction(decl)).toBe(decl);
  });
});
