/**
 * ★ 冷启竞态的端到端判据（spec ai-gateway-catalog-coldstart，任务 4.1；
 *   Req 1.1/1.2/3.3/6.1/6.2/6.3）。
 *
 * ## 为什么这条判据必须存在
 *
 * 这个缺陷在真机上**两次**独立触发（一次用户使用中，一次调查复验时），但离线测试全绿——
 * 因为没有任何用例构造过「目录未就绪」这个窗口。竞态判据若只能靠真实时序碰巧命中，
 * 跑绿说明不了任何事（Req 6.1「不依赖真实时序巧合」）。
 *
 * ## 构造窗口的接缝
 *
 * 目录用受控替身：`get()` 返回当前快照，`refresh()` 由测试决定何时以及是否填充。于是
 * 「会话先起、目录后到」可以**确定性地**排列出来，而不是 sleep 一下碰运气。
 *
 * ## 这条链路覆盖的三段
 *
 *   装配层（目录空 → 仍下发 BASE/KEY，不下发 MODELS）
 *     → runner 侧（解析为 pendingCatalog，空集占位注册，发起索取）
 *       → 宿主应答（等待目录 → 收敛后清单）
 *         → runner 补注册（覆盖）→ 清单可见，且**全程未重建会话**
 *
 * 任一段还原为旧行为，本文件第一例即报红（任务 4.1 的完成判据要求逐段验证）。
 */
import { describe, expect, it, vi } from "vitest";
import { computeAiGatewaySessionsSpawnEnv } from "../lib/app/ai-gateway-session-assembly.js";
import { makeGatewayModelsResolver } from "../lib/app/ai-gateway-models-resolver.js";
import { resolveAiGatewaySessionSpecsFromEnv } from "@blksails/pi-web-adapters/ai-gateway/index.js";
import {
  attachGatewayModelsChannel,
  registerGatewayModelsPending,
  resetGatewayModelsWiring,
// `@blksails/pi-web-runner` 不是根包依赖(node_modules 里无链接),按本仓既有做法
// 以相对路径引包内部模块——与 test/ 下引 adapters/ui 内部的写法一致。
} from "../packages/runner/src/runner/gateway-models-wiring.js";

type Entry = { model: string; ownedBy: string; source: "ai-gateway"; instanceId: string };

const entry = (model: string): Entry => ({
  model,
  ownedBy: "anthropic",
  source: "ai-gateway",
  instanceId: "cf",
});

/** 受控目录：快照与刷新时机完全由测试掌握——这就是「主动构造窗口」的接缝。 */
function controlledCatalog() {
  let snapshot: Entry[] = [];
  let unreachable = false;
  return {
    get: () => snapshot,
    refresh: async () => {
      if (unreachable) {
        await new Promise<void>(() => {
          /* 永不 settle:模拟上游不可达 */
        });
      }
    },
    /** 测试动作：让目录「到货」。 */
    arrive: (...models: string[]) => {
      snapshot = models.map(entry);
    },
    makeUnreachable: () => {
      unreachable = true;
    },
  };
}

/** 极简 runner 侧模型注册台账：只记「当前该 provider 有哪些模型」。 */
function fakeRegistry() {
  const byProvider = new Map<string, readonly string[]>();
  return {
    register: (providerName: string, models: readonly string[]) => {
      byProvider.set(providerName, models); // 覆盖语义(已在 adapters 侧实证)
    },
    modelsOf: (p: string) => byProvider.get(p) ?? [],
  };
}

/** 直连的父子通道替身：runner 发出的帧直接喂给宿主处理器，反之亦然。 */
function wireChannels(resolver: ReturnType<typeof makeGatewayModelsResolver>) {
  let runnerHandler: ((frame: unknown) => void) | undefined;
  let runnerSchema: { safeParse: (x: unknown) => { success: boolean; data?: unknown } } | undefined;
  const hostSeen: unknown[] = [];
  const channel = {
    register: (_types: unknown, schema: unknown, h: (frame: unknown) => void) => {
      runnerSchema = schema as never;
      runnerHandler = h;
      return () => {};
    },
    send: (frame: unknown) => {
      hostSeen.push(frame);
      // 宿主侧:收到索取 → 调 resolver → 回一帧
      const req = frame as { type: string; id: string; instanceIds: string[] };
      if (req.type !== "agent_gateway_models") return;
      void resolver(req.instanceIds).then((r: Awaited<ReturnType<typeof resolver>>) => {
        const result = {
          type: "piweb_gateway_models_result",
          id: req.id,
          instances: r.instances.map((i: { instanceId: string; models: readonly string[] }) => ({
            instanceId: i.instanceId,
            models: [...i.models],
          })),
          reason: r.reason,
        };
        const parsed = runnerSchema?.safeParse(result);
        if (parsed?.success === true) runnerHandler?.(parsed.data);
      });
    },
    installed: true,
    cleanup: () => {},
  } as never;
  return { channel, hostSeen };
}

