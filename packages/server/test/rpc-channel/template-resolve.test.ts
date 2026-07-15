/**
 * resolveSandboxTemplate 单元测试(spec sandbox-baked-agent-image,任务 2.2;Req 3.1-3.4)。
 *
 * 纯函数:覆盖四级解析路径(显式映射 → 门控派生 → 全局 → 清晰错误)、map 键两级查找
 * (先 exact rawSource 串,再 policySource)、map 值 `derive:<tag>` 形式归入派生级、
 * 派生门控开关、缺 tag 跳过派生级、错误文案(三种修复路径 + policySource)断言,
 * 以及 via 标记(map/derived/global)。
 */
import { describe, it, expect } from "vitest";
import {
  resolveSandboxTemplate,
  templateResolveMissingMessage,
  type TemplateResolveInput,
} from "../../src/rpc-channel/template-resolve.js";
import { deriveTemplateName } from "../../src/sandbox-image/template-name.js";
import { E2B_CONFIG_MISSING_MESSAGE } from "../../src/rpc-channel/e2b-config.js";

/** 便捷构造:env 快照恒含 E2B_API_KEY(前置条件:e2b 配置已可解析)。 */
function input(
  env: Record<string, string | undefined>,
  source: TemplateResolveInput["source"] = { policySource: "/abs/agents/demo" },
): TemplateResolveInput {
  return { source, env: { E2B_API_KEY: "k", ...env } };
}

describe("resolveSandboxTemplate — ①显式映射 (Req 3.2/3.3)", () => {
  it("map 命中 policySource → ok + via=map", () => {
    const res = resolveSandboxTemplate(
      input({
        PI_WEB_E2B_TEMPLATE_MAP: JSON.stringify({ "/abs/agents/demo": "tmpl-demo" }),
      }),
    );
    expect(res).toEqual({ ok: true, template: "tmpl-demo", via: "map" });
  });

  it("map 两级查找:先 exact rawSource 串,再 policySource(rawSource 键优先)", () => {
    const res = resolveSandboxTemplate(
      input(
        {
          PI_WEB_E2B_TEMPLATE_MAP: JSON.stringify({
            "./agents/demo": "tmpl-raw",
            "/abs/agents/demo": "tmpl-policy",
          }),
        },
        { policySource: "/abs/agents/demo", rawSource: "./agents/demo" },
      ),
    );
    expect(res).toEqual({ ok: true, template: "tmpl-raw", via: "map" });
  });

  it("rawSource 未命中时回落 policySource 键", () => {
    const res = resolveSandboxTemplate(
      input(
        {
          PI_WEB_E2B_TEMPLATE_MAP: JSON.stringify({ "/abs/agents/demo": "tmpl-policy" }),
        },
        { policySource: "/abs/agents/demo", rawSource: "./agents/demo" },
      ),
    );
    expect(res).toEqual({ ok: true, template: "tmpl-policy", via: "map" });
  });

  it("map 命中优先于派生与全局(解析序第一级)", () => {
    const res = resolveSandboxTemplate(
      input({
        PI_WEB_E2B_TEMPLATE_MAP: JSON.stringify({ "/abs/agents/demo": "tmpl-map" }),
        PI_WEB_E2B_TEMPLATE_DERIVE: "1",
        PI_WEB_E2B_TEMPLATE_DERIVE_TAG: "v1",
        PI_WEB_E2B_TEMPLATE: "tmpl-global",
      }),
    );
    expect(res).toEqual({ ok: true, template: "tmpl-map", via: "map" });
  });
});

