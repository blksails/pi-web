/**
 * ai-gateway · key-resolver 单测(design.md §2.2,Req Story 3)。
 */
import { describe, expect, it } from "vitest";
import {
  EnvKeyResolver,
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

  it("请求期即时读取:换 key 后下一次 resolve 立即生效(不缓存)", async () => {
    const env: Record<string, string | undefined> = { AI_GATEWAY_API_KEY: "sk-gw-old" };
    const resolver = new EnvKeyResolver(env);
    await expect(resolver.resolve({})).resolves.toBe("sk-gw-old");
    env.AI_GATEWAY_API_KEY = "sk-gw-new";
    await expect(resolver.resolve({})).resolves.toBe("sk-gw-new");
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
