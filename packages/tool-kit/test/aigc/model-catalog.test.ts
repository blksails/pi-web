/**
 * model-catalog 与 ROUTES 一致性(sync)测试(aigc-tool-settings)。
 *
 * 纯 `AIGC_MODEL_CATALOG`(供 /settings 无会话态列举)必须与图像工具 ROUTES 的 gen∪edit 并集
 * 完全一致(model/label/provider),否则设置页列出的模型与工具实际暴露的模型漂移。本测试是
 * 唯一的防漂移守卫(catalog 是手写纯数据,不 import pi SDK 的 ROUTES)。
 */
import { describe, it, expect } from "vitest";
import {
  AIGC_MODEL_CATALOG,
  AI_GATEWAY_AIGC_CATALOG,
  CLOUDFLARE_AIGC_CATALOG,
} from "../../src/aigc/model-catalog.js";
import {
  IMAGE_GENERATION_ROUTES,
  AI_GATEWAY_IMAGE_ROUTES,
  CLOUDFLARE_IMAGE_ROUTES,
  CLOUDFLARE_WORKERS_AI_ROUTES,
} from "../../src/aigc/tools/image-generation.js";
import {
  IMAGE_EDIT_ROUTES,
  AI_GATEWAY_IMAGE_EDIT_ROUTES,
  CLOUDFLARE_IMAGE_EDIT_ROUTES,
} from "../../src/aigc/tools/image-edit.js";

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

describe("AI_GATEWAY_AIGC_CATALOG 与网关 ROUTES 一致", () => {
  // 同款并集去重:网关 gen∪edit,按**最终** route.model 去重(首次出现取值;
  // gpt-image-2 条目经 extras 覆盖路由键为 gpt-image-2-ai-gateway)。
  const byModel = new Map<string, { label: string; provider?: string }>();
  for (const r of [...AI_GATEWAY_IMAGE_ROUTES, ...AI_GATEWAY_IMAGE_EDIT_ROUTES]) {
    if (!byModel.has(r.model)) byModel.set(r.model, { label: r.label, provider: r.provider });
  }

  it("catalog 的 model 集合 = 网关 ROUTES 并集(无缺无余)", () => {
    const catalogModels = AI_GATEWAY_AIGC_CATALOG.map((e) => e.model).sort();
    const routeModels = [...byModel.keys()].sort();
    expect(catalogModels).toEqual(routeModels);
  });

  it("每个 catalog 条目的 label 与对应 route 一致,provider 恒为 ai-gateway", () => {
    for (const entry of AI_GATEWAY_AIGC_CATALOG) {
      const route = byModel.get(entry.model);
      expect(route, `catalog 含网关 ROUTES 外的 model: ${entry.model}`).toBeDefined();
      expect(entry.label).toBe(route?.label);
      expect(entry.provider).toBe("ai-gateway");
      expect(route?.provider).toBe("ai-gateway");
    }
  });

  it("catalog 顺序 = 网关 gen∪edit 并集去重序", () => {
    expect(AI_GATEWAY_AIGC_CATALOG.map((e) => e.model)).toEqual([...byModel.keys()]);
  });
});

describe("CLOUDFLARE_AIGC_CATALOG 与 Cloudflare ROUTES 一致", () => {
  // 同款并集去重:CF gen∪edit,按最终 route.model 去重(首次出现取值)。
  const byModel = new Map<string, { label: string; provider?: string }>();
  for (const r of [...CLOUDFLARE_IMAGE_ROUTES, ...CLOUDFLARE_IMAGE_EDIT_ROUTES]) {
    if (!byModel.has(r.model)) byModel.set(r.model, { label: r.label, provider: r.provider });
  }

  it("catalog 的 model 集合 = Cloudflare ROUTES 并集(无缺无余)", () => {
    const catalogModels = CLOUDFLARE_AIGC_CATALOG.map((e) => e.model).sort();
    const routeModels = [...byModel.keys()].sort();
    expect(catalogModels).toEqual(routeModels);
  });

  it("每个 catalog 条目的 label 与对应 route 一致,provider 恒为 cloudflare", () => {
    for (const entry of CLOUDFLARE_AIGC_CATALOG) {
      const route = byModel.get(entry.model);
      expect(route, `catalog 含 Cloudflare ROUTES 外的 model: ${entry.model}`).toBeDefined();
      expect(entry.label).toBe(route?.label);
      expect(entry.provider).toBe("cloudflare");
      expect(route?.provider).toBe("cloudflare");
    }
  });

  it("catalog 顺序 = Cloudflare gen∪edit 并集去重序", () => {
    expect(CLOUDFLARE_AIGC_CATALOG.map((e) => e.model)).toEqual([...byModel.keys()]);
  });
});

