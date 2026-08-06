/**
 * 一致性与零侵入守卫（spec ai-gateway-catalog-coldstart，任务 4.2；Req 1.4/2.1/5.1）。
 *
 * 三条不变式：
 *  1. 同一次运行期内先后创建的会话，最终可选的网关模型集合**一致**——不因创建先后而不同
 *     （这正是原缺陷的表象：早建的会话 0 条、晚建的 445 条）。
 *  2. 会话侧的收敛结果与部署级目录**同源**：不得出现只在一侧存在的模型。
 *  3. 未声明网关实例时，行为与本特性实施前**逐字节一致**。
 */
import { describe, expect, it } from "vitest";
import { computeAiGatewaySessionsSpawnEnv } from "../lib/app/ai-gateway-session-assembly.js";
import { makeGatewayModelsResolver } from "../lib/app/ai-gateway-models-resolver.js";
import { resolveAiGatewaySessionSpecsFromEnv } from "@blksails/pi-web-adapters/ai-gateway/index.js";

type Entry = { model: string; ownedBy: string; source: "ai-gateway"; instanceId: string };
const entry = (model: string): Entry => ({
  model,
  ownedBy: "anthropic",
  source: "ai-gateway",
  instanceId: "cf",
});

const CATALOG = [entry("anthropic/claude-opus-5"), entry("openai/gpt-5.5")];
const silent = { info: () => {} };

function resolverOver(snapshot: Entry[]) {
  return makeGatewayModelsResolver({
    catalogs: new Map([["cf", { get: () => snapshot, refresh: async () => {} }]]) as never,
    instances: [{ id: "cf" }] as never,
    waitMs: 50,
    logger: silent,
  });
}

describe("同一运行期内各会话最终集合一致(Req 1.4)", () => {
  it("★ 冷启会话(经拉取补齐)与热启会话(装配期带全)得到同一集合", async () => {
    // 热启:目录已就绪 → 装配期即带全清单
    const hot = computeAiGatewaySessionsSpawnEnv({
      instances: [
        {
          instanceId: "cf",
          baseUrl: "https://cf.example.com/compat",
          apiKey: "k",
          catalog: CATALOG,
        },
      ],
    });
    const hotModels =
      resolveAiGatewaySessionSpecsFromEnv(hot.env as NodeJS.ProcessEnv)[0]?.spec.modelIds ?? [];

    // 冷启:装配期目录为空 → 经拉取取得
    const cold = computeAiGatewaySessionsSpawnEnv({
      instances: [
        {
          instanceId: "cf",
          baseUrl: "https://cf.example.com/compat",
          apiKey: "k",
          catalog: [],
        },
      ],
    });
    const coldSpec = resolveAiGatewaySessionSpecsFromEnv(cold.env as NodeJS.ProcessEnv)[0]?.spec;
    expect(coldSpec?.pendingCatalog).toBe(true);
    const pulled = await resolverOver(CATALOG)(["cf"]);

    expect([...pulled.instances[0]!.models]).toEqual([...hotModels]);
  });
});

describe("会话侧与部署级目录同源(Req 2.1/5.3)", () => {
  it("★ 拉取结果与装配期结果来自同一份收敛,不产生只在一侧存在的模型", async () => {
    // 部署级读数：装配层对同一份目录的收敛
    const assembled = computeAiGatewaySessionsSpawnEnv({
      instances: [
        {
          instanceId: "cf",
          baseUrl: "https://cf.example.com/compat",
          apiKey: "k",
          catalog: [...CATALOG, entry("openai/gpt-4-turbo:batch")],
        },
      ],
    });
    const assembledModels = JSON.parse(
      assembled.env.PI_WEB_AI_GATEWAY_SESSION_CF_MODELS as string,
    ) as string[];

    // 会话侧读数：拉取对同一份目录的收敛
    const pulled = await resolverOver([...CATALOG, entry("openai/gpt-4-turbo:batch")])(["cf"]);

    expect([...pulled.instances[0]!.models].sort()).toEqual([...assembledModels].sort());
    // 不可对话变体在两侧都被剔除(同一判据)
    expect(assembledModels).not.toContain("openai/gpt-4-turbo:batch");
    expect(pulled.instances[0]!.models).not.toContain("openai/gpt-4-turbo:batch");
  });
});

describe("零侵入(Req 5.1)", () => {
  it("未声明任何实例 → 装配产出空对象,解析产出空数组", () => {
    const r = computeAiGatewaySessionsSpawnEnv({ instances: [] });
    expect(r.env).toEqual({});
    expect(resolveAiGatewaySessionSpecsFromEnv({})).toEqual([]);
  });

  it("凭据缺失的实例不产出任何 env 键(不因本特性而「半启用」)", () => {
    const r = computeAiGatewaySessionsSpawnEnv({
      instances: [
        {
          instanceId: "cf",
          baseUrl: "https://cf.example.com/compat",
          apiKey: undefined,
          catalog: CATALOG,
        },
      ],
    });
    expect(r.env).toEqual({});
  });
});
