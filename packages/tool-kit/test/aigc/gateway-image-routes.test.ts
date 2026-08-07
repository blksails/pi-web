/**
 * 按实例生成图像路由(spec desktop-aigc-egress 任务 3.3/3.4)。
 *
 * 两条主线:
 *  - **展示归属正确**(Req 5.1/5.2)—— provider 必须等于实际承接的实例,不再是写死的名字。
 *  - **清单与实际可用一致**(Req 4.1/4.2)—— 授予声明的清单与内置白名单取交集,
 *    且"未声明"与"声明为空"必须走出不同结果。
 */
import { describe, it, expect } from "vitest";
import {
  createGatewayImageRoutes,
  createGatewayImageRoutesForAll,
  selectGatewayImageModels,
  GATEWAY_IMAGE_MODEL_WHITELIST,
} from "../../src/aigc/gateway-image-routes.js";
import type { GatewayImageInstance } from "../../src/aigc/gateway-instances.js";

function instance(over: Partial<GatewayImageInstance> = {}): GatewayImageInstance {
  return {
    instanceId: "blksails-cloud",
    baseUrl: "https://pi-cloud.apps.blksails.cn/api/desktop/egress",
    apiKey: "desk.cred",
    ...over,
  };
}

describe("展示归属(Req 5.1/5.2)", () => {
  it("★ provider 等于实例标识,不是写死的名字", () => {
    const { generation, edit } = createGatewayImageRoutes(instance());
    expect(generation.length).toBeGreaterThan(0);
    for (const r of [...generation, ...edit]) {
      expect(r.provider).toBe("blksails-cloud");
      // 这正是本任务要收口的缺陷:曾被固定为 "cloudflare"。
      expect(r.provider).not.toBe("cloudflare");
    }
  });

  it("★ 换一个实例 → 归属随之改变(部署方指向哪个网关就显示哪个)", () => {
    const a = createGatewayImageRoutes(instance({ instanceId: "blksails-cloud" }));
    const b = createGatewayImageRoutes(instance({ instanceId: "cloudflare" }));
    expect(a.generation[0]?.provider).toBe("blksails-cloud");
    expect(b.generation[0]?.provider).toBe("cloudflare");
  });
});

describe("路由键唯一性", () => {
  it("★ 多实例并存 → 同一模型的路由键不互相覆盖", () => {
    const { generation } = createGatewayImageRoutesForAll([
      instance({ instanceId: "blksails-cloud" }),
      instance({ instanceId: "other-gw" }),
    ]);
    const keys = generation.map((r) => r.model);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("缺省实例沿用既有路由键(存量枚举不变)", () => {
    const { generation } = createGatewayImageRoutes(instance({ instanceId: "ai-gateway" }));
    const keys = generation.map((r) => r.model);
    // 既有静态表的三个键,逐字一致。
    expect(keys).toEqual(["gpt-image-1", "gpt-image-2-ai-gateway", "qwen-image"]);
  });
});

describe("模型清单交集(Req 4.1/4.2)", () => {
  it("★ 未声明清单 → 内置白名单全集(与本特性引入前一致)", () => {
    const picked = selectGatewayImageModels(instance());
    expect(picked).toEqual(GATEWAY_IMAGE_MODEL_WHITELIST);
  });

  it("★ 声明为空数组 → 一个都不暴露(不可回退成全集)", () => {
    const picked = selectGatewayImageModels(instance({ imageModels: [] }));
    expect(picked).toEqual([]);
    const { generation, edit } = createGatewayImageRoutes(instance({ imageModels: [] }));
    expect(generation).toEqual([]);
    expect(edit).toEqual([]);
  });

  it("声明子集 → 取交集", () => {
    const picked = selectGatewayImageModels(instance({ imageModels: ["qwen-image"] }));
    expect(picked.map((d) => d.model)).toEqual(["qwen-image"]);
  });

  it("声明中含白名单外的模型 → 被忽略(白名单是上界,只列真机验证过的)", () => {
    const picked = selectGatewayImageModels(
      instance({ imageModels: ["qwen-image", "some-unverified-model"] }),
    );
    expect(picked.map((d) => d.model)).toEqual(["qwen-image"]);
  });
});

describe("凭据与基址", () => {
  it("★ 声明层不落凭据明文:配置里带的是 env 变量名,不是 key 本身", () => {
    const { generation } = createGatewayImageRoutes(instance());
    const serialized = JSON.stringify(generation);
    expect(serialized).not.toContain("desk.cred");
  });

  it("★ 请求地址不出现重复的 /v1", () => {
    const { generation } = createGatewayImageRoutes(instance());
    const serialized = JSON.stringify(generation);
    expect(serialized).not.toContain("/v1/v1");
    expect(serialized).toContain("/api/desktop/egress/v1");
  });
});

describe("零实例", () => {
  it("空实例列表 → 两组路由皆空(未启用时逐字节一致的前提)", () => {
    const set = createGatewayImageRoutesForAll([]);
    expect(set.generation).toEqual([]);
    expect(set.edit).toEqual([]);
  });
});
