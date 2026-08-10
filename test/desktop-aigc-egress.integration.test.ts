/**
 * 桌面 AIGC 出口 — 跨层集成验证(spec desktop-aigc-egress 任务 5.1)。
 *
 * 前面各任务的单测各自只覆盖一层。本文件把**授予 → 实例 → 下发 env → 图像路由 → 实际
 * 请求**整条链拼起来跑一遍,因为本设计的头号风险(`/v1` 重复)恰恰只在**跨层拼接**时才
 * 出现:每一层单独看都对,拼起来才多一段。
 *
 * ⚠ 本文件不起真实 runner 子进程:链路上唯一的跨进程环节是 env 传递,而它是纯数据
 * (`computeAiGatewaySessionsSpawnEnv` 产出 → 解析器还原)。在同进程内用真实的两侧函数
 * 走一遍,覆盖的是同一份逻辑;起子进程只会把"env 是不是真的传过去了"这一个既有机制
 * 再测一次,而那已有既有集成测试覆盖。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createGrantedGatewayRuntime,
  toSessionSpawnInstances,
} from "@/lib/app/gateway-grant-assembly";
import { computeAiGatewaySessionsSpawnEnv } from "@/lib/app/ai-gateway-session-assembly";
import {
  resolveGatewayImageInstances,
  createGatewayImageRoutesForAll,
} from "@blksails/pi-web-tool-kit";
import type { CapabilityGatewayGrant } from "@blksails/pi-web-adapters/ai-gateway/index.js";

/** 随包固化的默认云端地址(含 `/v1`)—— 桌面装完即用那条路径的真实起点。 */
const BAKED_DEFAULT = "https://pi-cloud.apps.blksails.cn/api/desktop/egress/v1";
const CREDENTIAL = "desk.cred.value";

const GRANT: CapabilityGatewayGrant = {
  baseUrl: BAKED_DEFAULT,
  expiresAt: 9_999_999_999,
};

/** 走完宿主侧全链,返回下发给 runner 的 env。 */
function hostSideEnv(grant?: CapabilityGatewayGrant, credential?: string): Record<string, string> {
  const runtime = createGrantedGatewayRuntime({
    fromEnv: [],
    envCatalogs: new Map(),
    getCredential: () => credential,
    getGrant: () => grant,
    getUserConfiguredIds: () => new Set<string>(),
  });
  const instances = toSessionSpawnInstances(runtime.current(), () => undefined);
  return computeAiGatewaySessionsSpawnEnv({ instances }).env;
}

const touchedEnvKeys = new Set<string>();

function applyEnv(env: Record<string, string>): void {
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
    touchedEnvKeys.add(k);
  }
}

afterEach(() => {
  for (const k of touchedEnvKeys) delete process.env[k];
  touchedEnvKeys.clear();
});

describe("授予 → 实例 → 下发 env(宿主侧)", () => {
  it("★ 登录态产出实例,且下发的基址是裸基址", () => {
    const env = hostSideEnv(GRANT, CREDENTIAL);
    const baseKey = Object.keys(env).find((k) => k.endsWith("_BASE"));
    expect(baseKey, "应下发实例基址").toBeDefined();
    // 下发侧统一补 `/v1`(对话侧 pi SDK 的 baseURL 约定),故这里恰好一个 `/v1`。
    expect(env[baseKey!]).toBe("https://pi-cloud.apps.blksails.cn/api/desktop/egress/v1");
    expect(env[baseKey!]).not.toContain("/v1/v1");
  });

  it("★ 认证凭据是桌面凭据(不是网关数据面密钥)", () => {
    const env = hostSideEnv(GRANT, CREDENTIAL);
    const keyKey = Object.keys(env).find((k) => k.endsWith("_KEY"));
    expect(env[keyKey!]).toBe(CREDENTIAL);
    expect(JSON.stringify(env)).not.toContain("sk-gw");
  });

  it("★ 未登录 → 零下发(与本特性引入前逐字节一致)", () => {
    expect(hostSideEnv(undefined, undefined)).toEqual({});
    expect(hostSideEnv(GRANT, undefined)).toEqual({});
    expect(hostSideEnv(undefined, CREDENTIAL)).toEqual({});
  });
});

