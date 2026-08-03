/**
 * model-source-registrar 契约单测(spec: multi-gateway-providers,任务 1.4/3.5,Req 6.2/1.1/6.5)。
 *
 * ★ 本模块此前**无任何单测**——任务 3.5 已改其去重键(从 `providerName` 改为来源身份
 *   `sourceId`)、新增"该配置将注册哪些 provider 名"的回读能力 `providerNamesOf`。
 *   本文件即改前立下、改后仍须逐条通过的契约基线,使改造是否破坏既有行为可被机械
 *   判定,而非肉眼比对。
 *
 * 覆盖范围(按任务描述逐条对应):
 * - 登记(registerModelSource → listModelSources 可见)
 * - 按来源身份去重覆盖(同 sourceId 重复登记,后者顶替前者,不追加)
 * - 共享服务构造器的单例约束(setSharedModelServicesFactory 只保留"当前一份",
 *   后设覆盖先设 —— 与 registrars 里"谁自建 registry 谁顶掉别人"的单例语义一致)
 * - 测试复位(resetModelSourcesForTest 清空两类登记,使用例之间互不污染)
 * - 一个来源注册多个 provider(`providerNamesOf` 回读,任务 3.5 新增)
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
  getSharedModelServicesFactory,
  listModelSources,
  registerModelSource,
  resetModelSourcesForTest,
  setSharedModelServicesFactory,
  type ModelSourceLogger,
  type ModelSourceRegistrar,
  type SharedModelServices,
} from "../../src/runner/model-source-registrar.js";

function makeRegistrar(
  sourceId: string,
  providerNames: readonly string[] = [sourceId],
): ModelSourceRegistrar<{ marker: string }> & {
  registerCalls: Array<{ spec: { marker: string }; log: ModelSourceLogger }>;
} {
  const registerCalls: Array<{ spec: { marker: string }; log: ModelSourceLogger }> = [];
  return {
    sourceId,
    resolveSpecFromEnv: (env) =>
      env[`${sourceId}_MARKER`] ? { marker: env[`${sourceId}_MARKER`] as string } : undefined,
    providerNamesOf: () => providerNames,
    register: (_registry, spec, log) => {
      registerCalls.push({ spec, log });
    },
    registerCalls,
  };
}

describe("model-source-registrar — 契约基线(Req 6.2)", () => {
  afterEach(() => {
    resetModelSourcesForTest();
  });

  describe("登记", () => {
    it("未登记任何来源时,快照为空数组", () => {
      expect(listModelSources()).toEqual([]);
    });

    it("登记一个来源后,可在快照中按原对象取回", () => {
      const registrar = makeRegistrar("source-a");
      registerModelSource(registrar);

      const sources = listModelSources();
      expect(sources).toHaveLength(1);
      expect(sources[0]).toBe(registrar);
    });

    it("登记多个不同标识的来源,均出现在快照中且不互相覆盖", () => {
      const a = makeRegistrar("source-a");
      const b = makeRegistrar("source-b");
      registerModelSource(a);
      registerModelSource(b);

      const sources = listModelSources();
      expect(sources).toHaveLength(2);
      expect(sources).toContain(a);
      expect(sources).toContain(b);
    });

    it("快照是只读副本 —— 修改返回值不影响内部登记表", () => {
      registerModelSource(makeRegistrar("source-a"));
      const sources = listModelSources() as ModelSourceRegistrar[];
      sources.push(makeRegistrar("source-b"));

      expect(listModelSources()).toHaveLength(1);
    });
  });

  describe("按身份去重覆盖", () => {
    it("同 sourceId 重复登记 → 后者顶替前者,登记表条目数不变", () => {
      const first = makeRegistrar("source-a");
      const second = makeRegistrar("source-a");
      registerModelSource(first);
      registerModelSource(second);

      const sources = listModelSources();
      expect(sources).toHaveLength(1);
      expect(sources[0]).toBe(second);
      expect(sources[0]).not.toBe(first);
    });

    it("覆盖发生在原位置 —— 不改变其余来源相对顺序", () => {
      const a1 = makeRegistrar("source-a");
      const b = makeRegistrar("source-b");
      const a2 = makeRegistrar("source-a");
      registerModelSource(a1);
      registerModelSource(b);
      registerModelSource(a2);

      const sources = listModelSources();
      expect(sources.map((s) => s.sourceId)).toEqual(["source-a", "source-b"]);
      expect(sources[0]).toBe(a2);
    });
  });

  describe("回读:一个来源注册多个 provider(任务 3.5,Req 1.1/6.2/6.5)", () => {
    it("providerNamesOf 可返回多个 provider 名,且与 sourceId 不必相同", () => {
      const spec = { marker: "m" };
      const multi = makeRegistrar("gateway-suite", ["cloudflare", "blksails-ai"]);
      registerModelSource(multi);

      const [registered] = listModelSources();
      expect(registered?.sourceId).toBe("gateway-suite");
      expect(registered?.providerNamesOf(spec)).toEqual(["cloudflare", "blksails-ai"]);
    });

    it("两个不同来源各自注册多个 provider,互不影响", () => {
      const specA = { marker: "a" };
      const specB = { marker: "b" };
      const a = makeRegistrar("source-a", ["provider-a1", "provider-a2"]);
      const b = makeRegistrar("source-b", ["provider-b1"]);
      registerModelSource(a);
      registerModelSource(b);

      const sources = listModelSources();
      expect(sources).toHaveLength(2);
      expect(sources.find((s) => s.sourceId === "source-a")?.providerNamesOf(specA)).toEqual([
        "provider-a1",
        "provider-a2",
      ]);
      expect(sources.find((s) => s.sourceId === "source-b")?.providerNamesOf(specB)).toEqual([
        "provider-b1",
      ]);
    });

    // ★ 上面两个用例的 `register` 只是把调用记进数组(mock),从不触碰真实 registry ——
    //   不足以钉死"一个来源多个 provider 的接线在真实 registry 里确实各自可 find"这件事
    //   (这正是 3.5 上一轮被拒的缺口:providerNamesOf 的第 4 参 providerName 从无生产
    //   调用点也无用例覆盖)。本用例用真实 `ModelRegistry` 验证:多实例网关式来源的
    //   `register` 对每个 providerName 各自调用 `registry.registerProvider`,随后
    //   `registry.find(<每个 providerName>, …)` 均可解析。
    it("一个来源注册多个 provider → 真实 registry 中两者均可 find", async () => {
      const { AuthStorage, ModelRegistry } = await import("@earendil-works/pi-coding-agent");
      const agentDir = mkdtempSync(join(tmpdir(), "pi-model-source-registrar-"));
      try {
        const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
        const registry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));

        interface GatewaySuiteEntry {
          readonly providerName: string;
          readonly modelIds: readonly string[];
        }
        const gatewaySuite: ModelSourceRegistrar<readonly GatewaySuiteEntry[]> = {
          sourceId: "gateway-suite",
          resolveSpecFromEnv: () => [
            { providerName: "instance-a", modelIds: ["model-1"] },
            { providerName: "instance-b", modelIds: ["model-2"] },
          ],
          providerNamesOf: (entries) => entries.map((e) => e.providerName),
          register: (reg, entries) => {
            for (const { providerName, modelIds } of entries) {
              reg.registerProvider(providerName, {
                baseUrl: "https://example.com/v1",
                apiKey: "k",
                api: "openai-completions",
                authHeader: true,
                models: modelIds.map((id) => ({
                  id,
                  name: id,
                  api: "openai-completions",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 8_192,
                  maxTokens: 4_096,
                })),
              } as Parameters<ModelRegistry["registerProvider"]>[1]);
            }
          },
        };
        registerModelSource(gatewaySuite);

        const [registered] = listModelSources();
        const spec = registered?.resolveSpecFromEnv({}) as readonly GatewaySuiteEntry[];
        expect(registered?.providerNamesOf(spec)).toEqual(["instance-a", "instance-b"]);
        registered?.register(registry, spec, { info: () => {} });

        expect(registry.find("instance-a", "model-1")).toBeDefined();
        expect(registry.find("instance-b", "model-2")).toBeDefined();
        // 未串号:各实例只认自己的模型。
        expect(registry.find("instance-a", "model-2")).toBeUndefined();
        expect(registry.find("instance-b", "model-1")).toBeUndefined();
      } finally {
        rmSync(agentDir, { recursive: true, force: true });
      }
    });
  });

  describe("共享服务构造器的单例约束", () => {
    it("未登记时返回 undefined", () => {
      expect(getSharedModelServicesFactory()).toBeUndefined();
    });

    it("登记后可原样取回同一个函数引用", () => {
      const factory = (_agentDir: string): SharedModelServices => ({
        authStorage: {} as SharedModelServices["authStorage"],
        modelRegistry: {} as ModelRegistry,
      });
      setSharedModelServicesFactory(factory);

      expect(getSharedModelServicesFactory()).toBe(factory);
    });

    it("重复登记 → 只保留最后一份(后设覆盖先设,单例不追加)", () => {
      const first = (_agentDir: string): SharedModelServices => ({
        authStorage: {} as SharedModelServices["authStorage"],
        modelRegistry: {} as ModelRegistry,
      });
      const second = (_agentDir: string): SharedModelServices => ({
        authStorage: {} as SharedModelServices["authStorage"],
        modelRegistry: {} as ModelRegistry,
      });
      setSharedModelServicesFactory(first);
      setSharedModelServicesFactory(second);

      const current = getSharedModelServicesFactory();
      expect(current).toBe(second);
      expect(current).not.toBe(first);
    });
  });

  describe("测试复位", () => {
    it("resetModelSourcesForTest 清空 registrars 快照", () => {
      registerModelSource(makeRegistrar("source-a"));
      resetModelSourcesForTest();

      expect(listModelSources()).toEqual([]);
    });

    it("resetModelSourcesForTest 清空共享服务构造器", () => {
      setSharedModelServicesFactory((_agentDir) => ({
        authStorage: {} as SharedModelServices["authStorage"],
        modelRegistry: {} as ModelRegistry,
      }));
      resetModelSourcesForTest();

      expect(getSharedModelServicesFactory()).toBeUndefined();
    });

    it("复位后可重新登记,不受此前状态影响(用例间互不污染)", () => {
      registerModelSource(makeRegistrar("source-a"));
      resetModelSourcesForTest();

      const fresh = makeRegistrar("source-b");
      registerModelSource(fresh);

      const sources = listModelSources();
      expect(sources).toHaveLength(1);
      expect(sources[0]).toBe(fresh);
    });
  });
});
