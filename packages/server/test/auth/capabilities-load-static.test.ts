/**
 * DesktopCapabilitiesClient 双失败语义(spec: desktop-account-login,任务 2.2;Req 4.1/4.2/4.3)。
 *
 * 本文件的核心断言是 design.md D3:**同一次失败注入下,`loadStatic()` 抛而
 * `getSourcesGrant()` 返回 undefined**。这条不是风格问题 —— 两个语义各自服务一个场景:
 *  - 登录路径必须 fail-hard(契约 §4.2「失败即拒绝」),否则产生半登录态;
 *  - 源列表枚举必须 fail-soft,否则云端一次抖动就让侧栏连本地源都看不到。
 * 若将来有人「统一」它们,这里的成对断言会立刻转红。
 */
import { describe, it, expect } from "vitest";
import {
  CapabilitiesLoadError,
  createDesktopCapabilitiesClient,
  deriveLoginUrlFromEgressBase,
  type CapabilitiesFetch,
} from "../../src/auth/desktop-capabilities-client.js";

const URL_ = "https://cloud.example/api/desktop/capabilities";
const CRED = "cred-abc";
const NOW_MS = 1_700_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

function clientWith(
  fetchImpl: CapabilitiesFetch,
  credential: string | undefined = CRED,
): ReturnType<typeof createDesktopCapabilitiesClient> {
  return createDesktopCapabilitiesClient({
    capabilitiesUrl: URL_,
    getDesktopCredential: () => credential,
    fetchImpl,
    now: () => NOW_MS,
  });
}

