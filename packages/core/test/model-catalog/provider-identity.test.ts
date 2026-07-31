/**
 * provider-identity 单元测试(spec: multi-gateway-providers,任务 1.1;Req 1.4, 2.2, 7.6, 9.3)。
 *
 * 完成判据(tasks.md):
 * - 「两来源同名返回全部冲突」——`findProviderIdConflicts`
 * - 「归一幂等」——`normalizeLegacyProviderId`
 * 另覆盖形态校验与保留名冲突(Req 2.2/7.6)以证明 validate 的两层判据均生效。
 */
import { describe, it, expect } from "vitest";
import {
  validateProviderId,
  findProviderIdConflicts,
  normalizeLegacyProviderId,
  RESERVED_PROVIDER_IDS,
} from "../../src/model-catalog/provider-identity.js";

describe("validateProviderId — 形态合法性", () => {
  it("小写字母、数字、连字符组合的 id 合法", () => {
    for (const raw of ["blksails-ai", "qiniu", "cloudflare2", "a-b-c-1"]) {
      const result = validateProviderId(raw);
      expect(result.ok).toBe(true);
    }
  });

  it("空字符串不合法", () => {
    const result = validateProviderId("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/不能为空/);
  });

  it("含大写字母不合法", () => {
    const result = validateProviderId("BlkSails");
    expect(result.ok).toBe(false);
  });

  it("含非法字符(下划线/空格/斜杠)不合法", () => {
    for (const raw of ["blk_sails", "blk sails", "blk/sails", "blk.sails"]) {
      const result = validateProviderId(raw);
      expect(result.ok).toBe(false);
    }
  });

  it("以连字符起始或结尾不合法", () => {
    for (const raw of ["-blksails", "blksails-", "-blksails-"]) {
      const result = validateProviderId(raw);
      expect(result.ok).toBe(false);
    }
  });

  it("合法通过时返回可用作 ProviderId 的品牌化值", () => {
    const result = validateProviderId("blksails-ai");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.id).toBe("blksails-ai");
  });
});

describe("validateProviderId — 保留名冲突(Req 2.2/7.6)", () => {
  it("与 pi SDK 内置 provider 同名的自定义标识被拒绝", () => {
    for (const raw of ["openai", "anthropic", "google", "openrouter"]) {
      expect(RESERVED_PROVIDER_IDS.has(raw)).toBe(true);
      const result = validateProviderId(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/内置 provider 同名/);
    }
  });

  it("Cloudflare AI Gateway 与 BlackSail 自建网关(blksails-ai)各自独立且不落入保留名(Req 2.2)", () => {
    // blksails-ai 是本特性新引入的自建网关实例标识,不应与 pi SDK 的
    // cloudflare-ai-gateway 混同,也不应被保留名清单误伤。
    expect(RESERVED_PROVIDER_IDS.has("blksails-ai")).toBe(false);
    expect(RESERVED_PROVIDER_IDS.has("cloudflare-ai-gateway")).toBe(true);
    expect(validateProviderId("blksails-ai").ok).toBe(true);
  });

  it("非保留名的自定义标识不受影响", () => {
    expect(validateProviderId("qiniu").ok).toBe(true);
  });
});

describe("findProviderIdConflicts — 两来源同名返回全部冲突(Req 1.4)", () => {
  it("两个来源声明同一 id 时,冲突项携带全部来源而非只报一个", () => {
    const conflicts = findProviderIdConflicts([
      { id: "blksails-ai", source: "gateway-instance:primary" },
      { id: "blksails-ai", source: "custom-provider:user-defined" },
    ]);
    expect(conflicts).toHaveLength(1);
    const [conflict] = conflicts;
    expect(conflict?.id).toBe("blksails-ai");
    expect(conflict?.sources).toEqual([
      "gateway-instance:primary",
      "custom-provider:user-defined",
    ]);
  });

  it("三个来源同名时,单条冲突项汇总全部三个来源(不止停在前两个)", () => {
    const conflicts = findProviderIdConflicts([
      { id: "dup", source: "a" },
      { id: "dup", source: "b" },
      { id: "dup", source: "c" },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.sources).toEqual(["a", "b", "c"]);
  });

  it("多个不同 id 各自冲突时,全部冲突项均被返回(不是遇到第一个即停)", () => {
    const conflicts = findProviderIdConflicts([
      { id: "dup-a", source: "s1" },
      { id: "dup-a", source: "s2" },
      { id: "unique", source: "s3" },
      { id: "dup-b", source: "s4" },
      { id: "dup-b", source: "s5" },
    ]);
    const ids = conflicts.map((c) => c.id).sort();
    expect(ids).toEqual(["dup-a", "dup-b"]);
  });

  it("不冲突的 id(仅出现一次)不出现在结果中", () => {
    const conflicts = findProviderIdConflicts([
      { id: "solo-a", source: "s1" },
      { id: "solo-b", source: "s2" },
    ]);
    expect(conflicts).toEqual([]);
  });

  it("空输入返回空集", () => {
    expect(findProviderIdConflicts([])).toEqual([]);
  });
});

describe("normalizeLegacyProviderId — 归一幂等(Req 9.3)", () => {
  it("无映射时原样返回", () => {
    expect(normalizeLegacyProviderId("qiniu")).toBe("qiniu");
  });

  it("单步映射:归一后的值等于目标标识", () => {
    const legacyMap = { "old-ai-gateway": "blksails-ai" };
    expect(normalizeLegacyProviderId("old-ai-gateway", legacyMap)).toBe("blksails-ai");
  });

  it("幂等:对已归一的结果再次归一,结果不变(单步映射)", () => {
    const legacyMap = { "old-ai-gateway": "blksails-ai" };
    const once = normalizeLegacyProviderId("old-ai-gateway", legacyMap);
    const twice = normalizeLegacyProviderId(once, legacyMap);
    expect(twice).toBe(once);
  });

  it("幂等:链式映射(a→b→c)一次性追至链尾,重复调用结果不再变化", () => {
    const legacyMap = { a: "b", b: "c" };
    const once = normalizeLegacyProviderId("a", legacyMap);
    expect(once).toBe("c");
    const twice = normalizeLegacyProviderId(once, legacyMap);
    expect(twice).toBe("c");
  });

  it("自环映射不死循环,原样返回", () => {
    const legacyMap = { "self-loop": "self-loop" };
    expect(normalizeLegacyProviderId("self-loop", legacyMap)).toBe("self-loop");
  });

  it("循环映射(a→b→a)不死循环,返回环上某一确定值", () => {
    const legacyMap = { a: "b", b: "a" };
    const result = normalizeLegacyProviderId("a", legacyMap);
    expect(["a", "b"]).toContain(result);
    // 幂等:同一映射下再次归一结果不变
    expect(normalizeLegacyProviderId(result, legacyMap)).toBe(result);
  });

  it("默认(无显式传入 legacyMap)使用模块内置表,当前无已知映射,原样返回", () => {
    expect(normalizeLegacyProviderId("ai-gateway")).toBe("ai-gateway");
  });
});
