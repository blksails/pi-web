/**
 * generate-actions — 六内置生成动作插件的奇偶校验(task 3.1,Req 2.1/2.2/2.3/2.6)。
 *
 * 决策守恒(2.2/2.3):对输入矩阵穷举分支边界(hasExpand/hasMask/referenceIds/variants/
 * prompt/size/model 的代表性组合,含优先级压制),断言 resolveAction(BUILTIN_GENERATE_ACTIONS)
 * 的胜者动作与 args 与黄金基准 decideGenerate(HEAD 语义,直接调现导出对照)逐项相等。
 * buildOp 守恒:插件 buildOp 产出与 buildSurfaceOp(decision,{maskId}) 逐字节相等(mask 经
 * args.mask 透传约定)。capability 白名单不影响内置六 prompt 动作评分(2.6 退化契约边界)。
 */
import { describe, it, expect } from "vitest";
import {
  decideGenerate,
  buildSurfaceOp,
  type GenerateDecision,
  type GenerateDecisionInput,
} from "../src/canvas-workbench.js";
import {
  BUILTIN_GENERATE_ACTIONS,
  registerBuiltinGenerateActions,
  toGenerateDecision,
} from "../src/generate-actions.js";
import {
  resolveAction,
  createCanvasRegistry,
  type ActionInput,
  type CanvasCapability,
} from "@blksails/pi-web-canvas-kit";

// 空能力清单常量(退化路径喂入;内置六动作 via:"prompt" 不受白名单门控)。
const EMPTY_CAP: CanvasCapability = { models: [], sizes: [], actions: [] };

// 期望标签(ACTION_LABEL 逐字;HEAD canvas-workbench.tsx)。
const EXPECTED_LABEL: Record<GenerateDecision["action"], string> = {
  outpaint: "扩图",
  inpaint: "局部重绘",
  reference: "融合生成",
  variants: "生成变体",
  reframe: "重构比例",
  edit: "生成",
};

/** 内置插件 id → 动作(toGenerateDecision 映射的逆检查基线)。 */
const ID_BY_ACTION: Record<GenerateDecision["action"], string> = {
  outpaint: "builtin:outpaint",
  inpaint: "builtin:inpaint",
  reference: "builtin:reference",
  variants: "builtin:variants",
  reframe: "builtin:reframe",
  edit: "builtin:edit",
};

type InputPartial = Partial<ActionInput>;

/** 补全 ActionInput(缺省 = 兜底 edit 场景)。 */
function makeInput(p: InputPartial): ActionInput {
  return {
    imageId: p.imageId ?? "att_src",
    prompt: p.prompt ?? "一只猫",
    model: p.model ?? "",
    size: p.size ?? "",
    variants: p.variants ?? 1,
    hasMask: p.hasMask ?? false,
    hasExpand: p.hasExpand ?? false,
    referenceIds: p.referenceIds ?? [],
    capability: p.capability ?? EMPTY_CAP,
  };
}

/** ActionInput → 黄金基准 decideGenerate 的输入(字段逐项一致)。 */
function toDecisionInput(i: ActionInput): GenerateDecisionInput {
  return {
    imageId: i.imageId,
    prompt: i.prompt,
    model: i.model,
    size: i.size,
    variants: i.variants,
    hasMask: i.hasMask,
    hasExpand: i.hasExpand,
    referenceIds: i.referenceIds,
  };
}

