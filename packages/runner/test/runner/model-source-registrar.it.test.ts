/**
 * model-source-registrar 契约单测(spec: multi-gateway-providers,任务 1.4,Req 6.2)。
 *
 * ★ 本模块此前**无任何单测**——后续任务(3.5)要改其去重键(从 providerName 改为来源身份)、
 *   新增"该配置将注册哪些 provider 名"的回读能力。改前须先有一份能跑绿的契约基线,
 *   使改造是否破坏既有行为可被机械判定,而非肉眼比对。
 *
 * 覆盖范围(按任务描述逐条对应):
 * - 登记(registerModelSource → listModelSources 可见)
 * - 按身份去重覆盖(同 providerName 重复登记,后者顶替前者,不追加)
 * - 共享服务构造器的单例约束(setSharedModelServicesFactory 只保留"当前一份",
 *   后设覆盖先设 —— 与 registrars 里"谁自建 registry 谁顶掉别人"的单例语义一致)
 * - 测试复位(resetModelSourcesForTest 清空两类登记,使用例之间互不污染)
 */
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

function makeRegistrar(providerName: string): ModelSourceRegistrar<{ marker: string }> & {
  registerCalls: Array<{ spec: { marker: string }; log: ModelSourceLogger }>;
} {
  const registerCalls: Array<{ spec: { marker: string }; log: ModelSourceLogger }> = [];
  return {
    providerName,
    resolveSpecFromEnv: (env) =>
      env[`${providerName}_MARKER`] ? { marker: env[`${providerName}_MARKER`] as string } : undefined,
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
    it("同 providerName 重复登记 → 后者顶替前者,登记表条目数不变", () => {
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
      expect(sources.map((s) => s.providerName)).toEqual(["source-a", "source-b"]);
      expect(sources[0]).toBe(a2);
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
