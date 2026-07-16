/**
 * aigc-proxy · provider 登记表单元测试(Req 2.2)。
 *
 * 断言:
 * - 三个已登记 provider(newapi/sufy/dashscope)查表命中,返回的 upstreamBase/keyEnv 与
 *   design.md 声明的静态值一致;
 * - 未知 provider id 查表返回 undefined(不抛);
 * - 登记表中的 upstreamBase 与 tool-kit 对应 provider 源文件里的字面量/占位默认值一致
 *   (revalidation trigger:两处同改)——从源文件文本中提取，避免测试写死重复真源。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lookupProvider } from "../../src/aigc-proxy/provider-registry.js";

/**
 * 从 tool-kit provider 源文件文本中提取 upstreamBase 的期望值。
 *
 * 兼容两种形态(design.md 2.3 任务可能并行把裸字面量改成占位默认值):
 * - 裸字面量:`"https://example.com/v1"`
 * - 占位默认值:`"${X_BASE_URL:-https://example.com/v1}"`
 *
 * 两种形态下,真实 URL 本身都会原样出现在源文件文本中,因此断言改为:
 * 登记表的 upstreamBase 值必须是源文件文本的子串。
 */
function toolKitSourceText(relativePath: string): string {
  const url = new URL(`../../../tool-kit/src/aigc/providers/${relativePath}`, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf8");
}

describe("lookupProvider", () => {
  it("newapi 命中且字段正确", () => {
    const entry = lookupProvider("newapi");
    expect(entry).toEqual({
      upstreamBase: "https://www.apiservices.top/v1",
      keyEnv: "NEWAPI_API_KEY",
    });
  });

  it("sufy 命中且字段正确", () => {
    const entry = lookupProvider("sufy");
    expect(entry).toEqual({
      upstreamBase: "https://openai.sufy.com/v1",
      keyEnv: "SUFY_API_KEY",
    });
  });

  it("dashscope 命中且字段正确", () => {
    const entry = lookupProvider("dashscope");
    expect(entry).toEqual({
      upstreamBase: "https://dashscope.aliyuncs.com/api/v1",
      keyEnv: "DASHSCOPE_API_KEY",
    });
  });

  it("未知 provider 返回 undefined", () => {
    expect(lookupProvider("unknown-provider")).toBeUndefined();
    expect(lookupProvider("")).toBeUndefined();
  });

  it("upstreamBase 与 tool-kit 源文件字面量/占位默认值逐字一致", () => {
    const newapiEntry = lookupProvider("newapi");
    const sufyEntry = lookupProvider("sufy");
    const dashscopeEntry = lookupProvider("dashscope");
    expect(newapiEntry).toBeDefined();
    expect(sufyEntry).toBeDefined();
    expect(dashscopeEntry).toBeDefined();

    expect(toolKitSourceText("newapi.ts")).toContain(newapiEntry!.upstreamBase);
    expect(toolKitSourceText("sufy.ts")).toContain(sufyEntry!.upstreamBase);
    expect(toolKitSourceText("dashscope.ts")).toContain(dashscopeEntry!.upstreamBase);
  });
});
