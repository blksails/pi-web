/**
 * ai-gateway · key-resolver 单测(design.md §2.2,Req Story 3)。
 */
import { describe, expect, it } from "vitest";
import {
  EnvKeyResolver,
  InstanceEnvKeyResolver,
  PerUserKeyResolver,
  NotImplementedError,
} from "../../src/ai-gateway/key-resolver.js";

describe("EnvKeyResolver", () => {
  it("AI_GATEWAY_API_KEY 存在 → 解析出该值", async () => {
    const resolver = new EnvKeyResolver({ AI_GATEWAY_API_KEY: "sk-gw-abc123" });
    await expect(resolver.resolve({})).resolves.toBe("sk-gw-abc123");
  });

  it("AI_GATEWAY_API_KEY 缺失 → undefined", async () => {
    const resolver = new EnvKeyResolver({});
    await expect(resolver.resolve({})).resolves.toBeUndefined();
  });

  it("AI_GATEWAY_API_KEY 空白 → undefined", async () => {
    const resolver = new EnvKeyResolver({ AI_GATEWAY_API_KEY: "   " });
    await expect(resolver.resolve({})).resolves.toBeUndefined();
  });

  // ── 改名(BLKSAILS_GATEWAY_*)与旧名回落 ────────────────────────────────
  // 旧名 AI_GATEWAY_API_KEY 会被 spawn 的 pi 子进程继承并被 pi-ai 当成 Vercel AI Gateway
  // 凭据,劫持全部模型调用(pi-clouds 8.2 事故),故主用新名;旧名仅为存量部署保留回落。
  it("BLKSAILS_GATEWAY_API_KEY 存在 → 解析出该值", async () => {
    const resolver = new EnvKeyResolver({
      BLKSAILS_GATEWAY_API_KEY: "sk-gw-new-name",
    });
    await expect(resolver.resolve({})).resolves.toBe("sk-gw-new-name");
  });

  it("新名优先于旧名(两者并存时不取旧名)", async () => {
    const resolver = new EnvKeyResolver({
      BLKSAILS_GATEWAY_API_KEY: "sk-gw-new-name",
      AI_GATEWAY_API_KEY: "sk-gw-legacy",
    });
    await expect(resolver.resolve({})).resolves.toBe("sk-gw-new-name");
  });

  it("请求期即时读取:换 key 后下一次 resolve 立即生效(不缓存)", async () => {
    const env: Record<string, string | undefined> = { AI_GATEWAY_API_KEY: "sk-gw-old" };
    const resolver = new EnvKeyResolver(env);
    await expect(resolver.resolve({})).resolves.toBe("sk-gw-old");
    env.AI_GATEWAY_API_KEY = "sk-gw-new";
    await expect(resolver.resolve({})).resolves.toBe("sk-gw-new");
  });
});

describe("InstanceEnvKeyResolver — 按实例读 env(spec multi-gateway-providers 任务 3.3,Req 1.5)", () => {
  it("读取该实例专属的 _API_KEY env", async () => {
    const resolver = new InstanceEnvKeyResolver("cf-gateway", {
      PI_WEB_GATEWAY_CF_GATEWAY_API_KEY: "sk-cf-key",
    });
    await expect(resolver.resolve({})).resolves.toBe("sk-cf-key");
  });

  it("标识含连字符 → env 名连字符转下划线且大写(与 instances.ts 派生规则同构)", async () => {
    const resolver = new InstanceEnvKeyResolver("blksails-ai", {
      PI_WEB_GATEWAY_BLKSAILS_AI_API_KEY: "sk-blksails",
    });
    await expect(resolver.resolve({})).resolves.toBe("sk-blksails");
  });

  it("两个实例的凭据解析互不干扰:各自只读各自的 env 名", async () => {
    const env = {
      PI_WEB_GATEWAY_GW_A_API_KEY: "sk-a",
      PI_WEB_GATEWAY_GW_B_API_KEY: "sk-b",
    };
    const resolverA = new InstanceEnvKeyResolver("gw-a", env);
    const resolverB = new InstanceEnvKeyResolver("gw-b", env);
    await expect(resolverA.resolve({})).resolves.toBe("sk-a");
    await expect(resolverB.resolve({})).resolves.toBe("sk-b");
  });

  it("该实例的 _API_KEY 缺失/空白且未开启 legacyFallback → undefined(不误取其他实例或全局名)", async () => {
    const resolver = new InstanceEnvKeyResolver("gw-a", {
      PI_WEB_GATEWAY_GW_A_API_KEY: "   ",
      BLKSAILS_GATEWAY_API_KEY: "sk-global",
    });
    await expect(resolver.resolve({})).resolves.toBeUndefined();
  });

  it("legacyFallback:true 且专属 env 未设置 → 回落到 BLKSAILS_GATEWAY_API_KEY(Req 9.1 兼容)", async () => {
    const resolver = new InstanceEnvKeyResolver(
      "ai-gateway",
      { BLKSAILS_GATEWAY_API_KEY: "sk-legacy-global" },
      { legacyFallback: true },
    );
    await expect(resolver.resolve({})).resolves.toBe("sk-legacy-global");
  });

  it("legacyFallback:true 且专属 env 已设置 → 专属值优先于全局回落", async () => {
    const resolver = new InstanceEnvKeyResolver(
      "ai-gateway",
      {
        PI_WEB_GATEWAY_AI_GATEWAY_API_KEY: "sk-instance-specific",
        BLKSAILS_GATEWAY_API_KEY: "sk-legacy-global",
      },
      { legacyFallback: true },
    );
    await expect(resolver.resolve({})).resolves.toBe("sk-instance-specific");
  });

  it("请求期即时读取:换 key 后下一次 resolve 立即生效(不缓存)", async () => {
    const env: Record<string, string | undefined> = {
      PI_WEB_GATEWAY_GW_A_API_KEY: "sk-old",
    };
    const resolver = new InstanceEnvKeyResolver("gw-a", env);
    await expect(resolver.resolve({})).resolves.toBe("sk-old");
    env.PI_WEB_GATEWAY_GW_A_API_KEY = "sk-new";
    await expect(resolver.resolve({})).resolves.toBe("sk-new");
  });
});

describe("PerUserKeyResolver", () => {
  it("resolve 直接抛 NotImplementedError(P1 占位,本期不实现查表)", async () => {
    const resolver = new PerUserKeyResolver();
    await expect(resolver.resolve({ userId: "user-1" })).rejects.toThrow(
      NotImplementedError,
    );
  });
});
