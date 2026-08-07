/**
 * 授予 → 网关实例(spec desktop-aigc-egress 任务 1.3)。
 *
 * 本文件的头号职责是钉死**裸基址不变式**:授予地址含 `/v1`,实例地址不含。不剥就会打到
 * `…/egress/v1/v1/models`,而那是一个 404 加一条完全不指向根因的错误信息。
 */
import { describe, it, expect } from "vitest";
import {
  grantedGatewayInstance,
  toBareGatewayBaseUrl,
  GRANTED_GATEWAY_INSTANCE_ID,
} from "../../src/ai-gateway/granted-instances.js";
import { createGatewayCatalogs } from "../../src/ai-gateway/instances.js";
import type { CapabilityGatewayGrant } from "@blksails/pi-web-core/capability/types.js";

/**
 * ★ 随包固化的默认云端地址(`lib/app/cloud-defaults.ts`),**含 `/v1`**。
 *
 * 刻意用真实的那个值而不是编一个:它是本不变式最可能被违反的入口 —— 桌面版装完即用的
 * 那条路径正是从这个字面量开始的。
 */
const BAKED_DEFAULT = "https://pi-cloud.apps.blksails.cn/api/desktop/egress/v1";

function grant(over: Partial<CapabilityGatewayGrant> = {}): CapabilityGatewayGrant {
  return { baseUrl: BAKED_DEFAULT, expiresAt: 9_999_999_999, ...over };
}

describe("toBareGatewayBaseUrl · 裸基址归一", () => {
  it("★ 随包固化的默认地址(含 /v1)→ 剥为裸基址", () => {
    expect(toBareGatewayBaseUrl(BAKED_DEFAULT)).toBe(
      "https://pi-cloud.apps.blksails.cn/api/desktop/egress",
    );
  });

  it("带尾斜杠的 /v1/ 同样剥净", () => {
    expect(toBareGatewayBaseUrl("https://c.example/api/desktop/egress/v1/")).toBe(
      "https://c.example/api/desktop/egress",
    );
  });

  it("本就是裸基址 → 原样(幂等,重复归一不会越剥越短)", () => {
    const bare = "https://c.example/api/desktop/egress";
    expect(toBareGatewayBaseUrl(bare)).toBe(bare);
    expect(toBareGatewayBaseUrl(toBareGatewayBaseUrl(bare)!)).toBe(bare);
  });

  it("★ 只剥末尾的 /v1,路径中间的 v1 段是部署方的路径结构,不动", () => {
    expect(toBareGatewayBaseUrl("https://c.example/api/v1/desktop/egress")).toBe(
      "https://c.example/api/v1/desktop/egress",
    );
  });

  it("非法输入 → undefined(空白 / 非 URL / 非 http 协议)", () => {
    for (const bad of ["", "   ", "not a url", "ftp://c.example/v1", "/relative/v1"]) {
      expect(toBareGatewayBaseUrl(bad), `${JSON.stringify(bad)} 应判非法`).toBeUndefined();
    }
  });
});

describe("grantedGatewayInstance", () => {
  it("★ 由固化默认授予构造出的实例,其 baseUrl 是裸基址", () => {
    const inst = grantedGatewayInstance({ grant: grant(), credential: "desk.cred" });
    expect(inst?.baseUrl).toBe("https://pi-cloud.apps.blksails.cn/api/desktop/egress");
  });

  it("★ 拼接自洽:实例基址 + 消费方自拼的 /v1/models 不产生 /v1/v1", () => {
    const inst = grantedGatewayInstance({ grant: grant(), credential: "desk.cred" });
    // 这正是 model-catalog.ts 的拼法。
    const catalogUrl = `${inst!.baseUrl}/v1/models`;
    expect(catalogUrl).toBe(
      "https://pi-cloud.apps.blksails.cn/api/desktop/egress/v1/models",
    );
    expect(catalogUrl).not.toContain("/v1/v1");
  });

  it("apiKey 承载桌面凭据(不是 sk-gw)", () => {
    const inst = grantedGatewayInstance({ grant: grant(), credential: "desk.cred" });
    expect(inst?.apiKey).toBe("desk.cred");
  });

  it("实例标识默认与 env 缺省实例不同名(否则本地网关与云端出口互相覆盖)", () => {
    const inst = grantedGatewayInstance({ grant: grant(), credential: "desk.cred" });
    expect(inst?.id).toBe(GRANTED_GATEWAY_INSTANCE_ID);
    expect(inst?.id).not.toBe("ai-gateway");
  });

  it("凭据为空 → undefined 且不抛(能力不可用即降级,非配置错误)", () => {
    expect(grantedGatewayInstance({ grant: grant(), credential: "" })).toBeUndefined();
    expect(grantedGatewayInstance({ grant: grant(), credential: "   " })).toBeUndefined();
  });

  it("地址非法 → undefined 且不抛", () => {
    expect(
      grantedGatewayInstance({ grant: grant({ baseUrl: "nope" }), credential: "c" }),
    ).toBeUndefined();
  });

  it("标识不合法或撞保留名 → undefined", () => {
    for (const bad of ["Bad_Id", "-lead", "anthropic"]) {
      expect(
        grantedGatewayInstance({ grant: grant(), credential: "c", instanceId: bad }),
        `${bad} 应判非法`,
      ).toBeUndefined();
    }
  });

  it("★ allowedOwners 为空集 → 目录不按归属过滤(否则云端目录会被滤成空)", () => {
    const inst = grantedGatewayInstance({ grant: grant(), credential: "desk.cred" });
    expect(inst?.allowedOwners.size).toBe(0);
    // 空集必须在装配为 catalog 时被翻译成「不过滤」。filterByOwner 对 undefined 放行、
    // 对空集全滤,语义相反 —— 这条断言守的就是那个翻译。
    const catalogs = createGatewayCatalogs([inst!], { env: {} });
    const catalog = catalogs.get(inst!.id);
    expect(catalog).toBeDefined();
    expect(
      (catalog as unknown as { allowedOwners?: ReadonlySet<string> }).allowedOwners,
    ).toBeUndefined();
  });
});
