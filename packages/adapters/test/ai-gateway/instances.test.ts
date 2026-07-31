/**
 * ai-gateway · instances 单测(design.md「adapters / GatewayInstances」,
 * spec multi-gateway-providers 任务 3.1;Req 1.1, 1.2, 1.6, 9.1, 10.2)。
 */
import { describe, expect, it, vi } from "vitest";
import type { ProviderId } from "@blksails/pi-web-core/model-catalog/provider-identity.js";
import { AiGatewayConfigError } from "../../src/ai-gateway/config.js";
import {
  createGatewayCatalogs,
  declaredGatewayInstanceIdsFromEnv,
  DEFAULT_GATEWAY_INSTANCE_ID,
  resolveGatewayInstances,
  type GatewayInstanceConfig,
} from "../../src/ai-gateway/instances.js";

/** 测试专用:把裸字符串断言为 {@link ProviderId}(生产代码经 `validateProviderId` 校验后取得)。 */
function pid(raw: string): ProviderId {
  return raw as ProviderId;
}

describe("resolveGatewayInstances — 零实例(Req 10.1 基线)", () => {
  it("未配置 PI_WEB_GATEWAYS 且未配置存量单实例变量 → 空数组", () => {
    expect(resolveGatewayInstances({})).toEqual([]);
  });
});

describe("resolveGatewayInstances — 缺省实例合成(Req 9.1)", () => {
  it("未设 PI_WEB_GATEWAYS,仅设存量 BLKSAILS_GATEWAY_BASE_URL → 合成单一缺省实例", () => {
    const instances = resolveGatewayInstances({
      BLKSAILS_GATEWAY_BASE_URL: "http://gw.example.com:8080",
    });
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      id: DEFAULT_GATEWAY_INSTANCE_ID,
      baseUrl: "http://gw.example.com:8080",
    });
    expect(DEFAULT_GATEWAY_INSTANCE_ID).toBe("ai-gateway");
  });

  it("仅设旧名 AI_GATEWAY_BASE_URL(改名前回落名)→ 同样合成缺省实例", () => {
    const instances = resolveGatewayInstances({
      AI_GATEWAY_BASE_URL: "http://gw.legacy:8080",
    });
    expect(instances).toHaveLength(1);
    expect(instances[0]?.id).toBe(DEFAULT_GATEWAY_INSTANCE_ID);
    expect(instances[0]?.baseUrl).toBe("http://gw.legacy:8080");
  });

  it("缺省实例的 apiKey 取自存量凭据 env,超时 / TTL 覆盖同样生效(逐字节一致)", () => {
    const instances = resolveGatewayInstances({
      BLKSAILS_GATEWAY_BASE_URL: "http://gw.example.com:8080",
      BLKSAILS_GATEWAY_API_KEY: "sk-legacy",
      AI_GATEWAY_TIMEOUT_MS: "5000",
      AI_GATEWAY_CATALOG_TTL_MS: "1000",
    });
    expect(instances[0]).toMatchObject({
      apiKey: "sk-legacy",
      timeoutMs: 5000,
      ttlMs: 1000,
    });
  });

  it("缺省实例的上游归属白名单沿用 PI_WEB_AI_GATEWAY_PROVIDER_ALLOWLIST 解析规则", () => {
    const instances = resolveGatewayInstances({
      BLKSAILS_GATEWAY_BASE_URL: "http://gw.example.com:8080",
      PI_WEB_AI_GATEWAY_PROVIDER_ALLOWLIST: "openai,anthropic",
    });
    expect(instances[0]?.allowedOwners).toEqual(new Set(["openai", "anthropic"]));
  });
});

