/**
 * 网关实例三源合并(spec desktop-aigc-egress 任务 2.1)。
 *
 * 头号断言是**零变化保证**:没有授予、没有使用者覆盖时,合并结果必须与 env 来源逐元素
 * 相等。本特性对既有部署的第一承诺就是它(Req 1.2)。
 */
import { describe, it, expect, vi } from "vitest";
import {
  createGrantedGatewayRuntime,
  mergeGatewayInstanceSources,
  toSessionSpawnInstances,
  type InstanceMergeInput,
} from "../lib/app/gateway-grant-assembly.js";
import type {
  CapabilityGatewayGrant,
  GatewayInstanceConfig,
  GatewayModelCatalog,
} from "@blksails/pi-web-adapters/ai-gateway/index.js";

function inst(id: string, baseUrl = `https://${id}.example`): GatewayInstanceConfig {
  return {
    id: id as GatewayInstanceConfig["id"],
    baseUrl,
    apiKey: `key-${id}`,
    allowedOwners: new Set(["openai"]),
    ttlMs: 300_000,
    timeoutMs: 120_000,
  };
}

function merge(over: Partial<InstanceMergeInput> = {}) {
  return mergeGatewayInstanceSources({
    fromEnv: [],
    userConfiguredIds: new Set<string>(),
    ...over,
  });
}

describe("mergeGatewayInstanceSources", () => {
  it("★ 零变化保证:无授予无覆盖 → 与 fromEnv 逐元素相等(同一对象引用,不是复制)", () => {
    const envInstances = [inst("ai-gateway"), inst("cloudflare")];
    const out = merge({ fromEnv: envInstances });
    expect(out.instances).toHaveLength(2);
    // 逐元素同一引用:任何"顺手规范化一下"的改写都会在此暴露。
    expect(out.instances[0]).toBe(envInstances[0]);
    expect(out.instances[1]).toBe(envInstances[1]);
    expect(out.overriddenByUser).toEqual([]);
    expect(out.grantShadowedByEnv).toEqual([]);
  });

  it("无 env 无授予 → 空列表(套件整体不注册)", () => {
    expect(merge().instances).toEqual([]);
  });

  it("授予实例在无冲突时被追加", () => {
    const grant = inst("blksails-cloud");
    const out = merge({ fromEnv: [inst("ai-gateway")], fromGrant: grant });
    expect(out.instances.map((i) => i.id)).toEqual(["ai-gateway", "blksails-cloud"]);
    expect(out.instances[1]).toBe(grant);
  });

  it("★ 使用者自填同名 → 使用者胜,且让位事实进入 overriddenByUser(Req 6.3 不静默)", () => {
    const out = merge({
      fromGrant: inst("blksails-cloud"),
      userConfiguredIds: new Set(["blksails-cloud"]),
    });
    expect(out.instances).toEqual([]);
    expect(out.overriddenByUser).toEqual(["blksails-cloud"]);
  });

  it("★ 使用者自填也压得过 env 实例(次序:使用者 > env > 授予)", () => {
    const out = merge({
      fromEnv: [inst("ai-gateway"), inst("cloudflare")],
      userConfiguredIds: new Set(["ai-gateway"]),
    });
    expect(out.instances.map((i) => i.id)).toEqual(["cloudflare"]);
    expect(out.overriddenByUser).toEqual(["ai-gateway"]);
  });

  it("★ env 与授予同名 → env 胜,且记在 grantShadowedByEnv 而非 overriddenByUser", () => {
    const envInst = inst("blksails-cloud", "https://deployment.example");
    const out = merge({
      fromEnv: [envInst],
      fromGrant: inst("blksails-cloud", "https://cloud.example"),
    });
    expect(out.instances).toHaveLength(1);
    expect(out.instances[0]).toBe(envInst);
    // 两类让位不可混为一谈:一个是使用者的选择,一个是部署方配置更具体。
    expect(out.grantShadowedByEnv).toEqual(["blksails-cloud"]);
    expect(out.overriddenByUser).toEqual([]);
  });

  it("env 列表内重复标识 → 保留先出现的,不被后者覆盖", () => {
    const first = inst("dup", "https://first.example");
    const out = merge({ fromEnv: [first, inst("dup", "https://second.example")] });
    expect(out.instances).toHaveLength(1);
    expect(out.instances[0]).toBe(first);
  });

  it("使用者配置了不相干的标识 → 不影响任何实例", () => {
    const out = merge({
      fromEnv: [inst("ai-gateway")],
      fromGrant: inst("blksails-cloud"),
      userConfiguredIds: new Set(["qiniu", "apiservices"]),
    });
    expect(out.instances.map((i) => i.id)).toEqual(["ai-gateway", "blksails-cloud"]);
    expect(out.overriddenByUser).toEqual([]);
  });
});