// 输入矩阵:穷举六分支边界 + 优先级压制的代表性组合(每条附意图)。
const MATRIX: ReadonlyArray<{ readonly name: string; readonly input: InputPartial }> = [
  // ── edit 兜底 ──
  { name: "edit: 有 prompt 无一切特殊", input: { prompt: "调亮一点" } },
  { name: "edit: prompt+model+size 非空 variants=1", input: { prompt: "调亮", model: "gpt-image-2", size: "1024x1024" } },
  { name: "edit: prompt 空 size 空(reframe 不成立)", input: { prompt: "", size: "" } },
  { name: "edit: prompt 仅空白 size 空", input: { prompt: "   ", size: "" } },
  // ── reframe(prompt 空 && size 非空)──
  { name: "reframe: prompt 空 size 非空", input: { prompt: "", size: "1024x1024" } },
  { name: "reframe: prompt 空白 size 非空 + model", input: { prompt: "  ", size: "720x1280", model: "wan2.7" } },
  // ── variants(variants>=2)──
  { name: "variants: variants=2", input: { prompt: "换背景", variants: 2 } },
  { name: "variants: variants=4 + model + size", input: { prompt: "x", variants: 4, model: "m1", size: "1536x1024" } },
  // ── reference(referenceIds 非空)──
  { name: "reference: 单引用 variants=1(无 n)", input: { referenceIds: ["att_a"] } },
  { name: "reference: 双引用 variants=3(带 n)", input: { referenceIds: ["att_a", "att_b"], variants: 3 } },
  { name: "reference: 引用 + model 空 size 空", input: { referenceIds: ["att_r"], model: "", size: "" } },
  // ── inpaint(hasMask)──
  { name: "inpaint: hasMask", input: { hasMask: true, prompt: "填补" } },
  { name: "inpaint: hasMask + model + size", input: { hasMask: true, model: "m2", size: "1024x1024" } },
  // ── outpaint(hasExpand;删 size)──
  { name: "outpaint: hasExpand size 非空(应删 size)", input: { hasExpand: true, size: "1024x1024", prompt: "扩展" } },
  { name: "outpaint: hasExpand size 空 + model", input: { hasExpand: true, size: "", model: "m3" } },
  // ── 优先级压制 ──
  { name: "压制: outpaint > inpaint(两真)", input: { hasExpand: true, hasMask: true, size: "1024x1024" } },
  { name: "压制: inpaint > reference", input: { hasMask: true, referenceIds: ["att_a"] } },
  { name: "压制: reference > variants(带 n)", input: { referenceIds: ["att_a"], variants: 2 } },
  { name: "压制: variants > reframe", input: { prompt: "", size: "1024x1024", variants: 2 } },
  { name: "压制: outpaint 压制全部", input: { hasExpand: true, hasMask: true, referenceIds: ["att_a"], variants: 2, size: "512x512" } },
];

describe("BUILTIN_GENERATE_ACTIONS · 决策守恒(与 decideGenerate 逐项相等)", () => {
  for (const { name, input } of MATRIX) {
    it(name, () => {
      const i = makeInput(input);
      const resolved = resolveAction(BUILTIN_GENERATE_ACTIONS, i);
      expect(resolved).not.toBeNull();
      const expected = decideGenerate(toDecisionInput(i));

      // 胜者插件 id 映射回动作 = 黄金动作种类。
      expect(resolved!.plugin.id).toBe(ID_BY_ACTION[expected.action]);
      expect(toGenerateDecision(resolved!.plugin.id, resolved!.args).action).toBe(expected.action);

      // args 与黄金基准逐项相等。
      expect(resolved!.args).toEqual(expected.args);

      // 标签逐字。
      expect(resolved!.plugin.label).toBe(EXPECTED_LABEL[expected.action]);
    });
  }
});

