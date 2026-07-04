/**
 * model-catalog 与 ROUTES 一致性(sync)测试(aigc-tool-settings)。
 *
 * 纯 `AIGC_MODEL_CATALOG`(供 /settings 无会话态列举)必须与图像工具 ROUTES 的 gen∪edit 并集
 * 完全一致(model/label/provider),否则设置页列出的模型与工具实际暴露的模型漂移。本测试是
 * 唯一的防漂移守卫(catalog 是手写纯数据,不 import pi SDK 的 ROUTES)。
 */
import { describe, it, expect } from "vitest";
import { AIGC_MODEL_CATALOG } from "../../src/aigc/model-catalog.js";
import { IMAGE_GENERATION_ROUTES } from "../../src/aigc/tools/image-generation.js";
import { IMAGE_EDIT_ROUTES } from "../../src/aigc/tools/image-edit.js";

describe("AIGC_MODEL_CATALOG 与 ROUTES 一致", () => {
  // 与 publishAigcCatalog 同款:gen∪edit 并集,按 model 去重(首次出现取值)。
  const byModel = new Map<string, { label: string; provider?: string }>();
  for (const r of [...IMAGE_GENERATION_ROUTES, ...IMAGE_EDIT_ROUTES]) {
    if (!byModel.has(r.model)) byModel.set(r.model, { label: r.label, provider: r.provider });
  }

  it("catalog 的 model 集合 = ROUTES 并集(无缺无余)", () => {
    const catalogModels = AIGC_MODEL_CATALOG.map((e) => e.model).sort();
    const routeModels = [...byModel.keys()].sort();
    expect(catalogModels).toEqual(routeModels);
  });

  it("每个 catalog 条目的 label/provider 与对应 route 一致", () => {
    for (const entry of AIGC_MODEL_CATALOG) {
      const route = byModel.get(entry.model);
      expect(route, `catalog 含 ROUTES 外的 model: ${entry.model}`).toBeDefined();
      expect(entry.label).toBe(route?.label);
      expect(entry.provider).toBe(route?.provider);
    }
  });

  it("catalog 顺序 = gen∪edit 并集去重序(与 publishAigcCatalog 一致)", () => {
    expect(AIGC_MODEL_CATALOG.map((e) => e.model)).toEqual([...byModel.keys()]);
  });
});
