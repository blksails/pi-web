/**
 * DesktopCapabilitiesClient 单测(desktop-hybrid-agent-sources)。
 */
import { describe, it, expect, vi } from "vitest";
import {
  createDesktopCapabilitiesClient,
  deriveCapabilitiesUrlFromEgressBase,
  resolveDesktopCapabilitiesUrl,
  type CapabilitiesFetch,
} from "../../src/auth/desktop-capabilities-client.js";

function jsonResponse(
  status: number,
  body: unknown,
): Awaited<ReturnType<CapabilitiesFetch>> {
  return {
    status,
    text: async () => JSON.stringify(body),
  };
}

describe("deriveCapabilitiesUrlFromEgressBase / resolveDesktopCapabilitiesUrl", () => {
  it("从 egress/v1 推导 capabilities", () => {
    expect(
      deriveCapabilitiesUrlFromEgressBase(
        "https://pi-cloud.example/api/desktop/egress/v1",
      ),
    ).toBe("https://pi-cloud.example/api/desktop/capabilities");
  });

  it("显式 PI_WEB_CLOUD_CAPABILITIES_URL 优先", () => {
    expect(
      resolveDesktopCapabilitiesUrl({
        PI_WEB_CLOUD_CAPABILITIES_URL: "https://x.example/cap",
        PI_WEB_CLOUD_LOGIN_EGRESS_BASE: "https://pi-cloud.example/api/desktop/egress/v1",
      }),
    ).toBe("https://x.example/cap");
  });

  it("未配置 → undefined", () => {
    expect(resolveDesktopCapabilitiesUrl({})).toBeUndefined();
  });
});