describe("resolveGatewayInstances — 多实例解析(Req 1.1/1.2/1.6)", () => {
  it("PI_WEB_GATEWAYS 列出两个实例 → 各自解析独立配置,provider 名即实例标识", () => {
    const instances = resolveGatewayInstances({
      PI_WEB_GATEWAYS: "cf-gateway,blksails-ai",
      PI_WEB_GATEWAY_CF_GATEWAY_BASE_URL: "https://cf.example.com/v1",
      PI_WEB_GATEWAY_CF_GATEWAY_API_KEY: "sk-cf",
      PI_WEB_GATEWAY_BLKSAILS_AI_BASE_URL: "https://blksails.example.com/v1",
      PI_WEB_GATEWAY_BLKSAILS_AI_API_KEY: "sk-blksails",
    });

    expect(instances).toHaveLength(2);
    expect(instances[0]).toMatchObject({
      id: "cf-gateway",
      baseUrl: "https://cf.example.com/v1",
      apiKey: "sk-cf",
    });
    expect(instances[1]).toMatchObject({
      id: "blksails-ai",
      baseUrl: "https://blksails.example.com/v1",
      apiKey: "sk-blksails",
    });
  });

  it("逐实例的 TTL / 超时 / 白名单 / 输入输出类型覆盖互不干扰", () => {
    const instances = resolveGatewayInstances({
      PI_WEB_GATEWAYS: "gw-a,gw-b",
      PI_WEB_GATEWAY_GW_A_BASE_URL: "http://a.example.com",
      PI_WEB_GATEWAY_GW_A_TTL_MS: "1000",
      PI_WEB_GATEWAY_GW_A_TIMEOUT_MS: "2000",
      PI_WEB_GATEWAY_GW_A_ALLOWLIST: "openai",
      PI_WEB_GATEWAY_GW_A_INPUT: "text,image",
      PI_WEB_GATEWAY_GW_A_OUTPUT: "image",
      PI_WEB_GATEWAY_GW_B_BASE_URL: "http://b.example.com",
    });

    expect(instances[0]).toMatchObject({
      id: "gw-a",
      ttlMs: 1000,
      timeoutMs: 2000,
      input: ["text", "image"],
      output: ["image"],
    });
    expect(instances[0]?.allowedOwners).toEqual(new Set(["openai"]));

    // gw-b 未覆盖的字段落回默认值,且不受 gw-a 的覆盖值污染。
    expect(instances[1]).toMatchObject({ id: "gw-b" });
    expect(instances[1]?.input).toBeUndefined();
    expect(instances[1]?.output).toBeUndefined();
  });

  it("实例标识含连字符时,env 前缀按大写 + 下划线派生", () => {
    const instances = resolveGatewayInstances({
      PI_WEB_GATEWAYS: "my-custom-gw",
      PI_WEB_GATEWAY_MY_CUSTOM_GW_BASE_URL: "http://custom.example.com",
    });
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      id: "my-custom-gw",
      baseUrl: "http://custom.example.com",
    });
  });
});

