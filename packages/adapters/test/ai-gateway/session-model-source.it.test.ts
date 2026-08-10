/**
 * ai-gateway · 会话侧模型来源单测(spec ai-gateway-session-models,任务 1.1/0.1,
 * Req 1.1/2.4/3.1/3.2)。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AI_GATEWAY_PROVIDER_NAME,
  AI_GATEWAY_SESSION_INSTANCES_ENV,
  RUNNER_AI_GATEWAY_BASE_ENV,
  RUNNER_AI_GATEWAY_KEY_ENV,
  RUNNER_AI_GATEWAY_MODELS_ENV,
  isSessionCapableGatewayModel,
  registerAiGatewayProvider,
  resolveAiGatewaySessionSpecFromEnv,
  resolveAiGatewaySessionSpecsFromEnv,
  declaredAiGatewaySessionProviderNamesFromEnv,
} from "../../src/ai-gateway/session-model-source.js";
import {
  createSharedModelServices,
  registerEgressProvider,
  resolveEgressSpecFromEnv,
} from "../../src/auth/egress-model-source.js";

function envOf(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    [RUNNER_AI_GATEWAY_BASE_ENV]: "https://gw.example.com/compat/v1",
    [RUNNER_AI_GATEWAY_KEY_ENV]: "cf-token-abc",
    [RUNNER_AI_GATEWAY_MODELS_ENV]: JSON.stringify([
      "anthropic/claude-opus-5",
      "openai/gpt-5.5",
    ]),
    ...over,
  };
}

describe("resolveAiGatewaySessionSpecFromEnv", () => {
  it("三件套齐全 → 解析出 spec", () => {
    const spec = resolveAiGatewaySessionSpecFromEnv(envOf());
    expect(spec).toEqual({
      baseUrl: "https://gw.example.com/compat/v1",
      apiKey: "cf-token-abc",
      modelIds: ["anthropic/claude-opus-5", "openai/gpt-5.5"],
      // 装配期已带全清单 = 快路径,无需会话侧拉取。
      pendingCatalog: false,
    });
  });

  it("剥离 baseUrl 尾斜杠", () => {
    const spec = resolveAiGatewaySessionSpecFromEnv(
      envOf({ [RUNNER_AI_GATEWAY_BASE_ENV]: "https://gw.example.com/compat/v1//" }),
    );
    expect(spec?.baseUrl).toBe("https://gw.example.com/compat/v1");
  });

  // ★ 启用判据 = 声明 + 凭据(spec ai-gateway-catalog-coldstart,Req 1.1/4.1)。
  //   models 已从该判据中**移出** —— 它缺失只意味着「清单还没到」,不是「未启用」。
  it.each([
    ["base 缺失", RUNNER_AI_GATEWAY_BASE_ENV],
    ["key 缺失", RUNNER_AI_GATEWAY_KEY_ENV],
  ])("%s → undefined(视为未启用)", (_label, key) => {
    expect(resolveAiGatewaySessionSpecFromEnv(envOf({ [key]: undefined }))).toBeUndefined();
  });

  // ★ 本 spec 的核心判据:冷启时装配层给不出 models,但实例仍须产出 spec ——
  //   否则 option-mapper 的 `resolved.length > 0` 不成立,共享 ModelRegistry 不会被构造,
  //   会话侧拉到清单也无处注册。把判据还原为「models 缺失 → undefined」此例即报红。
  it("models 缺失但凭据齐备 → 仍产出 spec,标记 pendingCatalog(Req 1.1)", () => {
    const spec = resolveAiGatewaySessionSpecFromEnv(
      envOf({ [RUNNER_AI_GATEWAY_MODELS_ENV]: undefined }),
    );
    expect(spec).toEqual({
      baseUrl: "https://gw.example.com/compat/v1",
      apiKey: "cf-token-abc",
      modelIds: [],
      pendingCatalog: true,
    });
  });

  // 凭据缺失与目录未就绪必须**可区分**(Req 4.1):前者 undefined,后者 pendingCatalog。
  it("凭据缺失与目录未就绪产出不同结果(Req 4.1)", () => {
    const noKey = resolveAiGatewaySessionSpecFromEnv(
      envOf({ [RUNNER_AI_GATEWAY_KEY_ENV]: undefined }),
    );
    const noModels = resolveAiGatewaySessionSpecFromEnv(
      envOf({ [RUNNER_AI_GATEWAY_MODELS_ENV]: undefined }),
    );
    expect(noKey).toBeUndefined();
    expect(noModels?.pendingCatalog).toBe(true);
  });

  it.each([
    ["base 空白", RUNNER_AI_GATEWAY_BASE_ENV],
    ["key 空白", RUNNER_AI_GATEWAY_KEY_ENV],
  ])("%s → undefined", (_label, key) => {
    expect(resolveAiGatewaySessionSpecFromEnv(envOf({ [key]: "   " }))).toBeUndefined();
  });

  // 配置异常不该打断本地会话路径(与 egress 同惯例:不抛)。清单不可用一律落到
  // pendingCatalog,交由会话侧拉取补齐 —— 与「凭据缺失」保持可区分。
  it.each([
    ["非法 JSON", "{不是数组"],
    ["JSON 但非数组", '{"a":1}'],
    ["空数组", "[]"],
    ["数组内全是空白/非字符串", '["", "   ", 42, null]'],
  ])("models %s → 产出 spec 且 pendingCatalog,不抛", (_label, raw) => {
    const env = envOf({ [RUNNER_AI_GATEWAY_MODELS_ENV]: raw });
    expect(() => resolveAiGatewaySessionSpecFromEnv(env)).not.toThrow();
    const spec = resolveAiGatewaySessionSpecFromEnv(env);
    expect(spec?.modelIds).toEqual([]);
    expect(spec?.pendingCatalog).toBe(true);
  });

  it("剔除非字符串与空白项", () => {
    const spec = resolveAiGatewaySessionSpecFromEnv(
      envOf({
        [RUNNER_AI_GATEWAY_MODELS_ENV]: JSON.stringify([
          "openai/gpt-5.5",
          "",
          "   ",
          42,
          null,
          " anthropic/claude-sonnet-5 ",
        ]),
      }),
    );
    expect(spec?.modelIds).toEqual(["openai/gpt-5.5", "anthropic/claude-sonnet-5"]);
  });
});

// spec multi-gateway-providers 任务 3.5(Req 1.1/6.2/6.5):会话侧 env 契约多实例化。
describe("resolveAiGatewaySessionSpecsFromEnv", () => {
  it("两实例 env → 解析出两个 spec,各自 providerName 正确", () => {
    const env: NodeJS.ProcessEnv = {
      [AI_GATEWAY_SESSION_INSTANCES_ENV]: "cloudflare, blksails-ai",
      PI_WEB_AI_GATEWAY_SESSION_CLOUDFLARE_BASE: "https://cf.example.com/compat/v1",
      PI_WEB_AI_GATEWAY_SESSION_CLOUDFLARE_KEY: "cf-key",
      PI_WEB_AI_GATEWAY_SESSION_CLOUDFLARE_MODELS: JSON.stringify(["anthropic/claude-opus-5"]),
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_AI_BASE: "https://blksails.example.com/compat/v1",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_AI_KEY: "bs-key",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_AI_MODELS: JSON.stringify(["openai/gpt-5.5"]),
    };
    const entries = resolveAiGatewaySessionSpecsFromEnv(env);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.providerName)).toEqual(["cloudflare", "blksails-ai"]);
    expect(entries[0]?.spec).toEqual({
      baseUrl: "https://cf.example.com/compat/v1",
      apiKey: "cf-key",
      modelIds: ["anthropic/claude-opus-5"],
      pendingCatalog: false,
    });
    expect(entries[1]?.spec).toEqual({
      baseUrl: "https://blksails.example.com/compat/v1",
      apiKey: "bs-key",
      modelIds: ["openai/gpt-5.5"],
      pendingCatalog: false,
    });
  });

  it("只设扁平三件套(未设实例清单)→ 合成缺省实例,与改动前逐字节等价", () => {
    const entries = resolveAiGatewaySessionSpecsFromEnv(envOf());
    expect(entries).toHaveLength(1);
    expect(entries[0]?.providerName).toBe(AI_GATEWAY_PROVIDER_NAME);
    expect(entries[0]?.spec).toEqual(resolveAiGatewaySessionSpecFromEnv(envOf()));
  });

  it("两者都未设置 → 空数组", () => {
    expect(resolveAiGatewaySessionSpecsFromEnv({})).toEqual([]);
  });

  // ★ 判据按新契约更新(spec ai-gateway-catalog-coldstart,Req 1.1/4.1):models 非法不再
  //   使该实例缺席 —— 缺席只保留给「凭据缺失」。清单不可用的实例改为在场且 pendingCatalog,
  //   否则冷启时共享 registry 不会被构造(见 research.md §5.2)。
  it("某实例 models 非法 → 该实例仍在场但 pendingCatalog,其余实例不受影响", () => {
    const env: NodeJS.ProcessEnv = {
      [AI_GATEWAY_SESSION_INSTANCES_ENV]: "good,bad",
      PI_WEB_AI_GATEWAY_SESSION_GOOD_BASE: "https://good.example.com/compat/v1",
      PI_WEB_AI_GATEWAY_SESSION_GOOD_KEY: "good-key",
      PI_WEB_AI_GATEWAY_SESSION_GOOD_MODELS: JSON.stringify(["openai/gpt-5.5"]),
      PI_WEB_AI_GATEWAY_SESSION_BAD_BASE: "https://bad.example.com/compat/v1",
      PI_WEB_AI_GATEWAY_SESSION_BAD_KEY: "bad-key",
      PI_WEB_AI_GATEWAY_SESSION_BAD_MODELS: "{不是数组",
    };
    const entries = resolveAiGatewaySessionSpecsFromEnv(env);
    expect(entries.map((e) => e.providerName)).toEqual(["good", "bad"]);
    expect(entries[0]?.spec.pendingCatalog).toBe(false);
    expect(entries[0]?.spec.modelIds).toEqual(["openai/gpt-5.5"]);
    expect(entries[1]?.spec.pendingCatalog).toBe(true);
    expect(entries[1]?.spec.modelIds).toEqual([]);
  });

  // 凭据缺失才是「缺席」的唯一成因(Req 4.1 的可判别性依赖这条分界)。
  it("某实例凭据缺失 → 该实例缺席,其余实例不受影响", () => {
    const env: NodeJS.ProcessEnv = {
      [AI_GATEWAY_SESSION_INSTANCES_ENV]: "good,nokey",
      PI_WEB_AI_GATEWAY_SESSION_GOOD_BASE: "https://good.example.com/compat/v1",
      PI_WEB_AI_GATEWAY_SESSION_GOOD_KEY: "good-key",
      PI_WEB_AI_GATEWAY_SESSION_GOOD_MODELS: JSON.stringify(["openai/gpt-5.5"]),
      PI_WEB_AI_GATEWAY_SESSION_NOKEY_BASE: "https://nokey.example.com/compat/v1",
      PI_WEB_AI_GATEWAY_SESSION_NOKEY_MODELS: JSON.stringify(["openai/gpt-5.5"]),
    };
    const entries = resolveAiGatewaySessionSpecsFromEnv(env);
    expect(entries.map((e) => e.providerName)).toEqual(["good"]);
  });

  it("实例标识清单里含空白项 → 被过滤,不产生空实例", () => {
    const env: NodeJS.ProcessEnv = {
      [AI_GATEWAY_SESSION_INSTANCES_ENV]: "solo, ,",
      PI_WEB_AI_GATEWAY_SESSION_SOLO_BASE: "https://solo.example.com/compat/v1",
      PI_WEB_AI_GATEWAY_SESSION_SOLO_KEY: "solo-key",
      PI_WEB_AI_GATEWAY_SESSION_SOLO_MODELS: JSON.stringify(["openai/gpt-5.5"]),
    };
    const entries = resolveAiGatewaySessionSpecsFromEnv(env);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.providerName).toBe("solo");
  });
});

// declaredAiGatewaySessionProviderNamesFromEnv —— 声明集判据(spec multi-gateway-providers
// 任务 3.7,Req 6.5)。★ 与 resolveAiGatewaySessionSpecsFromEnv 的核心区别:与「本次是否
// 已成功解析出 spec」无关,直接解析 env 取全集,不抛异常。
describe("declaredAiGatewaySessionProviderNamesFromEnv — 声明集(与解析成败无关,Req 6.5)", () => {
  it("仅设会话侧实例清单(PI_WEB_AI_GATEWAY_SESSIONS)→ 原样返回", () => {
    expect(
      declaredAiGatewaySessionProviderNamesFromEnv({
        [AI_GATEWAY_SESSION_INSTANCES_ENV]: "cloudflare, blksails-ai",
      }),
    ).toEqual(["cloudflare", "blksails-ai"]);
  });

  it("仅设部署侧 PI_WEB_GATEWAYS(会话侧三件套全缺,凭据缺失场景)→ 仍原样返回,不因解析失败而丢名字", () => {
    expect(
      declaredAiGatewaySessionProviderNamesFromEnv({ PI_WEB_GATEWAYS: "cloudflare,blksails-ai" }),
    ).toEqual(["cloudflare", "blksails-ai"]);
  });

  it("两路都设置且有重叠 → 取并集去重,不重复", () => {
    expect(
      declaredAiGatewaySessionProviderNamesFromEnv({
        [AI_GATEWAY_SESSION_INSTANCES_ENV]: "cloudflare",
        PI_WEB_GATEWAYS: "cloudflare,blksails-ai",
      }),
    ).toEqual(["cloudflare", "blksails-ai"]);
  });

  it("仅设扁平旧形态三件套(未设任何实例清单)→ [ai-gateway]", () => {
    expect(declaredAiGatewaySessionProviderNamesFromEnv(envOf())).toEqual([
      AI_GATEWAY_PROVIDER_NAME,
    ]);
  });

  it("全空 → 空数组", () => {
    expect(declaredAiGatewaySessionProviderNamesFromEnv({})).toEqual([]);
  });

  it("PI_WEB_GATEWAYS 含不合法标识(大写)与保留名 → 不抛,原样计入", () => {
    expect(() =>
      declaredAiGatewaySessionProviderNamesFromEnv({ PI_WEB_GATEWAYS: "Bad-ID" }),
    ).not.toThrow();
    expect(
      declaredAiGatewaySessionProviderNamesFromEnv({ PI_WEB_GATEWAYS: "Bad-ID" }),
    ).toEqual(["Bad-ID"]);
    expect(() =>
      declaredAiGatewaySessionProviderNamesFromEnv({ PI_WEB_GATEWAYS: "openai" }),
    ).not.toThrow();
  });

  it("已设会话侧实例清单时,即便扁平三件套也存在,不再追加缺省名(清单非空则不回落)", () => {
    expect(
      declaredAiGatewaySessionProviderNamesFromEnv({
        [AI_GATEWAY_SESSION_INSTANCES_ENV]: "cloudflare",
        ...envOf(),
      }),
    ).toEqual(["cloudflare"]);
  });
});

// Req 4.1(任务 4.1):判据由 2026-07-29 对真实 CF 目录的统计得出 ——
// 470 条中含冒号者 68 条,分布 :batch 25 / :free 20 / :beta 14 / :thinking 3 /
// :extended · :nitro · :exacto 各 1。故只能排除 :batch,一刀切会误伤 43 条合法模型。
describe("isSessionCapableGatewayModel", () => {
  it(":batch 变体不可用于会话(实测 401,需另一套凭据)", () => {
    expect(isSessionCapableGatewayModel("openai/gpt-4-turbo:batch")).toBe(false);
    expect(isSessionCapableGatewayModel("anthropic/claude-opus-4.1:batch")).toBe(false);
  });

  // ★这些后缀是正常对话模型的路由变体 —— 排除它们才是缺陷。
  it.each([
    "meta/llama:free",
    "anthropic/claude-sonnet-4:beta",
    "google/gemini:thinking",
    "openai/gpt-4o:extended",
    "x/y:nitro",
    "x/y:exacto",
  ])("%s 仍可用于会话(不误伤)", (id) => {
    expect(isSessionCapableGatewayModel(id)).toBe(true);
  });

  it("不含冒号的常规 id 恒可用", () => {
    expect(isSessionCapableGatewayModel("anthropic/claude-opus-5")).toBe(true);
    expect(isSessionCapableGatewayModel("openai/gpt-5.5")).toBe(true);
  });

  // 只按后缀判定,不做子串匹配 —— 否则 `x/batch-model` 之类会被误伤。
  it("冒号在中间而非后缀 → 不排除", () => {
    expect(isSessionCapableGatewayModel("owner/model:batch-preview")).toBe(true);
    expect(isSessionCapableGatewayModel("owner/batch:free")).toBe(true);
  });
});

// spec ai-gateway-catalog-coldstart 任务 1.3:反向拉取要求「先以空模型集注册占位、
// 拿到清单后再注册一次」。这依赖两条 pi SDK 行为,均由本组用例实证钉死 ——
// 它们是**外部契约**,若 SDK 变更则本 spec 的补注册路径失效(design.md Revalidation Triggers)。
describe("registerAiGatewayProvider — 空集占位与重复注册语义(外部契约,Req 1.1/1.2)", () => {
  let agentDir2: string;
  beforeEach(() => {
    agentDir2 = mkdtempSync(join(tmpdir(), "pi-aigw-coldstart-"));
  });
  afterEach(() => {
    rmSync(agentDir2, { recursive: true, force: true });
  });

  it("空模型集可注册且不抛(冷启占位:registry 必须先被构造)", () => {
    const { modelRegistry } = createSharedModelServices(agentDir2);
    expect(() =>
      registerAiGatewayProvider(
        modelRegistry,
        { baseUrl: "https://gw.test/v1", apiKey: "k", modelIds: [], pendingCatalog: true },
        undefined,
        "cf",
      ),
    ).not.toThrow();
    expect(modelRegistry.getAll().filter((m) => m.provider === "cf")).toHaveLength(0);
  });

  it("★同名重复注册是**覆盖**而非叠加 —— 补注册无需先 unregister", () => {
    const { modelRegistry } = createSharedModelServices(agentDir2);
    const spec = (ids: string[]) => ({
      baseUrl: "https://gw.test/v1",
      apiKey: "k",
      modelIds: ids,
      pendingCatalog: ids.length === 0,
    });
    registerAiGatewayProvider(modelRegistry, spec([]), undefined, "cf");
    registerAiGatewayProvider(modelRegistry, spec(["a/x", "b/y"]), undefined, "cf");
    expect(modelRegistry.getAll().filter((m) => m.provider === "cf")).toHaveLength(2);
    // 再注册更少的条目:若是叠加语义这里会是 3
    registerAiGatewayProvider(modelRegistry, spec(["a/x"]), undefined, "cf");
    const after = modelRegistry.getAll().filter((m) => m.provider === "cf");
    expect(after.map((m) => m.id)).toEqual(["a/x"]);
    expect(modelRegistry.find("cf", "a/x")).toBeDefined();
  });
});

describe("registerAiGatewayProvider", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-gw-session-"));
  });
  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  // ★任务 0.1 的实证钉死在测试里:research §五标记的唯一未实证前提 ——
  // pi SDK 是否对含斜杠的 modelId 做二次切分。含斜杠是 ai-gateway 目录的**常态**
  // (`anthropic/claude-opus-5`),若被切分则整套方案不成立。
  it("★带斜杠的 modelId 可被 find 解析", () => {
    const { modelRegistry } = createSharedModelServices(agentDir);
    registerAiGatewayProvider(modelRegistry, {
      baseUrl: "https://gw.example.com/compat/v1",
      apiKey: "k",
      modelIds: ["anthropic/claude-opus-5", "openai/gpt-5.5"], pendingCatalog: false,
    });
    const found = modelRegistry.find(AI_GATEWAY_PROVIDER_NAME, "anthropic/claude-opus-5");
    expect(found).toBeDefined();
    expect(found?.id).toBe("anthropic/claude-opus-5");
    expect(found?.provider).toBe(AI_GATEWAY_PROVIDER_NAME);
  });

  it("未注册的 modelId → undefined", () => {
    const { modelRegistry } = createSharedModelServices(agentDir);
    registerAiGatewayProvider(modelRegistry, {
      baseUrl: "https://gw.example.com/compat/v1",
      apiKey: "k",
      modelIds: ["openai/gpt-5.5"], pendingCatalog: false,
    });
    expect(modelRegistry.find(AI_GATEWAY_PROVIDER_NAME, "nope/nope")).toBeUndefined();
  });

  // ★端到端揪出的真实缺陷(2026-07-29):pi SDK 的 openai-completions 默认发 `max_tokens`,
  // OpenAI 推理模型(gpt-5.5)拒收 → assistant content 为空 + stopReason=error,服务端无日志。
  // 三家上游实调确认均接受 max_completion_tokens,故统一设置。
  // 移除此 compat 会让 gpt-5 系模型在真机上静默失败,而其他单测都发现不了 —— 故钉死。
  it("★模型附 compat.maxTokensField=max_completion_tokens", () => {
    const { modelRegistry } = createSharedModelServices(agentDir);
    registerAiGatewayProvider(modelRegistry, {
      baseUrl: "https://gw.example.com/compat/v1",
      apiKey: "k",
      modelIds: ["openai/gpt-5.5", "anthropic/claude-opus-5"], pendingCatalog: false,
    });
    for (const id of ["openai/gpt-5.5", "anthropic/claude-opus-5"]) {
      // compat 是跨 api 的联合类型(openai-completions / responses / anthropic-messages),
      // maxTokensField 只存在于 openai-completions 分支;此处 api 恒为前者,故收窄读取。
      const compat = modelRegistry.find(AI_GATEWAY_PROVIDER_NAME, id)?.compat as
        | { maxTokensField?: string }
        | undefined;
      expect(compat?.maxTokensField, `模型 ${id} 缺 compat`).toBe("max_completion_tokens");
    }
  });

  it("baseUrl 落到 model 上(转发目标正确)", () => {
    const { modelRegistry } = createSharedModelServices(agentDir);
    registerAiGatewayProvider(modelRegistry, {
      baseUrl: "https://gw.example.com/compat/v1",
      apiKey: "k",
      modelIds: ["openai/gpt-5.5"], pendingCatalog: false,
    });
    expect(modelRegistry.find(AI_GATEWAY_PROVIDER_NAME, "openai/gpt-5.5")?.baseUrl).toBe(
      "https://gw.example.com/compat/v1",
    );
  });

  // Req 2.3/7.1:可观测但绝不泄露凭据。
  it("日志记 provider 与条目数,不含凭据", () => {
    const { modelRegistry } = createSharedModelServices(agentDir);
    const lines: Array<{ msg: string; data?: Record<string, unknown> }> = [];
    registerAiGatewayProvider(
      modelRegistry,
      {
        baseUrl: "https://gw.example.com/compat/v1",
        apiKey: "super-secret-token",
        modelIds: ["openai/gpt-5.5", "anthropic/claude-opus-5"], pendingCatalog: false,
      },
      { info: (msg, data) => lines.push({ msg, ...(data ? { data } : {}) }) },
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.data).toMatchObject({
      provider: AI_GATEWAY_PROVIDER_NAME,
      models: 2,
    });
    expect(JSON.stringify(lines)).not.toContain("super-secret-token");
  });

  // spec multi-gateway-providers 任务 3.5(Req 1.1/6.2/6.5):自定义 providerName
  // 须真正落地 —— 把它改回恒用 AI_GATEWAY_PROVIDER_NAME 常量,本用例必须报红。
  it("★传入自定义 providerName → 按该名可解析,日志 provider 字段为该名", () => {
    const { modelRegistry } = createSharedModelServices(agentDir);
    const lines: Array<{ msg: string; data?: Record<string, unknown> }> = [];
    registerAiGatewayProvider(
      modelRegistry,
      {
        baseUrl: "https://gw.example.com/compat/v1",
        apiKey: "k",
        modelIds: ["anthropic/claude-opus-5"], pendingCatalog: false,
      },
      { info: (msg, data) => lines.push({ msg, ...(data ? { data } : {}) }) },
      "my-custom-gateway",
    );
    expect(
      modelRegistry.find("my-custom-gateway", "anthropic/claude-opus-5"),
    ).toBeDefined();
    // 未注册进默认命名空间。
    expect(
      modelRegistry.find(AI_GATEWAY_PROVIDER_NAME, "anthropic/claude-opus-5"),
    ).toBeUndefined();
    expect(lines[0]?.data).toMatchObject({ provider: "my-custom-gateway" });
  });
});

// Req 3.1/3.4:两个来源必须共存 —— 谁自建 registry 谁就顶掉对方。
describe("egress 与 ai-gateway 共存(design.md §D2)", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-gw-coexist-"));
  });
  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("同一 registry 注册两个来源 → 两侧模型均可解析", () => {
    const { modelRegistry } = createSharedModelServices(agentDir);
    registerEgressProvider(modelRegistry, {
      egressBaseUrl: "https://egress.example.com/v1",
      credential: "desktop-cred",
      models: [{ id: "cloud-model-a" }],
    });
    registerAiGatewayProvider(modelRegistry, {
      baseUrl: "https://gw.example.com/compat/v1",
      apiKey: "cf-token",
      modelIds: ["anthropic/claude-opus-5"], pendingCatalog: false,
    });

    expect(modelRegistry.find("pi-cloud", "cloud-model-a")).toBeDefined();
    expect(
      modelRegistry.find(AI_GATEWAY_PROVIDER_NAME, "anthropic/claude-opus-5"),
    ).toBeDefined();
  });

  it("仅 egress 时网关模型不可解析(反向锚定)", () => {
    const { modelRegistry } = createSharedModelServices(agentDir);
    registerEgressProvider(modelRegistry, {
      egressBaseUrl: "https://egress.example.com/v1",
      credential: "desktop-cred",
      models: [{ id: "cloud-model-a" }],
    });
    expect(
      modelRegistry.find(AI_GATEWAY_PROVIDER_NAME, "anthropic/claude-opus-5"),
    ).toBeUndefined();
  });

  it("egress 解析器对网关 env 无反应(两来源判据互不干扰)", () => {
    expect(resolveEgressSpecFromEnv(envOf())).toBeUndefined();
  });
});

describe("图像模型清单(spec desktop-aigc-egress 任务 3.1)", () => {
  it("★ 未携带图像清单 → imageModelIds 缺席,对话侧解析逐字节不变", () => {
    const specs = resolveAiGatewaySessionSpecsFromEnv({
      PI_WEB_AI_GATEWAY_SESSIONS: "blksails-cloud",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_BASE: "https://c.example/api/desktop/egress/v1",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_KEY: "desk.cred",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_MODELS: JSON.stringify(["gpt-5"]),
    });
    expect(specs).toHaveLength(1);
    expect(specs[0]!.spec.modelIds).toEqual(["gpt-5"]);
    expect(specs[0]!.spec.imageModelIds).toBeUndefined();
  });

  it("★ 空数组清单被保留(云端明确声明没有),不归一成缺席", () => {
    const specs = resolveAiGatewaySessionSpecsFromEnv({
      PI_WEB_AI_GATEWAY_SESSIONS: "blksails-cloud",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_BASE: "https://c.example/v1",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_KEY: "desk.cred",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_IMAGE_MODELS: "[]",
    });
    // 缺席 → 回退内置白名单;空数组 → 一个都不可用。两者必须可分辨。
    expect(specs[0]!.spec.imageModelIds).toEqual([]);
  });

  it("携带清单 → 原样解析", () => {
    const specs = resolveAiGatewaySessionSpecsFromEnv({
      PI_WEB_AI_GATEWAY_SESSIONS: "blksails-cloud",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_BASE: "https://c.example/v1",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_KEY: "desk.cred",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_IMAGE_MODELS: JSON.stringify([
        "gpt-image-2",
        "qwen-image",
      ]),
    });
    expect(specs[0]!.spec.imageModelIds).toEqual(["gpt-image-2", "qwen-image"]);
  });

  it("图像清单 JSON 非法 → 视为空清单,不影响该实例启用(fail-soft)", () => {
    const specs = resolveAiGatewaySessionSpecsFromEnv({
      PI_WEB_AI_GATEWAY_SESSIONS: "blksails-cloud",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_BASE: "https://c.example/v1",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_KEY: "desk.cred",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_IMAGE_MODELS: "{not json",
    });
    expect(specs).toHaveLength(1);
    expect(specs[0]!.spec.imageModelIds).toEqual([]);
  });
});