function respond(status: number, body: unknown): CapabilitiesFetch {
  return async () => ({
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

const FULL_BODY = {
  tenant: { userId: "u1", companyId: "c1", role: "member" },
  egress: {
    baseUrl: "https://cloud.example/api/desktop/egress/v1",
    models: ["gpt-x", { id: "claude-y", name: "Claude Y" }],
    expiresAt: NOW_S + 3600,
  },
  sources: {
    baseUrl: "https://registry.example",
    token: "src-token",
    expiresAt: NOW_S + 1800,
  },
};

describe("loadStatic — 三类授予解析(Req 4.1)", () => {
  it("一次取齐 tenant / egress / sources", async () => {
    const snap = await clientWith(respond(200, FULL_BODY)).loadStatic();
    expect(snap.tenant).toEqual({ userId: "u1", companyId: "c1", role: "member" });
    expect(snap.egress?.baseUrl).toBe("https://cloud.example/api/desktop/egress/v1");
    expect(snap.egress?.models).toEqual([{ id: "gpt-x" }, { id: "claude-y", name: "Claude Y" }]);
    expect(snap.sources).toEqual({
      baseUrl: "https://registry.example",
      token: "src-token",
      expiresAt: NOW_S + 1800,
    });
  });

  it("请求带 Bearer 凭据,且凭据不出现在 URL 里", async () => {
    let seenUrl = "";
    let seenAuth = "";
    const snap = await clientWith(async (url, init) => {
      seenUrl = url;
      seenAuth = init.headers.authorization ?? "";
      return { status: 200, text: async () => JSON.stringify(FULL_BODY) };
    }).loadStatic();
    expect(snap.tenant).toBeDefined();
    expect(seenAuth).toBe(`Bearer ${CRED}`);
    expect(seenUrl).not.toContain(CRED);
  });

  it("显式凭据参数覆盖 getDesktopCredential(登录流程用的正是这条路径)", async () => {
    let seenAuth = "";
    const c = createDesktopCapabilitiesClient({
      capabilitiesUrl: URL_,
      getDesktopCredential: () => undefined, // 尚未写入登录态
      fetchImpl: async (_u, init) => {
        seenAuth = init.headers.authorization ?? "";
        return { status: 200, text: async () => JSON.stringify(FULL_BODY) };
      },
      now: () => NOW_MS,
    });
    await c.loadStatic("brand-new-cred");
    expect(seenAuth).toBe("Bearer brand-new-cred");
  });
});

describe("loadStatic — 单项缺失只使该字段缺失,不整体失败(Req 4.3)", () => {
  it.each([
    ["缺 tenant", { egress: FULL_BODY.egress, sources: FULL_BODY.sources }, "tenant"],
    ["缺 egress", { tenant: FULL_BODY.tenant, sources: FULL_BODY.sources }, "egress"],
    ["缺 sources", { tenant: FULL_BODY.tenant, egress: FULL_BODY.egress }, "sources"],
  ])("%s → 该字段 undefined,其余仍在", async (_name, body, missing) => {
    const snap = await clientWith(respond(200, body)).loadStatic();
    expect(snap[missing as "tenant" | "egress" | "sources"]).toBeUndefined();
    for (const k of ["tenant", "egress", "sources"] as const) {
      if (k !== missing) expect(snap[k]).toBeDefined();
    }
  });

  it("tenant 三字段缺一即视为不可用(身份是完整的或根本没有)", async () => {
    const snap = await clientWith(
      respond(200, { tenant: { userId: "u1", companyId: "c1" } }),
    ).loadStatic();
    expect(snap.tenant).toBeUndefined();
  });

  it("egress 模型清单为空 → 视为该能力不可用", async () => {
    const snap = await clientWith(
      respond(200, { egress: { baseUrl: "https://x/v1", models: [] } }),
    ).loadStatic();
    expect(snap.egress).toBeUndefined();
  });

  it("空响应体 {} → 三项全缺但**不抛**(登录仍可成立,只是无任何授予)", async () => {
    const snap = await clientWith(respond(200, {})).loadStatic();
    expect(snap).toEqual({ tenant: undefined, egress: undefined, sources: undefined });
  });
});

describe("★ 同一失败注入下两个方法语义相反(design.md D3)", () => {
  const cases: ReadonlyArray<[string, () => CapabilitiesFetch, CapabilitiesLoadError["kind"]]> = [
    ["网络异常", () => async () => { throw new Error("boom"); }, "network"],
    ["401 鉴权被拒", () => respond(401, {}), "unauthorized"],
    ["403 鉴权被拒", () => respond(403, {}), "unauthorized"],
    ["500 非 2xx", () => respond(500, {}), "bad-status"],
    ["JSON 损坏", () => respond(200, "{ not json"), "bad-response"],
  ];

  it.each(cases)("%s:loadStatic 抛,getSourcesGrant 吞", async (_n, mk, kind) => {
    const a = clientWith(mk());
    await expect(a.loadStatic()).rejects.toBeInstanceOf(CapabilitiesLoadError);
    await expect(a.loadStatic()).rejects.toMatchObject({ kind });

    // 独立实例,避免缓存串扰。
    const b = clientWith(mk());
    await expect(b.getSourcesGrant()).resolves.toBeUndefined();
  });

  it("无凭据:loadStatic 抛 no-credential,getSourcesGrant 返回 undefined", async () => {
    // ⚠ 不能写 clientWith(never, undefined) —— 那会命中默认参数值 CRED,
    //   测的就成了「有凭据 + fetch 抛」而不是「无凭据」。显式构造以避开该陷阱。
    const noCredClient = (): ReturnType<typeof createDesktopCapabilitiesClient> =>
      createDesktopCapabilitiesClient({
        capabilitiesUrl: URL_,
        getDesktopCredential: () => undefined,
        fetchImpl: async () => {
          throw new Error("fetch must not be called without a credential");
        },
        now: () => NOW_MS,
      });
    await expect(noCredClient().loadStatic()).rejects.toMatchObject({
      kind: "no-credential",
    });
    await expect(noCredClient().getSourcesGrant()).resolves.toBeUndefined();
  });

  it("2xx 但缺 sources:loadStatic **成功**(其余字段可用),getSourcesGrant 才返回 undefined", async () => {
    // 这一条区分「整体失败」与「单项不可用」—— 两者都让 getSourcesGrant 返回 undefined,
    // 但只有前者该让登录失败。
    const c = clientWith(respond(200, { tenant: FULL_BODY.tenant }));
    await expect(c.loadStatic()).resolves.toMatchObject({ tenant: FULL_BODY.tenant });
    await expect(c.getSourcesGrant()).resolves.toBeUndefined();
  });
});

describe("缓存与凭据绑定", () => {
  it("同凭据在有效期内只打一次云端", async () => {
    let calls = 0;
    const c = clientWith(async () => {
      calls += 1;
      return { status: 200, text: async () => JSON.stringify(FULL_BODY) };
    });
    await c.loadStatic();
    await c.loadStatic();
    await c.getSourcesGrant();
    expect(calls).toBe(1);
  });

  it("clearCache 后重新取数(登出/切号必须清,否则残留上一个用户的 token)", async () => {
    let calls = 0;
    const c = clientWith(async () => {
      calls += 1;
      return { status: 200, text: async () => JSON.stringify(FULL_BODY) };
    });
    await c.loadStatic();
    c.clearCache();
    await c.loadStatic();
    expect(calls).toBe(2);
  });

  it("凭据变化即缓存失效", async () => {
    let calls = 0;
    let cred = "cred-a";
    const c = createDesktopCapabilitiesClient({
      capabilitiesUrl: URL_,
      getDesktopCredential: () => cred,
      fetchImpl: async () => {
        calls += 1;
        return { status: 200, text: async () => JSON.stringify(FULL_BODY) };
      },
      now: () => NOW_MS,
    });
    await c.loadStatic();
    cred = "cred-b";
    await c.loadStatic();
    expect(calls).toBe(2);
  });
});

describe("deriveLoginUrlFromEgressBase(任务 2.3)", () => {
  it.each([
    ["https://h/api/desktop/egress/v1", "https://h/api/desktop/login"],
    ["https://h/api/desktop/egress", "https://h/api/desktop/login"],
    ["https://h/api/desktop/egress/v1/", "https://h/api/desktop/login"],
    ["https://h/base/api/desktop/egress/v2", "https://h/base/api/desktop/login"],
  ])("%s → %s", (input, expected) => {
    expect(deriveLoginUrlFromEgressBase(input)).toBe(expected);
  });

  it.each(["", "   ", "not a url", "https://h/other/path"])(
    "无法识别 → undefined:%s",
    (input) => {
      expect(deriveLoginUrlFromEgressBase(input)).toBeUndefined();
    },
  );
});
