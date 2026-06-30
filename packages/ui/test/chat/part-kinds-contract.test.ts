/**
 * session-snapshot-authority(STEP4)— 协议契约测试:闭合 PART_KINDS(Req 6.1, 6.3, 6.5)。
 *
 * 遍历单一真相源断言三件事,使「孤儿渲染器」静态不可能:
 *   1. PART_KINDS 的键集 === wire 层 DataPartSchema 判别联合的 type 集(协议↔单一真相源对齐)。
 *   2. 每个 consume:"registry" 的 kind 都在前端渲染器映射中存在(无孤儿渲染器)。
 *   3. 前端渲染器映射的键集精确等于 REGISTRY_PART_KINDS(无多余/无遗漏;负向自检)。
 */
import { describe, it, expect } from "vitest";
import type { ZodLiteral, ZodObject, ZodRawShape } from "zod";
import {
  DataPartSchema,
  PART_KINDS,
  REGISTRY_PART_KINDS,
} from "@blksails/pi-web-protocol";
import { BUILTIN_DATA_PART_RENDERERS } from "../../src/chat/builtin-data-part-renderers.js";

/** 从 DataPartSchema 判别联合各成员抽取 `type` 字面量值。 */
function wireDiscriminators(): Set<string> {
  const options = (
    DataPartSchema as unknown as { options: ZodObject<ZodRawShape>[] }
  ).options;
  return new Set(
    options.map((opt) => {
      const lit = opt.shape.type as unknown as ZodLiteral<string>;
      return lit.value;
    }),
  );
}

describe("PART_KINDS contract (闭合协议契约)", () => {
  it("PART_KINDS keys exactly match the wire DataPart discriminators", () => {
    expect(new Set(Object.keys(PART_KINDS))).toEqual(wireDiscriminators());
  });

  it("every registry-rendered kind has a registered renderer (no orphan)", () => {
    for (const kind of REGISTRY_PART_KINDS) {
      expect(
        BUILTIN_DATA_PART_RENDERERS[kind as keyof typeof BUILTIN_DATA_PART_RENDERERS],
      ).toBeDefined();
    }
  });

  it("renderer map keys are exactly the registry kinds (no extra / no missing)", () => {
    expect(new Set(Object.keys(BUILTIN_DATA_PART_RENDERERS))).toEqual(
      new Set(REGISTRY_PART_KINDS),
    );
  });

  it("registry kinds are a subset declared as consume:registry in the single source", () => {
    for (const kind of REGISTRY_PART_KINDS) {
      expect(PART_KINDS[kind].consume).toBe("registry");
    }
  });
});
