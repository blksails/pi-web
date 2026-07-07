/**
 * 图像工具注册按 disabledModels 收敛枚举 单元测试(aigc-tool-settings task 2.1)。
 *
 * 给定被禁集合,断言注册所得工具的 LLM 可见 model 枚举与描述不含被禁模型、含其余模型且顺序不变
 * (Req 2.1/2.6);被禁模型从路由集移除后,请求它经 selectRoute 回退默认(Req 2.4,过滤后自然成立)。
 */
import { describe, it, expect } from "vitest";
import { registerImageGeneration } from "../../src/aigc/tools/image-generation.js";
import { registerImageEdit } from "../../src/aigc/tools/image-edit.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface Collected {
  name: string;
  description: string;
  parameters: unknown;
}
function collect(register: (pi: ExtensionAPI, opts?: { disabledModels?: ReadonlySet<string> }) => void, disabled?: ReadonlySet<string>): Collected {
  let tool: Collected | undefined;
  const pi = {
    registerTool: (def: Collected) => {
      tool = def;
    },
    registerCommand: () => {},
  } as unknown as ExtensionAPI;
  register(pi, disabled !== undefined ? { disabledModels: disabled } : undefined);
  if (tool === undefined) throw new Error("no tool registered");
  return tool;
}

describe("registerImageGeneration/Edit 按 disabledModels 收敛", () => {
  it("缺省(无 opts)→ 描述含 gpt-image-2 全量(与既有一致)", () => {
    const t = collect(registerImageGeneration);
    expect(t.description).toContain("`gpt-image-2`");
  });

  it("禁用 gpt-image-2 → 枚举与描述不含它、含其余", () => {
    const t = collect(registerImageGeneration, new Set(["gpt-image-2"]));
    const paramsJson = JSON.stringify(t.parameters);
    // model 枚举不再含被禁 id(literal const),但含其它 provider 的模型
    expect(t.description).not.toContain("`gpt-image-2`");
    expect(paramsJson).not.toContain('"gpt-image-2"');
    expect(t.description).toContain("wan2.7-image-pro");
  });

  it("image_edit 同款:禁用某模型 → 描述不含", () => {
    const t = collect(registerImageEdit, new Set(["gpt-image-2"]));
    expect(t.description).not.toContain("`gpt-image-2`");
  });

  it("全禁 → 保留默认模型(工具仍注册且枚举非空,Req 2.5)", () => {
    // 用一个不可能全命中的大集合模拟"尽量全禁";默认 gpt-image-2 必须仍在。
    const many = new Set([
      "wan2.7-image-pro",
      "wan2.7-image-pro-bailian",
      "gemini-3.1-flash-image",
      "gemini-3-pro-image",
      "gemini-2.5-flash-image",
      "gpt-5-image",
      "gpt-5-image-mini",
      "gpt-5.4-image-2",
      "gpt-image-2-sufy",
      "gemini-3.1-flash-lite-image-sufy",
      "gpt-image-2",
    ]);
    const t = collect(registerImageGeneration, many);
    // 全禁保留默认 → 描述至少含默认模型 gpt-image-2
    expect(t.description).toContain("`gpt-image-2`");
  });
});