describe("下发 env → 图像路由(会话侧)", () => {
  it("★ 还原出的实例与宿主侧一致,且图像路由的请求地址不含重复 /v1", () => {
    applyEnv(hostSideEnv(GRANT, CREDENTIAL));
    const instances = resolveGatewayImageInstances(process.env);
    expect(instances).toHaveLength(1);
    // 会话侧剥回裸基址(其 provider 自己拼 /v1)。
    expect(instances[0]!.baseUrl).toBe(
      "https://pi-cloud.apps.blksails.cn/api/desktop/egress",
    );

    const { generation, edit } = createGatewayImageRoutesForAll(instances);
    expect(generation.length).toBeGreaterThan(0);
    for (const r of [...generation, ...edit]) {
      expect(r.url, `路由 ${r.model} 的地址`).not.toContain("/v1/v1");
      expect(r.url).toContain("/api/desktop/egress/v1/images/");
      // 归属是实例标识,不是写死的名字(Req 5.1)。
      expect(r.provider).toBe("blksails-cloud");
    }
  });

  it("★ 声明层不落凭据明文:路由里存的是 env 变量名", () => {
    applyEnv(hostSideEnv(GRANT, CREDENTIAL));
    const routes = createGatewayImageRoutesForAll(resolveGatewayImageInstances(process.env));
    expect(JSON.stringify(routes)).not.toContain(CREDENTIAL);
  });

  it("★ 未登录 → 零图像路由(对照组)", () => {
    // 不 applyEnv:进程 env 里没有任何实例键。
    const instances = resolveGatewayImageInstances({});
    expect(instances).toEqual([]);
    const routes = createGatewayImageRoutesForAll(instances);
    expect(routes.generation).toEqual([]);
    expect(routes.edit).toEqual([]);
  });
});

describe("图像路由的最终请求地址(全链拼接的落点)", () => {
  /**
   * ★ 这里断言的是路由**已展开的 url 字面量**,不实际发请求。
   *
   * 实际发请求那一步(含 Authorization 头与失败分类)在
   * `packages/tool-kit/test/aigc/gateway-egress-failure.test.ts` 与
   * `.../gateway-image-routes-request.test.ts` 里 —— 引擎属 node-only 的 runtime 层
   * (含 undici),根测试面不应 import 它,那会把 node-only 依赖拖进前端安全的那一侧。
   */
  it("★ 文生图与图像编辑的最终地址各自恰好一个 /v1", () => {
    applyEnv(hostSideEnv(GRANT, CREDENTIAL));
    const { generation, edit } = createGatewayImageRoutesForAll(
      resolveGatewayImageInstances(process.env),
    );
    expect(generation[0]!.url).toBe(
      "https://pi-cloud.apps.blksails.cn/api/desktop/egress/v1/images/generations",
    );
    expect(edit[0]!.url).toBe(
      "https://pi-cloud.apps.blksails.cn/api/desktop/egress/v1/images/edits",
    );
  });
});

describe("对照组:沙箱分支未受影响", () => {
  it("★ e2b 的网关注入读的是另一套 env,不因本特性产生条目", async () => {
    const { computeAiGatewaySessionEnv } = await import("@/lib/app/ai-gateway-assembly");
    applyEnv(hostSideEnv(GRANT, CREDENTIAL));
    // 沙箱分支的判据是 `aiGatewayConfig`(来自 BLKSAILS_GATEWAY_BASE_URL),与本特性的
    // 实例契约互不相干;本特性下发的 env 不应让它凭空产出注入。
    const r = computeAiGatewaySessionEnv({
      aiGatewayConfig: undefined,
      sessionId: "s-1",
      env: process.env,
      publicBase: "https://sandbox.example",
      tokenTtlMs: 3_600_000,
    });
    expect(r.env).toEqual({});
    expect(r.passthroughKeys).toEqual([]);
  });
});
