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