describe("resolveGatewayInstances — 非法配置 fail-fast,错误信息含实例标识(Req 10.2)", () => {
  it("某实例缺少 BASE_URL → 抛错且信息含该实例标识", () => {
    expect(() =>
      resolveGatewayInstances({
        PI_WEB_GATEWAYS: "gw-a,gw-b",
        PI_WEB_GATEWAY_GW_A_BASE_URL: "http://a.example.com",
        // gw-b 未配置 BASE_URL
      }),
    ).toThrow(AiGatewayConfigError);

    try {
      resolveGatewayInstances({
        PI_WEB_GATEWAYS: "gw-a,gw-b",
        PI_WEB_GATEWAY_GW_A_BASE_URL: "http://a.example.com",
      });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain("gw-b");
      expect((err as Error).message).toContain("PI_WEB_GATEWAY_GW_B_BASE_URL");
    }
  });

  it("某实例 BASE_URL 非法 URL → 抛错且信息含该实例的 env 名", () => {
    try {
      resolveGatewayInstances({
        PI_WEB_GATEWAYS: "gw-a",
        PI_WEB_GATEWAY_GW_A_BASE_URL: "not-a-url",
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AiGatewayConfigError);
      expect((err as Error).message).toContain("PI_WEB_GATEWAY_GW_A_BASE_URL");
    }
  });

  it("某实例超时覆盖非正整数 → 抛错且信息含该实例的 env 名", () => {
    try {
      resolveGatewayInstances({
        PI_WEB_GATEWAYS: "gw-a",
        PI_WEB_GATEWAY_GW_A_BASE_URL: "http://a.example.com",
        PI_WEB_GATEWAY_GW_A_TIMEOUT_MS: "-5",
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AiGatewayConfigError);
      expect((err as Error).message).toContain("PI_WEB_GATEWAY_GW_A_TIMEOUT_MS");
    }
  });

  it("某实例 _INPUT 含不在取值域内的取值 → 抛错且信息含该实例标识", () => {
    try {
      resolveGatewayInstances({
        PI_WEB_GATEWAYS: "gw-a",
        PI_WEB_GATEWAY_GW_A_BASE_URL: "http://a.example.com",
        PI_WEB_GATEWAY_GW_A_INPUT: "text,bogus",
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AiGatewayConfigError);
      expect((err as Error).message).toContain("gw-a");
      expect((err as Error).message).toContain("bogus");
    }
  });

  it("某实例标识不合法(大写)→ 抛错且信息含该标识与来源 env 名", () => {
    try {
      resolveGatewayInstances({ PI_WEB_GATEWAYS: "Bad-ID" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AiGatewayConfigError);
      expect((err as Error).message).toContain("Bad-ID");
      expect((err as Error).message).toContain("PI_WEB_GATEWAYS");
    }
  });

  it("某实例标识与 pi SDK 内置 provider 保留名冲突 → 抛错", () => {
    expect(() =>
      resolveGatewayInstances({ PI_WEB_GATEWAYS: "openai" }),
    ).toThrow(AiGatewayConfigError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// declaredGatewayInstanceIdsFromEnv —— 声明集判据(spec multi-gateway-providers 任务 3.7,
// Req 6.5)。★ 与 resolveGatewayInstances 的核心区别:绝不抛异常、不做合法性校验。
// ─────────────────────────────────────────────────────────────────────────
describe("declaredGatewayInstanceIdsFromEnv — 声明集(不校验、不抛,Req 6.5)", () => {
  it("未设置 PI_WEB_GATEWAYS 且未设置存量单实例变量 → 空数组", () => {
    expect(declaredGatewayInstanceIdsFromEnv({})).toEqual([]);
  });

  it("设置 PI_WEB_GATEWAYS → 按逗号切分、trim,原样返回", () => {
    expect(
      declaredGatewayInstanceIdsFromEnv({ PI_WEB_GATEWAYS: " cloudflare , blksails-ai " }),
    ).toEqual(["cloudflare", "blksails-ai"]);
  });

  it("未设置 PI_WEB_GATEWAYS,仅设存量 BLKSAILS_GATEWAY_BASE_URL → 缺省实例标识", () => {
    expect(
      declaredGatewayInstanceIdsFromEnv({
        BLKSAILS_GATEWAY_BASE_URL: "http://gw.example.com:8080",
      }),
    ).toEqual([DEFAULT_GATEWAY_INSTANCE_ID]);
  });

  it("未设置 PI_WEB_GATEWAYS,仅设旧名 AI_GATEWAY_BASE_URL → 同样为缺省实例标识", () => {
    expect(
      declaredGatewayInstanceIdsFromEnv({ AI_GATEWAY_BASE_URL: "http://gw.example.com:8080" }),
    ).toEqual([DEFAULT_GATEWAY_INSTANCE_ID]);
  });

  it("PI_WEB_GATEWAYS 与存量单实例变量同时设置 → 只取 PI_WEB_GATEWAYS(不合并)", () => {
    expect(
      declaredGatewayInstanceIdsFromEnv({
        PI_WEB_GATEWAYS: "cloudflare",
        BLKSAILS_GATEWAY_BASE_URL: "http://gw.example.com:8080",
      }),
    ).toEqual(["cloudflare"]);
  });

  it("PI_WEB_GATEWAYS 含不合法标识(大写)→ 不抛,原样计入声明集", () => {
    expect(() => declaredGatewayInstanceIdsFromEnv({ PI_WEB_GATEWAYS: "Bad-ID" })).not.toThrow();
    expect(declaredGatewayInstanceIdsFromEnv({ PI_WEB_GATEWAYS: "Bad-ID" })).toEqual(["Bad-ID"]);
  });

  it("PI_WEB_GATEWAYS 含 pi SDK 保留名(如 openai)→ 不抛,原样计入声明集", () => {
    expect(() => declaredGatewayInstanceIdsFromEnv({ PI_WEB_GATEWAYS: "openai" })).not.toThrow();
    expect(declaredGatewayInstanceIdsFromEnv({ PI_WEB_GATEWAYS: "openai" })).toEqual(["openai"]);
  });

  it("PI_WEB_GATEWAYS 为空白字符串 → 视同未设置,回落存量单实例判据", () => {
    expect(
      declaredGatewayInstanceIdsFromEnv({
        PI_WEB_GATEWAYS: "   ",
        BLKSAILS_GATEWAY_BASE_URL: "http://gw.example.com:8080",
      }),
    ).toEqual([DEFAULT_GATEWAY_INSTANCE_ID]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// createGatewayCatalogs —— 每实例目录聚合(spec multi-gateway-providers 任务 3.3,Req 1.5)
// ─────────────────────────────────────────────────────────────────────────
describe("createGatewayCatalogs — 凭据解析与目录缓存按实例独立(Req 1.5)", () => {
  function makeInstance(overrides: Partial<GatewayInstanceConfig>): GatewayInstanceConfig {
    return {
      id: pid("gw-a"),
      baseUrl: "http://a.example.com",
      apiKey: "",
      allowedOwners: new Set<string>(["openai", "anthropic"]),
      ttlMs: 1000,
      timeoutMs: 1000,
      ...overrides,
    };
  }

  it("集成测试:两个实例,其一拉取失败,另一实例的模型仍完整(不受牵连)", async () => {
    const instances: readonly GatewayInstanceConfig[] = [
      makeInstance({ id: pid("gw-a"), baseUrl: "http://a.example.com" }),
      makeInstance({ id: pid("gw-b"), baseUrl: "http://b.example.com" }),
    ];

    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = url.toString();
      if (href.startsWith("http://a.example.com")) {
        // gw-a 拉取失败(如 500 或网络错误)。
        return new Response(null, { status: 500 });
      }
      // gw-b 拉取成功,返回两条模型。
      return new Response(
        JSON.stringify({
          data: [
            { id: "model-b1", owned_by: "openai" },
            { id: "model-b2", owned_by: "anthropic" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const catalogs = createGatewayCatalogs(instances, {
      env: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(catalogs.size).toBe(2);
    const catalogA = catalogs.get(pid("gw-a"));
    const catalogB = catalogs.get(pid("gw-b"));
    expect(catalogA).toBeDefined();
    expect(catalogB).toBeDefined();

    // 主动 refresh 两者(而非依赖惰性 get() 的后台刷新时序),使断言确定性。
    await catalogA!.refresh();
    await catalogB!.refresh();

    // gw-a 拉取失败 → 自身为空集(fail-soft,从未成功过时快照恒为空)。
    expect(catalogA!.get()).toEqual([]);
    // gw-b 未受 gw-a 失败牵连 → 模型仍完整,且 instanceId 正确归属。
    expect(catalogB!.get()).toHaveLength(2);
    expect(catalogB!.get().every((m) => m.instanceId === "gw-b")).toBe(true);
  });

  it("每个实例的凭据各自独立解析:各自读取自己的 _API_KEY,互不覆盖", async () => {
    const instances: readonly GatewayInstanceConfig[] = [
      makeInstance({ id: pid("gw-a"), baseUrl: "http://a.example.com" }),
      makeInstance({ id: pid("gw-b"), baseUrl: "http://b.example.com" }),
    ];

    const receivedAuth: Record<string, string | undefined> = {};
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = url.toString();
      const instanceId = href.startsWith("http://a.example.com") ? "gw-a" : "gw-b";
      const headers = init?.headers as Record<string, string> | undefined;
      receivedAuth[instanceId] = headers?.authorization;
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const catalogs = createGatewayCatalogs(instances, {
      env: {
        PI_WEB_GATEWAY_GW_A_API_KEY: "sk-a-key",
        PI_WEB_GATEWAY_GW_B_API_KEY: "sk-b-key",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await catalogs.get(pid("gw-a"))!.refresh();
    await catalogs.get(pid("gw-b"))!.refresh();

    expect(receivedAuth["gw-a"]).toBe("Bearer sk-a-key");
    expect(receivedAuth["gw-b"]).toBe("Bearer sk-b-key");
  });

  it("目录快照按实例独立持有:互不共享同一份缓存对象", () => {
    const instances: readonly GatewayInstanceConfig[] = [
      makeInstance({ id: pid("gw-a") }),
      makeInstance({ id: pid("gw-b") }),
    ];
    const catalogs = createGatewayCatalogs(instances, { env: {} });
    expect(catalogs.get(pid("gw-a"))).not.toBe(catalogs.get(pid("gw-b")));
  });
});