describe("createDesktopCapabilitiesClient", () => {
  it("无凭据 → undefined 且不 fetch", async () => {
    const fetchImpl = vi.fn<CapabilitiesFetch>();
    const client = createDesktopCapabilitiesClient({
      capabilitiesUrl: "https://cloud.example/api/desktop/capabilities",
      getDesktopCredential: () => undefined,
      fetchImpl,
    });
    await expect(client.getSourcesGrant()).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("成功解析 sources 并缓存到 expiresAt", async () => {
    let nowMs = 1_000_000_000_000; // fixed
    const fetchImpl = vi.fn<CapabilitiesFetch>(async () =>
      jsonResponse(200, {
        tenant: { userId: "u", companyId: "c", role: "member" },
        sources: {
          baseUrl: "https://registry.example/v1",
          token: "consume-tok",
          expiresAt: Math.floor(nowMs / 1000) + 3600,
        },
      }),
    );
    const client = createDesktopCapabilitiesClient({
      capabilitiesUrl: "https://cloud.example/api/desktop/capabilities",
      getDesktopCredential: () => "desktop-cred.sig",
      fetchImpl,
      now: () => nowMs,
      expirySkewSeconds: 30,
    });
    const g1 = await client.getSourcesGrant();
    expect(g1).toEqual({
      baseUrl: "https://registry.example/v1",
      token: "consume-tok",
    });
    const g2 = await client.getSourcesGrant();
    expect(g2).toEqual(g1);
    expect(fetchImpl).toHaveBeenCalledOnce();

    // 过期后重拉
    nowMs += 4000 * 1000;
    await client.getSourcesGrant();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("401 清缓存并返回 undefined", async () => {
    const fetchImpl = vi.fn<CapabilitiesFetch>(async () =>
      jsonResponse(401, { error: "unauthorized" }),
    );
    const client = createDesktopCapabilitiesClient({
      capabilitiesUrl: "https://cloud.example/api/desktop/capabilities",
      getDesktopCredential: () => "bad.cred",
      fetchImpl,
    });
    await expect(client.getSourcesGrant()).resolves.toBeUndefined();
  });

  it("缺 sources 字段 → undefined", async () => {
    const client = createDesktopCapabilitiesClient({
      capabilitiesUrl: "https://cloud.example/api/desktop/capabilities",
      getDesktopCredential: () => "ok.cred",
      fetchImpl: async () =>
        jsonResponse(200, { tenant: { userId: "u", companyId: "c", role: "m" } }),
    });
    await expect(client.getSourcesGrant()).resolves.toBeUndefined();
  });

  it("切号凭据变化 → 不复用旧缓存", async () => {
    let cred = "user-a.sig";
    let nowMs = 1_000_000_000_000;
    const fetchImpl = vi.fn<CapabilitiesFetch>(async (_url, init) => {
      const auth = init.headers.authorization ?? "";
      const tok = auth.includes("user-a") ? "tok-a" : "tok-b";
      return jsonResponse(200, {
        sources: {
          baseUrl: "https://registry.example/v1",
          token: tok,
          expiresAt: Math.floor(nowMs / 1000) + 3600,
        },
      });
    });
    const client = createDesktopCapabilitiesClient({
      capabilitiesUrl: "https://cloud.example/api/desktop/capabilities",
      getDesktopCredential: () => cred,
      fetchImpl,
      now: () => nowMs,
    });
    const a = await client.getSourcesGrant();
    expect(a?.token).toBe("tok-a");
    cred = "user-b.sig";
    const b = await client.getSourcesGrant();
    expect(b?.token).toBe("tok-b");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// publish 授予(spec publish-grant-issuance Req 5.1 / publish-execution 真机回归)
//
// ★ 这组用例是**真机踩出来的**:P1 给类型加了 `publish` 字段、也写了 `getPublishGrant()`,
//   却漏了解析器 —— `snapshot.publish` 恒 undefined,公钥登记永远静默跳过,
//   真机表现为"登录了也发不出去",而单测全绿。
//
//   当时的"测试"只用 stub 直接喂 `getPublishGrant()`,从没用**真实响应体**走过解析。
//   隔壁 `sources` 恰恰是照这个正确方式测的 —— 照着写就不会漏。
//   **教训:测一个取数方法,要从它真正的输入(HTTP 响应体)喂起,而不是从它的返回值假设起。**
// ─────────────────────────────────────────────────────────────────────────────
describe("publish 授予", () => {
  const PUBLISH = {
    baseUrl: "https://registry.example",
    token: "publish-tok",
    publisherId: "pub-1",
    org: "blksails",
  };

  it("★ 从真实响应体解析出 publish 授予(这条当初缺席,故障因此漏网)", async () => {
    const client = createDesktopCapabilitiesClient({
      capabilitiesUrl: "https://cloud.example/api/desktop/capabilities",
      getDesktopCredential: () => "ok.cred",
      fetchImpl: async () =>
        jsonResponse(200, {
          tenant: { userId: "u", companyId: "1", role: "m" },
          publish: { ...PUBLISH, expiresAt: 9_999_999_999 },
        }),
    });
    await expect(client.getPublishGrant()).resolves.toEqual(PUBLISH);
  });

  it("缺 publish 字段 → undefined(未配置 org 的企业,正常状态)", async () => {
    const client = createDesktopCapabilitiesClient({
      capabilitiesUrl: "https://cloud.example/api/desktop/capabilities",
      getDesktopCredential: () => "ok.cred",
      fetchImpl: async () =>
        jsonResponse(200, { tenant: { userId: "u", companyId: "1", role: "m" } }),
    });
    await expect(client.getPublishGrant()).resolves.toBeUndefined();
  });

  it("★ 四项缺任一 → 整体作废(半身份授予去发布只会在服务端以难懂的方式失败)", async () => {
    for (const missing of ["baseUrl", "token", "publisherId", "org"] as const) {
      const partial: Record<string, unknown> = { ...PUBLISH };
      delete partial[missing];
      const client = createDesktopCapabilitiesClient({
        capabilitiesUrl: "https://cloud.example/api/desktop/capabilities",
        getDesktopCredential: () => "ok.cred",
        fetchImpl: async () =>
          jsonResponse(200, {
            tenant: { userId: "u", companyId: "1", role: "m" },
            publish: partial,
          }),
      });
      await expect(client.getPublishGrant(), `缺 ${missing} 应作废`).resolves.toBeUndefined();
    }
  });

  it("无凭据 → undefined,且不打网络", async () => {
    const fetchImpl = vi.fn<CapabilitiesFetch>();
    const client = createDesktopCapabilitiesClient({
      capabilitiesUrl: "https://cloud.example/api/desktop/capabilities",
      getDesktopCredential: () => undefined,
      fetchImpl,
    });
    await expect(client.getPublishGrant()).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("★ publish 的 expiresAt 参与缓存到期计算(它 TTL 更短,漏算会让过期授予被复用)", async () => {
    let nowMs = 1_000_000_000_000;
    const nowS = Math.floor(nowMs / 1000);
    const fetchImpl = vi.fn<CapabilitiesFetch>(async () =>
      jsonResponse(200, {
        tenant: { userId: "u", companyId: "1", role: "m" },
        sources: { baseUrl: "https://r.example", token: "c", expiresAt: nowS + 86400 },
        publish: { ...PUBLISH, expiresAt: nowS + 600 },
      }),
    );
    const client = createDesktopCapabilitiesClient({
      capabilitiesUrl: "https://cloud.example/api/desktop/capabilities",
      getDesktopCredential: () => "ok.cred",
      fetchImpl,
      now: () => nowMs,
      expirySkewSeconds: 30,
    });
    await client.getPublishGrant();
    expect(fetchImpl).toHaveBeenCalledOnce();

    // 越过 publish 的到期(但远未到 sources 的)→ 必须重拉。
    // 若只按 sources 算到期,这里会命中缓存,拿着一枚已过期的 publish token 去发布。
    nowMs += 700 * 1000;
    await client.getPublishGrant();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("gateway 授予(spec desktop-aigc-egress 任务 1.2)", () => {
  const TENANT = { userId: "u", companyId: "1", role: "m" };

  function clientWith(body: unknown) {
    return createDesktopCapabilitiesClient({
      capabilitiesUrl: "https://cloud.example/api/desktop/capabilities",
      getDesktopCredential: () => "ok.cred",
      fetchImpl: async () => jsonResponse(200, body),
    });
  }

  it("★ 从真实响应体解析出 gateway 授予(照 publish 的前车之鉴:只 stub 返回值测不出解析器缺席)", async () => {
    const snap = await clientWith({
      tenant: TENANT,
      gateway: {
        baseUrl: "https://cloud.example/api/desktop/egress/v1",
        expiresAt: 9_999_999_999,
      },
    }).loadStatic();
    expect(snap.gateway).toEqual({
      baseUrl: "https://cloud.example/api/desktop/egress/v1",
      expiresAt: 9_999_999_999,
    });
  });

  it("★ imageModels 缺失 ≠ 空数组:缺失 → undefined(回退白名单)", async () => {
    const snap = await clientWith({
      tenant: TENANT,
      gateway: { baseUrl: "https://cloud.example/egress/v1", expiresAt: 9_999_999_999 },
    }).loadStatic();
    expect(snap.gateway?.imageModels).toBeUndefined();
  });

  it("★ imageModels 缺失 ≠ 空数组:空数组 → 保留空数组(云端明确声明一个都没有)", async () => {
    const snap = await clientWith({
      tenant: TENANT,
      gateway: {
        baseUrl: "https://cloud.example/egress/v1",
        imageModels: [],
        expiresAt: 9_999_999_999,
      },
    }).loadStatic();
    // 若这里被归一成 undefined,「云端还没支持」就会伪装成「账号已开通全部白名单模型」。
    expect(snap.gateway?.imageModels).toEqual([]);
  });

  it("imageModels 逐项过滤空串并 trim,保留其余", async () => {
    const snap = await clientWith({
      tenant: TENANT,
      gateway: {
        baseUrl: "https://cloud.example/egress/v1",
        imageModels: [" gpt-image-2 ", "", "   ", "qwen-image", 42, null],
        expiresAt: 9_999_999_999,
      },
    }).loadStatic();
    expect(snap.gateway?.imageModels).toEqual(["gpt-image-2", "qwen-image"]);
  });

  it("缺 gateway 字段 → undefined(云端未启用,正常状态)", async () => {
    const snap = await clientWith({ tenant: TENANT }).loadStatic();
    expect(snap.gateway).toBeUndefined();
  });

  it("baseUrl 缺失或空白 → 整体作废(没有地址的出口授予无法使用)", async () => {
    for (const bad of [undefined, "", "   ", 42]) {
      const snap = await clientWith({
        tenant: TENANT,
        gateway: { baseUrl: bad, expiresAt: 9_999_999_999 },
      }).loadStatic();
      expect(snap.gateway, `baseUrl=${JSON.stringify(bad)} 应作废`).toBeUndefined();
    }
  });

  it("★ gateway 解析失败只使该字段缺失,不牵连 egress / sources(契约不变式 1)", async () => {
    const snap = await clientWith({
      tenant: TENANT,
      gateway: "not-an-object",
      egress: {
        baseUrl: "https://cloud.example/egress/v1",
        models: ["m1"],
        expiresAt: 9_999_999_999,
      },
      sources: {
        baseUrl: "https://registry.example",
        token: "src-tok",
        expiresAt: 9_999_999_999,
      },
    }).loadStatic();
    expect(snap.gateway).toBeUndefined();
    expect(snap.egress?.baseUrl).toBe("https://cloud.example/egress/v1");
    expect(snap.sources?.token).toBe("src-tok");
  });
});