describe("BUILTIN_GENERATE_ACTIONS · buildOp 守恒(与 buildSurfaceOp 逐字节相等)", () => {
  const pluginById = (id: string) => {
    const p = BUILTIN_GENERATE_ACTIONS.find((a) => a.id === id);
    if (p === undefined) throw new Error(`missing plugin ${id}`);
    if (p.execution.via !== "prompt") throw new Error(`${id} not prompt channel`);
    return p;
  };

  it("六内置动作 execution 全为 prompt 通道", () => {
    for (const p of BUILTIN_GENERATE_ACTIONS) {
      expect(p.execution.via).toBe("prompt");
    }
  });

  // 代表性 decision(含 inpaint+mask):插件 buildOp 与 buildSurfaceOp 逐字节相等。
  const cases: ReadonlyArray<{ input: InputPartial; maskId?: string }> = [
    { input: { prompt: "调亮", model: "m1", size: "1024x1024" } }, // edit
    { input: { prompt: "", size: "1024x1024" } }, // reframe
    { input: { prompt: "x", variants: 3, model: "m2" } }, // variants
    { input: { referenceIds: ["att_a", "att_b"], variants: 2, model: "m3" } }, // reference(带 n)
    { input: { referenceIds: ["att_r"] } }, // reference(无 n)
    { input: { hasMask: true, prompt: "填补", size: "1024x1024" }, maskId: "att_mask" }, // inpaint + mask
    { input: { hasMask: true, prompt: "填补" }, maskId: "att_mask" }, // inpaint + mask 无 size
    { input: { hasExpand: true, size: "1024x1024" }, maskId: "att_mask" }, // outpaint + mask(删 size)
    { input: { hasExpand: true, model: "m4" } }, // outpaint 无 mask
  ];

  for (const [idx, { input, maskId }] of cases.entries()) {
    it(`case #${idx} buildOp == buildSurfaceOp`, () => {
      const i = makeInput(input);
      const decision = decideGenerate(toDecisionInput(i));
      const plugin = pluginById(ID_BY_ACTION[decision.action]);
      // 调用方编排:掩码资产经 args.mask 透传(workbench 上传后补充)。
      const opArgs =
        maskId !== undefined ? { ...decision.args, mask: maskId } : { ...decision.args };
      if (plugin.execution.via !== "prompt") throw new Error("unreachable");
      const got = plugin.execution.buildOp(opArgs, i);
      const expected =
        maskId !== undefined ? buildSurfaceOp(decision, { maskId }) : buildSurfaceOp(decision);
      expect(got).toEqual(expected);
    });
  }
});

describe("toGenerateDecision · id → 动作映射", () => {
  it("六 id 逐一映射为对应动作,args 透传", () => {
    const args = { image: "att_x", prompt: "p" };
    for (const action of Object.keys(ID_BY_ACTION) as GenerateDecision["action"][]) {
      const d = toGenerateDecision(ID_BY_ACTION[action], args);
      expect(d.action).toBe(action);
      expect(d.args).toBe(args); // 透传(同引用)
    }
  });
});

describe("capability 白名单不影响内置六动作评分(2.6 退化边界)", () => {
  it("空清单与含 actions 白名单产出同一胜者", () => {
    const partials: InputPartial[] = [
      { hasMask: true },
      { referenceIds: ["att_a"], variants: 2 },
      { hasExpand: true, size: "1024x1024" },
      { prompt: "调亮" },
    ];
    for (const p of partials) {
      const empty = resolveAction(BUILTIN_GENERATE_ACTIONS, makeInput({ ...p, capability: EMPTY_CAP }));
      const populated = resolveAction(
        BUILTIN_GENERATE_ACTIONS,
        makeInput({
          ...p,
          capability: { models: [], sizes: [], actions: ["edit", "inpaint", "reference"] },
        }),
      );
      expect(empty!.plugin.id).toBe(populated!.plugin.id);
      expect(empty!.args).toEqual(populated!.args);
    }
  });
});

describe("registerBuiltinGenerateActions · 注册与聚合退订", () => {
  it("注册六动作(注册序稳定),退订清空", () => {
    const reg = createCanvasRegistry();
    const off = registerBuiltinGenerateActions(reg);
    expect(reg.actions.map((a) => a.id)).toEqual([
      "builtin:outpaint",
      "builtin:inpaint",
      "builtin:reference",
      "builtin:variants",
      "builtin:reframe",
      "builtin:edit",
    ]);
    expect(reg.diagnostics).toHaveLength(0);
    off();
    expect(reg.actions).toHaveLength(0);
  });

  it("聚合退订幂等(二次调用无副作用)", () => {
    const reg = createCanvasRegistry();
    const off = registerBuiltinGenerateActions(reg);
    off();
    off();
    expect(reg.actions).toHaveLength(0);
  });
});