describe("resolveSandboxTemplate — ②门控派生 (Req 3.2/3.3)", () => {
  const source = { policySource: "/abs/agents/demo" } as const;

  it("门控开启 + PI_WEB_E2B_TEMPLATE_DERIVE_TAG → deriveTemplateName,via=derived", () => {
    const res = resolveSandboxTemplate(
      input(
        { PI_WEB_E2B_TEMPLATE_DERIVE: "1", PI_WEB_E2B_TEMPLATE_DERIVE_TAG: "v1" },
        source,
      ),
    );
    expect(res).toEqual({
      ok: true,
      template: deriveTemplateName(source, "v1"),
      via: "derived",
    });
  });

  it("map 值 derive:<tag> 形式归入派生级:门控开启时用该 tag 派生,via=derived", () => {
    const res = resolveSandboxTemplate(
      input(
        {
          PI_WEB_E2B_TEMPLATE_MAP: JSON.stringify({ "/abs/agents/demo": "derive:v2" }),
          PI_WEB_E2B_TEMPLATE_DERIVE: "1",
        },
        source,
      ),
    );
    expect(res).toEqual({
      ok: true,
      template: deriveTemplateName(source, "v2"),
      via: "derived",
    });
  });

  it("map 值 derive:<tag> 的 tag 优先于 PI_WEB_E2B_TEMPLATE_DERIVE_TAG", () => {
    const res = resolveSandboxTemplate(
      input(
        {
          PI_WEB_E2B_TEMPLATE_MAP: JSON.stringify({ "/abs/agents/demo": "derive:map-tag" }),
          PI_WEB_E2B_TEMPLATE_DERIVE: "1",
          PI_WEB_E2B_TEMPLATE_DERIVE_TAG: "env-tag",
        },
        source,
      ),
    );
    expect(res).toEqual({
      ok: true,
      template: deriveTemplateName(source, "map-tag"),
      via: "derived",
    });
  });

  it("门控关闭时派生级不参与:map 值 derive:<tag> 被跳过,回落全局", () => {
    const res = resolveSandboxTemplate(
      input(
        {
          PI_WEB_E2B_TEMPLATE_MAP: JSON.stringify({ "/abs/agents/demo": "derive:v2" }),
          PI_WEB_E2B_TEMPLATE: "tmpl-global",
        },
        source,
      ),
    );
    expect(res).toEqual({ ok: true, template: "tmpl-global", via: "global" });
  });

  it("门控关闭时 PI_WEB_E2B_TEMPLATE_DERIVE_TAG 单独存在也不参与,回落全局", () => {
    const res = resolveSandboxTemplate(
      input(
        { PI_WEB_E2B_TEMPLATE_DERIVE_TAG: "v1", PI_WEB_E2B_TEMPLATE: "tmpl-global" },
        source,
      ),
    );
    expect(res).toEqual({ ok: true, template: "tmpl-global", via: "global" });
  });

  it("门控开启但取不到 tag → 跳过派生级,回落全局", () => {
    const res = resolveSandboxTemplate(
      input(
        { PI_WEB_E2B_TEMPLATE_DERIVE: "1", PI_WEB_E2B_TEMPLATE: "tmpl-global" },
        source,
      ),
    );
    expect(res).toEqual({ ok: true, template: "tmpl-global", via: "global" });
  });

  it("map 值 derive: 后 tag 为空 → 回落 PI_WEB_E2B_TEMPLATE_DERIVE_TAG", () => {
    const res = resolveSandboxTemplate(
      input(
        {
          PI_WEB_E2B_TEMPLATE_MAP: JSON.stringify({ "/abs/agents/demo": "derive:  " }),
          PI_WEB_E2B_TEMPLATE_DERIVE: "1",
          PI_WEB_E2B_TEMPLATE_DERIVE_TAG: "env-tag",
        },
        source,
      ),
    );
    expect(res).toEqual({
      ok: true,
      template: deriveTemplateName(source, "env-tag"),
      via: "derived",
    });
  });

  it("map 值 derive: 后 tag 为空且无 DERIVE_TAG → 派生级整体跳过(缺 tag 跳过)", () => {
    const res = resolveSandboxTemplate(
      input(
        {
          PI_WEB_E2B_TEMPLATE_MAP: JSON.stringify({ "/abs/agents/demo": "derive:" }),
          PI_WEB_E2B_TEMPLATE_DERIVE: "1",
          PI_WEB_E2B_TEMPLATE: "tmpl-global",
        },
        source,
      ),
    );
    expect(res).toEqual({ ok: true, template: "tmpl-global", via: "global" });
  });
});

describe("resolveSandboxTemplate — ③全局模板 (Req 3.3 向后兼容)", () => {
  it("map/derive 均未配时,仅全局模板 → via=global(既有单模板部署零变化)", () => {
    const res = resolveSandboxTemplate(input({ PI_WEB_E2B_TEMPLATE: "piweb-demo" }));
    expect(res).toEqual({ ok: true, template: "piweb-demo", via: "global" });
  });

  it("map 配置了但键未命中当前 source → 回落全局", () => {
    const res = resolveSandboxTemplate(
      input({
        PI_WEB_E2B_TEMPLATE_MAP: JSON.stringify({ "/other/agent": "tmpl-other" }),
        PI_WEB_E2B_TEMPLATE: "tmpl-global",
      }),
    );
    expect(res).toEqual({ ok: true, template: "tmpl-global", via: "global" });
  });
});

describe("resolveSandboxTemplate — ④全空清晰错误 (Req 3.4)", () => {
  it("三级全空 → ok:false,错误文案 = 集中常量(含 policySource)", () => {
    const res = resolveSandboxTemplate(input({}, { policySource: "/abs/agents/demo" }));
    expect(res).toEqual({
      ok: false,
      error: templateResolveMissingMessage("/abs/agents/demo"),
    });
  });

  it("错误文案含三种修复路径与当前 policySource", () => {
    const msg = templateResolveMissingMessage("/abs/agents/demo");
    expect(msg).toContain("/abs/agents/demo");
    expect(msg).toContain("PI_WEB_E2B_TEMPLATE_MAP");
    expect(msg).toContain("PI_WEB_E2B_TEMPLATE_DERIVE");
    expect(msg).toContain("PI_WEB_E2B_TEMPLATE");
  });

  it("门控开启但缺 tag 且无 map/全局 → 仍为携指引错误(不静默回退)", () => {
    const res = resolveSandboxTemplate(
      input({ PI_WEB_E2B_TEMPLATE_DERIVE: "1" }, { policySource: "/abs/agents/demo" }),
    );
    expect(res).toEqual({
      ok: false,
      error: templateResolveMissingMessage("/abs/agents/demo"),
    });
  });
});

describe("resolveSandboxTemplate — 前置条件与错误传播", () => {
  it("env 快照缺 E2B_API_KEY → 传播 e2b-config 的既有清晰错误(复用同一解析,不静默)", () => {
    expect(() =>
      resolveSandboxTemplate({
        source: { policySource: "/abs/agents/demo" },
        env: { PI_WEB_E2B_TEMPLATE: "t" },
      }),
    ).toThrow(E2B_CONFIG_MISSING_MESSAGE);
  });

  it("PI_WEB_E2B_TEMPLATE_MAP 非法 JSON → 传播 e2b-config 的 fail-fast 错误", () => {
    expect(() =>
      resolveSandboxTemplate(input({ PI_WEB_E2B_TEMPLATE_MAP: "{oops" })),
    ).toThrow(/PI_WEB_E2B_TEMPLATE_MAP/);
  });
});
