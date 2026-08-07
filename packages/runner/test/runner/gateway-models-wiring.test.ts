/**
 * 反向拉取的 runner 侧在途表与补注册（spec ai-gateway-catalog-coldstart，任务 2.3）。
 *
 * 判据的重点不在「能发出请求」，而在两处容易悄悄错的地方：
 *  1. **登记顺序不可假定**——会话构造（登记待补清单）与 runner 启动（登记帧通道）谁先
 *     谁后都可能。两种顺序都必须发出请求，否则冷启在其中一种排列下静默失效。
 *  2. **迟到/未知 id 安全丢弃**——与宿主侧 `PendingRequests` 同语义，不得抛。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachGatewayModelsChannel,
  registerGatewayModelsPending,
  resetGatewayModelsWiring,
} from "../../src/runner/gateway-models-wiring.js";

type Handler = (frame: unknown) => void;

function fakeChannel() {
  const sent: unknown[] = [];
  const handlers = new Map<string, { schema: { safeParse: (x: unknown) => { success: boolean; data?: unknown } }; h: Handler }>();
  return {
    sent,
    channel: {
      register: (types: string | readonly string[], schema: never, h: Handler) => {
        const key = Array.isArray(types) ? types[0]! : (types as string);
        handlers.set(key, { schema: schema as never, h });
        return () => handlers.delete(key);
      },
      send: (frame: unknown) => {
        sent.push(frame);
      },
      installed: true,
      cleanup: () => {},
    } as never,
    /** 模拟宿主下发一帧应答。 */
    deliver: (frame: unknown) => {
      const entry = handlers.get("piweb_gateway_models_result");
      if (entry === undefined) return false;
      const parsed = entry.schema.safeParse(frame);
      if (!parsed.success) return false;
      entry.h(parsed.data);
      return true;
    },
  };
}

const silent = { info: () => {} };

describe("gateway-models-wiring — 登记顺序不可假定", () => {
  beforeEach(() => resetGatewayModelsWiring());

  it("先登记待补清单、后登记通道 → 仍发出请求", () => {
    const f = fakeChannel();
    registerGatewayModelsPending({ instanceIds: ["cf"], apply: () => {} }, silent);
    expect(f.sent).toHaveLength(0);
    attachGatewayModelsChannel(f.channel, silent);
    expect(f.sent).toHaveLength(1);
    expect((f.sent[0] as { type: string }).type).toBe("agent_gateway_models");
  });

  it("先登记通道、后登记待补清单 → 同样发出请求", () => {
    const f = fakeChannel();
    attachGatewayModelsChannel(f.channel, silent);
    expect(f.sent).toHaveLength(0);
    registerGatewayModelsPending({ instanceIds: ["cf"], apply: () => {} }, silent);
    expect(f.sent).toHaveLength(1);
  });

  // 零侵入:目录已就绪的快路径 / 未启用网关 → 一帧都不发(Req 5.1)。
  it("无待补实例 → 不发任何帧", () => {
    const f = fakeChannel();
    attachGatewayModelsChannel(f.channel, silent);
    registerGatewayModelsPending({ instanceIds: [], apply: () => {} }, silent);
    expect(f.sent).toHaveLength(0);
  });

  it("重复登记不产生重复请求(避免同一会话多次索取)", () => {
    const f = fakeChannel();
    registerGatewayModelsPending({ instanceIds: ["cf"], apply: () => {} }, silent);
    attachGatewayModelsChannel(f.channel, silent);
    attachGatewayModelsChannel(f.channel, silent);
    registerGatewayModelsPending({ instanceIds: ["cf"], apply: () => {} }, silent);
    expect(f.sent).toHaveLength(1);
  });
});

describe("gateway-models-wiring — 在途表语义", () => {
  beforeEach(() => resetGatewayModelsWiring());

  it("★ 应答 id 匹配 → 整批补注册", () => {
    const f = fakeChannel();
    const apply = vi.fn();
    registerGatewayModelsPending({ instanceIds: ["cf"], apply }, silent);
    attachGatewayModelsChannel(f.channel, silent);
    const reqId = (f.sent[0] as { id: string }).id;

    f.deliver({
      type: "piweb_gateway_models_result",
      id: reqId,
      instances: [{ instanceId: "cf", models: ["anthropic/claude-opus-5"] }],
      reason: "ready",
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]?.[0]).toEqual([
      { instanceId: "cf", models: ["anthropic/claude-opus-5"] },
    ]);
  });

  it("★ 迟到/未知 id → 安全丢弃且不抛(与宿主 PendingRequests 同语义)", () => {
    const f = fakeChannel();
    const apply = vi.fn();
    registerGatewayModelsPending({ instanceIds: ["cf"], apply }, silent);
    attachGatewayModelsChannel(f.channel, silent);

    expect(() =>
      f.deliver({
        type: "piweb_gateway_models_result",
        id: "id-that-was-never-sent",
        instances: [{ instanceId: "cf", models: ["x/y"] }],
        reason: "ready",
      }),
    ).not.toThrow();
    expect(apply).not.toHaveBeenCalled();
  });

  // timeout 应答同样要走 apply(空清单):它是一次**明确的答复**,与「没收到答复」不同。
  it("timeout 应答 → 以空清单补注册,不抛", () => {
    const f = fakeChannel();
    const apply = vi.fn();
    registerGatewayModelsPending({ instanceIds: ["cf"], apply }, silent);
    attachGatewayModelsChannel(f.channel, silent);
    const reqId = (f.sent[0] as { id: string }).id;
    f.deliver({
      type: "piweb_gateway_models_result",
      id: reqId,
      instances: [{ instanceId: "cf", models: [] }],
      reason: "timeout",
    });
    expect(apply).toHaveBeenCalledWith([{ instanceId: "cf", models: [] }]);
  });

  it("通道 send 抛错 → 不外泄,会话照常(fail-soft)", () => {
    const bad = {
      register: () => () => {},
      send: () => {
        throw new Error("channel closed");
      },
      installed: true,
      cleanup: () => {},
    } as never;
    expect(() => {
      registerGatewayModelsPending({ instanceIds: ["cf"], apply: () => {} }, silent);
      attachGatewayModelsChannel(bad, silent);
    }).not.toThrow();
  });
});