/**
 * 跨 provider 路由键唯一性(spec cloudflare-aigc-provider Req 4.4)。
 *
 * ★ 三个 provider 上都有名为 gpt-image-2 的模型(NewAPI / sufy / BlackSail 自建网关),
 * Cloudflare 是第四个。路由键即运行时 model 路由的 key,一旦撞车会导致选中 A 却调用 B,
 * 且这种错误在单个 provider 的测试里看不出来 —— 故在此做全局断言。
 */
describe("跨 provider 路由键唯一性", () => {
  it("Cloudflare 路由键与既有全部 provider 的 model 集合无交集", () => {
    const existing = new Set(
      [
        ...IMAGE_GENERATION_ROUTES,
        ...IMAGE_EDIT_ROUTES,
        ...AI_GATEWAY_IMAGE_ROUTES,
        ...AI_GATEWAY_IMAGE_EDIT_ROUTES,
      ].map((r) => r.model),
    );
    const collisions = [...CLOUDFLARE_IMAGE_ROUTES, ...CLOUDFLARE_IMAGE_EDIT_ROUTES]
      .map((r) => r.model)
      .filter((m) => existing.has(m));
    expect(collisions, `Cloudflare 路由键与既有 provider 撞车: ${collisions.join(", ")}`).toEqual(
      [],
    );
  });

  it("全部路由组合起来后,同名 model 不会跨 provider 出现", () => {
    const byModel = new Map<string, Set<string>>();
    for (const r of [
      ...IMAGE_GENERATION_ROUTES,
      ...IMAGE_EDIT_ROUTES,
      ...AI_GATEWAY_IMAGE_ROUTES,
      ...AI_GATEWAY_IMAGE_EDIT_ROUTES,
      ...CLOUDFLARE_IMAGE_ROUTES,
      ...CLOUDFLARE_IMAGE_EDIT_ROUTES,
    ]) {
      const set = byModel.get(r.model) ?? new Set<string>();
      if (r.provider) set.add(r.provider);
      byModel.set(r.model, set);
    }
    const ambiguous = [...byModel.entries()]
      .filter(([, providers]) => providers.size > 1)
      .map(([model, providers]) => `${model} → ${[...providers].join("/")}`);
    expect(ambiguous, `同一 model 键归属多个 provider: ${ambiguous.join("; ")}`).toEqual([]);
  });
});

/**
 * Workers AI 原生模型的隔离(2026-07-29 用户裁定)。
 *
 * `CLOUDFLARE_WORKERS_AI_ROUTES` 已验证可用,但吃每日 10,000 neurons 免费额度、耗尽即 429,
 * 故**不入目录**。这组断言防止它被无意并回 —— 一旦并回,用户会选中后随机失败。
 */
describe("Workers AI 原生路由与目录隔离", () => {
  it("CLOUDFLARE_WORKERS_AI_ROUTES 非空(能力保留,不是被删掉)", () => {
    expect(CLOUDFLARE_WORKERS_AI_ROUTES.length).toBeGreaterThan(0);
  });

  it("★ 其模型不得出现在任何目录中", () => {
    const catalogModels = new Set([
      ...AIGC_MODEL_CATALOG.map((e) => e.model),
      ...AI_GATEWAY_AIGC_CATALOG.map((e) => e.model),
      ...CLOUDFLARE_AIGC_CATALOG.map((e) => e.model),
    ]);
    const leaked = CLOUDFLARE_WORKERS_AI_ROUTES.map((r) => r.model).filter((m) =>
      catalogModels.has(m),
    );
    expect(leaked, `Workers AI 模型泄漏进目录(会因免费额度耗尽随机 429): ${leaked.join(", ")}`).toEqual([]);
  });

  it("★ 其模型也不得出现在条件注册的 CF 路由组中", () => {
    const registered = new Set(
      [...CLOUDFLARE_IMAGE_ROUTES, ...CLOUDFLARE_IMAGE_EDIT_ROUTES].map((r) => r.model),
    );
    const leaked = CLOUDFLARE_WORKERS_AI_ROUTES.map((r) => r.model).filter((m) => registered.has(m));
    expect(leaked).toEqual([]);
  });
});
