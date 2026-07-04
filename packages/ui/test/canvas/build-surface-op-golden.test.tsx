/**
 * build-surface-op golden 哨兵(任务 4.1 · Req 8.2/8.3/3.2)。
 *
 * 从 `buildToolPrompt` 析出的 `buildSurfaceOp` + `renderSurfaceOp` 新管线,其渲染输出必须与
 * **迁移前** `buildToolPrompt` 捕获固化的 {@link GOLDEN_EXPECTED} 逐字节相等(`toBe` 全串)。
 * 期望值为写死字面量(不由迁移后代码生成),证明析出是纯薄包装、行为零漂移。
 *
 * 覆盖:六动作(edit/inpaint/reference/variants/reframe/outpaint)× mask/refs 有无组合,
 * 外加意图截断(>48)、最小(仅 image)、reframe 默认提示词等边界。
 */
import { describe, expect, it } from "vitest";
import { renderSurfaceOp } from "@blksails/pi-web-kit";
import {
  buildSurfaceOp,
  buildToolPrompt,
  decideGenerate,
  type GenerateDecisionInput,
} from "../../src/canvas/canvas-workbench.js";
import { GOLDEN_EXPECTED } from "./build-surface-op-fixtures.js";

const CASES: ReadonlyArray<{
  readonly name: string;
  readonly input: GenerateDecisionInput;
  readonly maskId?: string;
}> = [
  {
    name: "edit-full",
    input: {
      imageId: "att_img1",
      prompt: "给猫加一顶帽子",
      model: "gpt-image-2",
      hasMask: false,
      referenceIds: [],
      variants: 1,
      size: "1024x1024",
    },
  },
  {
    name: "edit-minimal",
    input: {
      imageId: "att_img1",
      prompt: "",
      model: "",
      hasMask: false,
      referenceIds: [],
      variants: 1,
      size: "",
    },
  },
  {
    name: "edit-longprompt",
    input: {
      imageId: "att_img1",
      prompt:
        "把这张照片改成赛博朋克风格的霓虹夜景并加入更多细节和光晕效果做到极致再补上远处的飞行汽车与巨型全息广告牌以及地面的积水倒影",
      model: "gpt-image-2",
      hasMask: false,
      referenceIds: [],
      variants: 1,
      size: "1024x1024",
    },
  },
  {
    name: "inpaint",
    input: {
      imageId: "att_base",
      prompt: "把背景换成海边",
      model: "gpt-image-2",
      hasMask: true,
      referenceIds: [],
      variants: 1,
      size: "",
    },
    maskId: "att_mask1",
  },
  {
    name: "reference",
    input: {
      imageId: "att_base",
      prompt: "融合两张风格",
      model: "gpt-image-2",
      hasMask: false,
      referenceIds: ["att_ref1", "att_ref2"],
      variants: 3,
      size: "1024x1024",
    },
  },
  {
    name: "reference-with-mask",
    input: {
      imageId: "att_base",
      prompt: "融合两张风格",
      model: "gpt-image-2",
      hasMask: false,
      referenceIds: ["att_ref1", "att_ref2"],
      variants: 3,
      size: "1024x1024",
    },
    maskId: "att_mask9",
  },
  {
    name: "variants",
    input: {
      imageId: "att_base",
      prompt: "多来几张",
      model: "gpt-image-2",
      hasMask: false,
      referenceIds: [],
      variants: 4,
      size: "1024x1024",
    },
  },
  {
    name: "reframe",
    input: {
      imageId: "att_base",
      prompt: "",
      model: "gpt-image-2",
      hasMask: false,
      referenceIds: [],
      variants: 1,
      size: "1792x1024",
    },
  },
  {
    name: "outpaint",
    input: {
      imageId: "att_canvas",
      prompt: "扩展画面",
      model: "gpt-image-2",
      hasExpand: true,
      hasMask: false,
      referenceIds: [],
      variants: 1,
      size: "1024x1024",
    },
    maskId: "att_expandmask",
  },
];

describe("buildSurfaceOp golden(迁移前 buildToolPrompt 逐字节对照)", () => {
  for (const c of CASES) {
    const opts = c.maskId !== undefined ? { maskId: c.maskId } : undefined;

    it(`${c.name}:renderSurfaceOp(buildSurfaceOp(...)) ≡ 固化 fixture`, () => {
      const d = decideGenerate(c.input);
      expect(renderSurfaceOp(buildSurfaceOp(d, opts))).toBe(GOLDEN_EXPECTED[c.name]);
    });

    it(`${c.name}:buildToolPrompt 薄包装 ≡ 固化 fixture`, () => {
      const d = decideGenerate(c.input);
      expect(buildToolPrompt(d, opts)).toBe(GOLDEN_EXPECTED[c.name]);
    });
  }
});