describe("createGrantedGatewayRuntime · 惰性求值", () => {
  const GRANT: CapabilityGatewayGrant = {
    baseUrl: "https://pi-cloud.apps.blksails.cn/api/desktop/egress/v1",
    expiresAt: 9_999_999_999,
  };

  /** 可变登录态桩:模拟 AuthSessionState 那样被端点写、被消费方读。 */
  function makeRuntime(opts: {
    fromEnv?: readonly GatewayInstanceConfig[];
    envCatalogs?: ReadonlyMap<string, GatewayModelCatalog>;
  } = {}) {
    const state = {
      credential: undefined as string | undefined,
      grant: undefined as CapabilityGatewayGrant | undefined,
      userIds: new Set<string>(),
    };
    const createCatalogs = vi.fn((instances: readonly GatewayInstanceConfig[]) => {
      const m = new Map<string, GatewayModelCatalog>();
      for (const i of instances) {
        m.set(i.id, { __id: i.id, get: () => [] } as unknown as GatewayModelCatalog);
      }
      return m as ReadonlyMap<string, GatewayModelCatalog>;
    });
    const runtime = createGrantedGatewayRuntime({
      fromEnv: opts.fromEnv ?? [],
      envCatalogs: opts.envCatalogs ?? new Map(),
      getCredential: () => state.credential,
      getGrant: () => state.grant,
      getUserConfiguredIds: () => state.userIds,
      createCatalogs: createCatalogs as never,
    });
    return { runtime, state, createCatalogs };
  }

  it("★ 未登录 → 退化为纯 env 结果(与本特性引入前逐元素相等)", () => {
    const envInstances = [inst("ai-gateway")];
    const envCatalogs = new Map<string, GatewayModelCatalog>([
      ["ai-gateway", { __id: "env", get: () => [] } as unknown as GatewayModelCatalog],
    ]);
    const { runtime, createCatalogs } = makeRuntime({ fromEnv: envInstances, envCatalogs });
    const view = runtime.current();
    expect(view.instances).toHaveLength(1);
    expect(view.instances[0]).toBe(envInstances[0]);
    // env 实例复用装配期建好的目录,不重建(否则每次求值都清空 TTL 快照)。
    expect(view.catalogs.get("ai-gateway")).toBe(envCatalogs.get("ai-gateway"));
    expect(createCatalogs).not.toHaveBeenCalled();
  });

  it("★ 登录后无需重启即出现授予实例(Req 4.3)", () => {
    const { runtime, state } = makeRuntime();
    expect(runtime.current().instances).toEqual([]);

    // 模拟鉴权端点写入登录态 —— 装配期已过,若实例列表算死在装配期,这里将永远看不到变化。
    state.credential = "desk.cred";
    state.grant = GRANT;

    const after = runtime.current();
    expect(after.instances.map((i) => i.id)).toEqual(["blksails-cloud"]);
    expect(after.instances[0]?.baseUrl).toBe(
      "https://pi-cloud.apps.blksails.cn/api/desktop/egress",
    );
    expect(after.catalogs.has("blksails-cloud")).toBe(true);
  });

  it("★ 登出后授予实例与其目录一并消失(Req 8.4)", () => {
    const { runtime, state } = makeRuntime();
    state.credential = "desk.cred";
    state.grant = GRANT;
    expect(runtime.current().instances).toHaveLength(1);

    state.credential = undefined;
    const after = runtime.current();
    expect(after.instances).toEqual([]);
    expect(after.catalogs.size).toBe(0);
  });

  it("★ 切号 → 目录重建,不复用上一个账号按其 key 可见性拉到的那份", () => {
    const { runtime, state, createCatalogs } = makeRuntime();
    state.credential = "user-a.cred";
    state.grant = GRANT;
    const a = runtime.current().catalogs.get("blksails-cloud");
    expect(createCatalogs).toHaveBeenCalledTimes(1);

    state.credential = "user-b.cred";
    const b = runtime.current().catalogs.get("blksails-cloud");
    expect(createCatalogs).toHaveBeenCalledTimes(2);
    expect(b).not.toBe(a);
  });

  it("凭据与授予未变 → 复用缓存,不重复建目录", () => {
    const { runtime, state, createCatalogs } = makeRuntime();
    state.credential = "desk.cred";
    state.grant = GRANT;
    const first = runtime.current();
    const second = runtime.current();
    expect(second).toBe(first);
    expect(createCatalogs).toHaveBeenCalledTimes(1);
  });

  it("授予的图像清单变化 → 视图重建(缓存键含它)", () => {
    const { runtime, state } = makeRuntime();
    state.credential = "desk.cred";
    state.grant = GRANT;
    const first = runtime.current();
    state.grant = { ...GRANT, imageModels: ["gpt-image-2"] };
    expect(runtime.current()).not.toBe(first);
  });

  it("有凭据但无授予 → 不产生授予实例(两者无蕴含关系)", () => {
    const { runtime, state } = makeRuntime();
    state.credential = "desk.cred";
    expect(runtime.current().instances).toEqual([]);
  });

  describe("toSessionSpawnInstances · 会话下发", () => {
    it("★ 授予实例用自带的桌面凭据,不回 env 找(回 env 找会解析出空,被静默跳过)", () => {
      const { runtime, state } = makeRuntime();
      state.credential = "desk.cred";
      state.grant = GRANT;
      // env 解析器对授予实例必定返回 undefined —— 那把 key 根本不在 env 里。
      const resolveEnv = vi.fn(() => undefined);
      const out = toSessionSpawnInstances(runtime.current(), resolveEnv);
      expect(out).toHaveLength(1);
      expect(out[0]?.apiKey).toBe("desk.cred");
      expect(resolveEnv).not.toHaveBeenCalled();
    });

    it("env 来源实例(自身无凭据)回落 env 解析,既有路径不变", () => {
      const envInst = { ...inst("ai-gateway"), apiKey: "" };
      const { runtime } = makeRuntime({ fromEnv: [envInst] });
      const out = toSessionSpawnInstances(runtime.current(), () => "from-env-key");
      expect(out[0]?.apiKey).toBe("from-env-key");
    });

    it("下发的 baseUrl 是裸基址(下游自己补 /v1,重复即 /v1/v1)", () => {
      const { runtime, state } = makeRuntime();
      state.credential = "desk.cred";
      state.grant = GRANT;
      const out = toSessionSpawnInstances(runtime.current(), () => undefined);
      expect(out[0]?.baseUrl).toBe("https://pi-cloud.apps.blksails.cn/api/desktop/egress");
      expect(out[0]?.baseUrl).not.toMatch(/\/v1$/);
    });
  });
});