/** 把三段串起来跑一次完整冷启。 */
async function runColdStart(catalog: ReturnType<typeof controlledCatalog>) {
  resetGatewayModelsWiring();
  const registry = fakeRegistry();

  // ① 装配层：目录此刻为空（冷启窗口内）
  const { env } = computeAiGatewaySessionsSpawnEnv({
    instances: [
      {
        instanceId: "cf",
        baseUrl: "https://cf.example.com/compat",
        apiKey: "cf-key",
        catalog: catalog.get(),
      },
    ],
  });

  // ② runner 侧：从 spawn env 解析 → 应判为 pendingCatalog，并以空集占位注册
  const entries = resolveAiGatewaySessionSpecsFromEnv(env as NodeJS.ProcessEnv);
  for (const e of entries) registry.register(e.providerName, e.spec.modelIds);
  const pendingIds = entries.filter((e) => e.spec.pendingCatalog).map((e) => e.providerName);

  // ③ 拉取回路
  const resolver = makeGatewayModelsResolver({
    catalogs: new Map([["cf", catalog]]) as never,
    instances: [{ id: "cf" }] as never,
    waitMs: 60,
    logger: { info: () => {} },
  });
  const { channel, hostSeen } = wireChannels(resolver);
  if (pendingIds.length > 0) {
    registerGatewayModelsPending(
      {
        instanceIds: pendingIds,
        apply: (updates: ReadonlyArray<{ instanceId: string; models: readonly string[] }>) => {
          for (const u of updates) registry.register(u.instanceId, u.models);
        },
      },
      { info: () => {} },
    );
  }
  attachGatewayModelsChannel(channel, { info: () => {} });

  return { env, entries, registry, hostSeen, pendingIds };
}

describe("★ 冷启竞态端到端(Req 1.1/1.2/6.1/6.2)", () => {
  it("★ 会话先起 → 目录后到 → 清单最终补齐,且全程未重建会话", async () => {
    const catalog = controlledCatalog();

    // 会话在目录**未就绪**时创建
    const run = await runColdStart(catalog);

    // 装配层:下发了声明与凭据,但没有 MODELS
    expect(run.env.PI_WEB_AI_GATEWAY_SESSIONS).toBe("cf");
    expect(run.env.PI_WEB_AI_GATEWAY_SESSION_CF_BASE).toBeDefined();
    expect(run.env.PI_WEB_AI_GATEWAY_SESSION_CF_MODELS).toBeUndefined();

    // runner 侧:实例在场(否则共享 registry 不会被构造),但模型集暂空
    expect(run.entries.map((e) => e.providerName)).toEqual(["cf"]);
    expect(run.entries[0]?.spec.pendingCatalog).toBe(true);
    expect(run.registry.modelsOf("cf")).toEqual([]);

    // 已发出索取
    expect(run.hostSeen).toHaveLength(1);

    // 目录「到货」——注意这发生在会话创建**之后**
    catalog.arrive("anthropic/claude-opus-5", "openai/gpt-5.5");

    // 宿主应答回流 → 补注册
    await vi.waitFor(() => {
      expect(run.registry.modelsOf("cf")).toEqual([
        "anthropic/claude-opus-5",
        "openai/gpt-5.5",
      ]);
    });

    // ★ 全程只有一个会话:没有任何「重建」动作参与(Req 1.2)
    expect(run.hostSeen).toHaveLength(1);
  });

  it("目录始终不可达 → 会话仍可用,清单保持为空(既有 fail-soft 不变,Req 3.3/5.2/6.3)", async () => {
    const catalog = controlledCatalog();
    catalog.makeUnreachable();
    const run = await runColdStart(catalog);

    // 会话照常起来,实例在场
    expect(run.entries[0]?.spec.pendingCatalog).toBe(true);

    // 等应答(超时路径)回流;不得抛、不得挂死
    await vi.waitFor(
      () => {
        expect(run.hostSeen).toHaveLength(1);
      },
      { timeout: 2_000 },
    );
    expect(run.registry.modelsOf("cf")).toEqual([]);
  });

  it("目录已就绪(快路径)→ 装配期即带全清单,不发起任何索取", async () => {
    const catalog = controlledCatalog();
    catalog.arrive("anthropic/claude-opus-5");
    const run = await runColdStart(catalog);

    expect(run.env.PI_WEB_AI_GATEWAY_SESSION_CF_MODELS).toBeDefined();
    expect(run.entries[0]?.spec.pendingCatalog).toBe(false);
    expect(run.pendingIds).toEqual([]);
    expect(run.hostSeen).toHaveLength(0); // 零额外往返
    expect(run.registry.modelsOf("cf")).toEqual(["anthropic/claude-opus-5"]);
  });
});
