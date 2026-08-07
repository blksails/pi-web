/**
 * 「不以阻塞启动为代价」守卫（spec ai-gateway-catalog-coldstart，任务 4.3；Req 3.1/3.2）。
 *
 * 用户对本 spec 的硬边界是：**服务端启动与首个请求不得因等待上游目录而变慢**。这直接
 * 排除了「装配期 `await catalog.refresh()`」那一类方案。
 *
 * ★ 这条守卫必须能报红，否则它是重言式：如果把等待挪回装配期，本文件应立即失败。
 * 判据落在**装配层是否同步返回**上——装配函数是纯函数、零 IO，它一旦变成需要等待上游
 * 的异步过程，返回值形状与耗时都会变。
 */
import { describe, expect, it } from "vitest";
import { computeAiGatewaySessionsSpawnEnv } from "../lib/app/ai-gateway-session-assembly.js";

/** 一个「上游永不返回」的目录替身：任何等待它的实现都会被这条守卫抓住。 */
function neverReadyCatalog() {
  return {
    get: () => [] as never[],
    refresh: async () =>
      new Promise<void>(() => {
        /* 永不 settle */
      }),
  };
}

describe("装配期不等待上游目录(Req 3.1)", () => {
  it("★ 目录永不就绪时,装配仍**同步**完成且不抛", () => {
    const started = Date.now();
    const r = computeAiGatewaySessionsSpawnEnv({
      instances: [
        {
          instanceId: "cf",
          baseUrl: "https://cf.example.com/compat",
          apiKey: "cf-key",
          // 装配层只读快照(空),不得触碰 refresh
          catalog: neverReadyCatalog().get(),
        },
      ],
    });
    const elapsed = Date.now() - started;

    // 同步返回:拿到的是值而非 Promise
    expect(r).not.toBeInstanceOf(Promise);
    expect(r.env.PI_WEB_AI_GATEWAY_SESSIONS).toBe("cf");
    // 装配是纯函数、零 IO —— 若有人把 await 挪回这里,这个断言会先于耗时断言失败。
    expect(elapsed).toBeLessThan(200);
  });

  it("上游不可达不影响会话装配的其余产出(Req 3.2/3.3)", () => {
    const r = computeAiGatewaySessionsSpawnEnv({
      instances: [
        {
          instanceId: "cf",
          baseUrl: "https://cf.example.com/compat",
          apiKey: "cf-key",
          catalog: [],
        },
      ],
    });
    // 声明与凭据照常下发:会话能起来,只是模型清单待补
    expect(r.env.PI_WEB_AI_GATEWAY_SESSION_CF_BASE).toBeDefined();
    expect(r.env.PI_WEB_AI_GATEWAY_SESSION_CF_KEY).toBe("cf-key");
    expect(r.env.PI_WEB_AI_GATEWAY_SESSION_CF_MODELS).toBeUndefined();
  });

  it("未声明任何实例 → 空对象(零侵入基线,Req 5.1)", () => {
    expect(computeAiGatewaySessionsSpawnEnv({ instances: [] }).env).toEqual({});
  });
});
