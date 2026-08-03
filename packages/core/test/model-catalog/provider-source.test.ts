/**
 * provider-source 单元测试(spec: multi-gateway-providers,任务 1.3;Req 1.1, 1.3, 1.5,
 * 2.1, 2.3, 8.1, 8.2, 8.3)。
 *
 * 完成判据(tasks.md):
 * - 「单来源抛错不牵连其他来源」——`createProviderRegistry` 对抛错来源防御性 try/catch
 * - 「零来源输出为空」——与该来源不存在时逐字节一致(Req 8.2/10.1)
 * 另覆盖:多来源聚合、启用态过滤、按标识精确查找(含停用条目仍可查到)、
 * 标识冲突时抛出含全部冲突标识与来源的错误(Req 1.4 的组装期落地)。
 */
import { describe, it, expect, vi } from "vitest";
import {
  createProviderRegistry,
  ProviderIdConflictError,
  type ProviderSource,
  type ProviderDefinition,
} from "../../src/model-catalog/provider-source.js";

function makeSource(
  sourceId: string,
  definitions: readonly ProviderDefinition[],
): ProviderSource {
  return {
    sourceId,
    list: () => definitions,
  };
}

function makeDefinition(id: string, enabled = true): ProviderDefinition {
  return { id, enabled, models: [] };
}

describe("createProviderRegistry — 零来源", () => {
  it("未传入任何来源时,providers()/find() 的输出与该来源不存在时逐字节一致", () => {
    const registry = createProviderRegistry([]);
    expect(registry.providers()).toEqual([]);
    expect(registry.find("anything")).toBeUndefined();
  });
});

describe("createProviderRegistry — 单来源", () => {
  it("列出单个来源的全部 provider", () => {
    const registry = createProviderRegistry([
      makeSource("gateway:cloudflare", [makeDefinition("cloudflare"), makeDefinition("blksails-ai")]),
    ]);
    const ids = registry.providers().map((p) => p.id);
    expect(ids).toEqual(["cloudflare", "blksails-ai"]);
  });
});

describe("createProviderRegistry — 多来源聚合", () => {
  it("两个不同标识的来源分别列出,各自归属正确", () => {
    const registry = createProviderRegistry([
      makeSource("local-models", [makeDefinition("local")]),
      makeSource("gateway:cloudflare", [makeDefinition("cloudflare")]),
    ]);
    const ids = registry.providers().map((p) => p.id).sort();
    expect(ids).toEqual(["cloudflare", "local"]);
  });

  it("单来源抛错不牵连其他来源:一个来源意外抛错时,其余来源仍正常注册", () => {
    const brokenSource: ProviderSource = {
      sourceId: "broken",
      list: () => {
        throw new Error("拉取失败");
      },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = createProviderRegistry([
      brokenSource,
      makeSource("local-models", [makeDefinition("local")]),
    ]);
    expect(registry.providers().map((p) => p.id)).toEqual(["local"]);
    spy.mockRestore();
  });
});

describe("createProviderRegistry — 启用状态过滤", () => {
  it("providers() 只返回 enabled 的条目", () => {
    const registry = createProviderRegistry([
      makeSource("custom", [makeDefinition("on", true), makeDefinition("off", false)]),
    ]);
    expect(registry.providers().map((p) => p.id)).toEqual(["on"]);
  });

  it("find() 不受 enabled 过滤影响,停用的 provider 定义仍可查到(Req 7.5)", () => {
    const registry = createProviderRegistry([
      makeSource("custom", [makeDefinition("off", false)]),
    ]);
    expect(registry.providers()).toEqual([]);
    expect(registry.find("off")).toEqual({ id: "off", enabled: false, models: [] });
  });

  it("find() 对不存在的 id 返回 undefined", () => {
    const registry = createProviderRegistry([makeSource("custom", [makeDefinition("known")])]);
    expect(registry.find("unknown")).toBeUndefined();
  });
});

describe("createProviderRegistry — 标识冲突", () => {
  it("两个来源声明同一 id 时抛出含全部冲突标识与来源的错误", () => {
    let thrown: unknown;
    try {
      createProviderRegistry([
        makeSource("source-a", [makeDefinition("dup")]),
        makeSource("source-b", [makeDefinition("dup")]),
      ]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ProviderIdConflictError);
    const err = thrown as ProviderIdConflictError;
    expect(err.conflicts).toEqual([{ id: "dup", sources: ["source-a", "source-b"] }]);
  });

  it("同一来源内部不产生自冲突误报(单来源两个不同 id 不受影响)", () => {
    expect(() =>
      createProviderRegistry([
        makeSource("source-a", [makeDefinition("a"), makeDefinition("b")]),
      ]),
    ).not.toThrow();
  });
});
