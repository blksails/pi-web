/**
 * host-assembly · 自定义 provider 的会话侧注册 —— 经**真实生产 registrar**验证
 * (spec multi-gateway-providers,任务 5.3,Req 7.2/7.5)。
 *
 * 与 `model-sources-gateway-names.it.test.ts` 同惯例:直接驱动
 * `registerBuiltinModelSources()`(全仓唯一的生产注册点),而不是自造一个假
 * `ModelSourceRegistrar` 去验证——后者只能证明契约形状对,证不了「生产接线真的把
 * providers.json 接进了会话」。
 *
 * 与网关来源那份测试的差异:这里不经 `buildRuntimeFactory`,而是直接从
 * `listModelSources()` 取出自定义 provider 的 registrar,对着**真实** `ModelRegistry`
 * 跑 `resolveSpecFromEnv` → `register`,断言 `registry.find(...)`——因为要验证的是
 * 「providers.json 里的东西真的进了 registry」这件事本身,不涉及 `resolveModel` 的
 * 失败文案分化(那是网关来源专属的 3.7 关注点)。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
  listModelSources,
  resetModelSourcesForTest,
} from "@blksails/pi-web-runner/runner/model-source-registrar.js";
import { CUSTOM_PROVIDER_SOURCE_ID } from "@blksails/pi-web-core/model-catalog/custom-provider-source.js";
import { registerBuiltinModelSources } from "../../src/host-assembly/model-sources.js";

function writeProvidersJson(agentDir: string, body: unknown): void {
  writeFileSync(join(agentDir, "providers.json"), JSON.stringify(body), "utf8");
}

function findCustomProviderRegistrar() {
  const registrar = listModelSources().find((r) => r.sourceId === CUSTOM_PROVIDER_SOURCE_ID);
  if (registrar === undefined) {
    throw new Error("custom-providers registrar 未登记 —— registerBuiltinModelSources 漏接线");
  }
  return registrar;
}

describe("registerBuiltinModelSources — 自定义 provider 会话侧注册(任务 5.3,Req 7.2/7.5)", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-server-custom-provider-"));
    resetModelSourcesForTest();
    registerBuiltinModelSources();
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
    resetModelSourcesForTest();
  });

  it("自定义 provider 已作为独立来源与 egress/ai-gateway 并列登记", () => {
    const sourceIds = listModelSources().map((r) => r.sourceId);
    expect(sourceIds).toContain(CUSTOM_PROVIDER_SOURCE_ID);
    // 三个来源并列,不特判(egress/ai-gateway 两个既有来源仍在)。
    expect(sourceIds.length).toBeGreaterThanOrEqual(3);
  });

  it("providers.json 未创建时,该来源本次不声明 spec(与其余来源的 undefined 约定对齐)", () => {
    const registrar = findCustomProviderRegistrar();
    const spec = registrar.resolveSpecFromEnv({ PI_WEB_AGENT_DIR: agentDir } as NodeJS.ProcessEnv);
    expect(spec).toBeUndefined();
  });

  it("新增一个启用的自定义 provider 后,真实 registry 中其模型可被 find(Req 7.2)", () => {
    writeProvidersJson(agentDir, {
      providers: [
        {
          id: "my-custom",
          baseUrl: "https://my-custom.example.com/v1",
          apiKey: "sk-abc",
          models: [{ id: "m1", name: "Model One" }],
        },
      ],
    });

    const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
    const registry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));

    const registrar = findCustomProviderRegistrar();
    const spec = registrar.resolveSpecFromEnv({ PI_WEB_AGENT_DIR: agentDir } as NodeJS.ProcessEnv);
    expect(spec).toBeDefined();
    expect(registrar.providerNamesOf(spec)).toEqual(["my-custom"]);
    registrar.register(registry, spec, { info: () => {} });

    expect(registry.find("my-custom", "m1")).toBeDefined();
  });

  it("停用该 provider 后,会话侧不再注册它,但 providers.json 的配置原样保留(Req 7.5)", () => {
    writeProvidersJson(agentDir, {
      providers: [
        {
          id: "my-custom",
          enabled: false,
          baseUrl: "https://my-custom.example.com/v1",
          apiKey: "sk-abc",
          models: [{ id: "m1", name: "Model One" }],
        },
      ],
    });

    const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
    const registry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));

    const registrar = findCustomProviderRegistrar();
    const spec = registrar.resolveSpecFromEnv({ PI_WEB_AGENT_DIR: agentDir } as NodeJS.ProcessEnv);
    // 停用 → 无已启用条目 → 该来源本次不声明 spec,register 从不被调用。
    expect(spec).toBeUndefined();
    expect(registry.find("my-custom", "m1")).toBeUndefined();

    // 配置仍在磁盘上(文件从未被本模块改写,读取路径本身也不会清空停用条目)。
    const raw = JSON.parse(readFileSync(join(agentDir, "providers.json"), "utf8")) as {
      providers: Array<{ id: string; enabled: boolean; baseUrl: string }>;
    };
    expect(raw.providers).toEqual([
      { id: "my-custom", enabled: false, baseUrl: "https://my-custom.example.com/v1", apiKey: "sk-abc", models: [{ id: "m1", name: "Model One" }] },
    ]);
  });

  it("两个自定义 provider 同时启用 → 均可 find,互不串号(一个来源注册多个 provider)", () => {
    writeProvidersJson(agentDir, {
      providers: [
        {
          id: "provider-a",
          baseUrl: "https://a.example.com/v1",
          apiKey: "sk-a",
          models: [{ id: "m1" }],
        },
        {
          id: "provider-b",
          baseUrl: "https://b.example.com/v1",
          apiKey: "sk-b",
          models: [{ id: "m2" }],
        },
      ],
    });

    const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
    const registry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));

    const registrar = findCustomProviderRegistrar();
    const spec = registrar.resolveSpecFromEnv({ PI_WEB_AGENT_DIR: agentDir } as NodeJS.ProcessEnv);
    expect(registrar.providerNamesOf(spec)).toEqual(["provider-a", "provider-b"]);
    registrar.register(registry, spec, { info: () => {} });

    expect(registry.find("provider-a", "m1")).toBeDefined();
    expect(registry.find("provider-b", "m2")).toBeDefined();
    expect(registry.find("provider-a", "m2")).toBeUndefined();
    expect(registry.find("provider-b", "m1")).toBeUndefined();
  });

  it(
    "无 apiKey 的自定义 provider 在会话注册时被跳过(不抛错),且不影响同批其余 provider" +
      "(pi SDK registerProvider 对含 models 的 provider 硬性要求 apiKey/oauth 之一;" +
      "实测发现 —— 若不特殊处理,一个缺凭据的条目会让整个 register() 循环中途抛出," +
      "连带其余本应成功注册的 provider 都注册不上)",
    () => {
      writeProvidersJson(agentDir, {
        providers: [
          { id: "no-key-provider", baseUrl: "https://nokey.example.com/v1", models: [{ id: "m1" }] },
          {
            id: "with-key-provider",
            baseUrl: "https://withkey.example.com/v1",
            apiKey: "sk-ok",
            models: [{ id: "m2" }],
          },
        ],
      });

      const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
      const registry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));

      const registrar = findCustomProviderRegistrar();
      const spec = registrar.resolveSpecFromEnv({
        PI_WEB_AGENT_DIR: agentDir,
      } as NodeJS.ProcessEnv);
      // 两者都是「已启用」条目 —— providerNamesOf 不因缺 apiKey 而收窄(那是回读能力,
      // 反映"声明要注册的" provider,不是"实际注册成功的")。
      expect(registrar.providerNamesOf(spec)).toEqual(["no-key-provider", "with-key-provider"]);

      // 不抛:register() 必须完整跑完,而不是在第一个条目就中断。
      expect(() => registrar.register(registry, spec, { info: () => {} })).not.toThrow();

      // 缺 apiKey 的那个确实没有被注册进 registry。
      expect(registry.find("no-key-provider", "m1")).toBeUndefined();
      // 但同批里凭据齐全的另一个不受牵连,正常可用。
      expect(registry.find("with-key-provider", "m2")).toBeDefined();
    },
  );

  it("PI_CODING_AGENT_DIR(runner 子进程恒有的 agentDir env)同样能定位 providers.json", () => {
    writeProvidersJson(agentDir, {
      providers: [{ id: "my-custom", baseUrl: "https://x.example.com/v1", models: [{ id: "m1" }] }],
    });

    const registrar = findCustomProviderRegistrar();
    const spec = registrar.resolveSpecFromEnv({
      PI_CODING_AGENT_DIR: agentDir,
    } as NodeJS.ProcessEnv);
    expect(spec).toBeDefined();
    expect(registrar.providerNamesOf(spec)).toEqual(["my-custom"]);
  });
});
