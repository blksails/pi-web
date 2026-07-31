/**
 * aigc-model-meta — provider 徽章表与显示名规则测试。
 *
 * ★ 本套件的核心是最后那组**覆盖率断言**:PROVIDER_META 是徽章的准入闸门,
 * `ProviderBadge` 对表中没有的 provider 直接返回 null。新增 provider 时若忘了在此登记,
 * 模型在选择器里会表现为「纯文字、无色块、且保留冗余的 ` · xxx` 后缀」,而**所有既有测试
 * 依然全绿**——ai-gateway 与 cloudflare 两条通路就是这么漏掉的(2026-07-29 用户截图发现)。
 * 交叉断言把「目录里出现的 provider」与「徽章表登记的 provider」绑在一起,下次漏登记即红。
 */
import { describe, it, expect } from "vitest";
import {
  AIGC_MODEL_CATALOG,
  AI_GATEWAY_AIGC_CATALOG,
  CLOUDFLARE_AIGC_CATALOG,
} from "@blksails/pi-web-tool-kit";
import { PROVIDER_META, displayNameOf } from "../src/aigc-model-meta.js";

describe("PROVIDER_META", () => {
  it("字母互不冲突(徽章靠字母区分)", () => {
    const letters = Object.values(PROVIDER_META).map((m) => m.letter);
    expect(new Set(letters).size).toBe(letters.length);
  });

  it("每项都有非空 letter / name / bg 色值", () => {
    for (const [id, m] of Object.entries(PROVIDER_META)) {
      expect(m.letter, `${id}.letter`).toMatch(/^\S+$/);
      expect(m.name, `${id}.name`).toMatch(/\S/);
      expect(m.bg, `${id}.bg`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("ai-gateway 与 cloudflare 是两条不同通路,元数据不得相同", () => {
    const gw = PROVIDER_META["ai-gateway"];
    const cf = PROVIDER_META["cloudflare"];
    expect(gw).toBeDefined();
    expect(cf).toBeDefined();
    expect(gw?.letter).not.toBe(cf?.letter);
    expect(gw?.bg).not.toBe(cf?.bg);
  });
});

describe("displayNameOf — 冗余后缀剥离", () => {
  it("后缀为展示名时剥离(既有行为)", () => {
    expect(displayNameOf("GPT Image 2 · NewAPI", "newapi")).toBe("GPT Image 2");
    expect(displayNameOf("GPT Image 2 · sufy", "sufy")).toBe("GPT Image 2");
  });

  it("★ 后缀写的是 provider id 时同样剥离(ai-gateway 的 label 即如此)", () => {
    expect(displayNameOf("GPT Image 1 · ai-gateway", "ai-gateway")).toBe("GPT Image 1");
    expect(displayNameOf("Qwen Image · ai-gateway", "ai-gateway")).toBe("Qwen Image");
  });

  it("Cloudflare 后缀剥离", () => {
    expect(displayNameOf("GPT Image 2 · Cloudflare", "cloudflare")).toBe("GPT Image 2");
    expect(displayNameOf("FLUX.1 schnell · Cloudflare", "cloudflare")).toBe("FLUX.1 schnell");
  });

  it("非 provider 名的有意义后缀必须保留", () => {
    expect(displayNameOf("Wan 2.7 Image Pro · token plan", "dashscope")).toBe(
      "Wan 2.7 Image Pro · token plan",
    );
    expect(displayNameOf("Qwen Image Edit Max · sync", "dashscope")).toBe(
      "Qwen Image Edit Max · sync",
    );
  });

  it("未知 provider / 无后缀 → 原样返回", () => {
    expect(displayNameOf("Some Model · Whatever", "not-registered")).toBe("Some Model · Whatever");
    expect(displayNameOf("No Suffix Model", "newapi")).toBe("No Suffix Model");
  });
});

describe("★ 徽章覆盖率 — 目录中出现的 provider 必须全部登记", () => {
  const allEntries = [
    ...AIGC_MODEL_CATALOG,
    ...AI_GATEWAY_AIGC_CATALOG,
    ...CLOUDFLARE_AIGC_CATALOG,
  ];

  it("三份目录里的每个 provider 都在 PROVIDER_META 中有徽章", () => {
    const missing = [...new Set(allEntries.map((e) => e.provider))].filter(
      (p) => PROVIDER_META[p] === undefined,
    );
    expect(
      missing,
      `这些 provider 没有徽章,其模型会显示为纯文字且保留冗余后缀: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("每个目录条目的 label 经 displayNameOf 后不再残留自身 provider 后缀", () => {
    const residual = allEntries
      .map((e) => ({ model: e.model, shown: displayNameOf(e.label, e.provider) }))
      .filter(({ shown }) => / · (ai-gateway|cloudflare|newapi|sufy|openrouter|dashscope)$/i.test(shown));
    expect(residual, `残留 provider 后缀: ${JSON.stringify(residual)}`).toEqual([]);
  });
});

describe("★ 归一后的 provider 标识同样要有徽章(multi-gateway-providers 任务 4.0 交叉)", () => {
  /**
   * 上一组覆盖率断言吃的是**目录原始值**(`ai-gateway`),而消费面拿到的是统一目录端点
   * `GET /config/models` 的**投影结果** —— 它会按 `LEGACY_PROVIDER_ID_MAP` 把 image 侧的
   * `ai-gateway` 归一成 `blksails-ai`。于是原始值有徽章、归一值没有,上一组照样全绿,
   * 而 /settings「启用的图像模型」里这三条会退化成纯文字 + 拖着 ` · ai-gateway` 后缀。
   *
   * 归一表住在 `@blksails/pi-web-core`(canvas-ui 不依赖它),此处按其值面写死校验;
   * 表若再扩项,新增映射的目标 id 需同步补进本清单与 PROVIDER_META。
   */
  const NORMALIZED: Readonly<Record<string, string>> = { "ai-gateway": "blksails-ai" };

  it("归一目标 id 在 PROVIDER_META 中有徽章", () => {
    const missing = Object.values(NORMALIZED).filter((p) => PROVIDER_META[p] === undefined);
    expect(missing, `归一后的 provider 没有徽章: ${missing.join(", ")}`).toEqual([]);
  });

  it("label 仍写旧名时,按归一后的 provider 也能剥掉冗余后缀", () => {
    for (const e of AI_GATEWAY_AIGC_CATALOG) {
      const normalized = NORMALIZED[e.provider] ?? e.provider;
      const shown = displayNameOf(e.label, normalized);
      expect(shown, `${e.model} 残留后缀`).not.toMatch(/ · ai-gateway$/i);
      expect(shown.length).toBeGreaterThan(0);
    }
  });
});
