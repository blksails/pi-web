/**
 * model-catalog · CustomProviderSource(spec: multi-gateway-providers,任务 5.3;
 * Req 7.2, 7.5)。
 *
 * `.it` 档:真实写盘 + 真实读盘(`mkdtempSync`),不是内存 fixture ——
 * providers.json 的读取路径本身就是本任务要交付的东西,伪造 fs 会漏掉「文件缺失/
 * JSON 损坏/单条目结构非法」这些 fail-soft 分支的真实行为。
 *
 * 完成判据(任务描述原文):集成测试断言新增一个自定义 provider 后其模型出现在
 * 目录,停用后消失且配置仍在 —— 见末尾「完成判据」describe 块。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createModelCatalogService } from "../../src/model-catalog/service.js";
import { createProviderRegistry } from "../../src/model-catalog/provider-source.js";
import {
  CUSTOM_PROVIDERS_CONFIG_FILENAME,
  createCustomProviderSource,
  readCustomProviderEntries,
  resolveCustomProvidersAgentDir,
  toProviderDefinitions,
} from "../../src/model-catalog/custom-provider-source.js";

function writeProvidersJson(agentDir: string, body: unknown): void {
  writeFileSync(join(agentDir, CUSTOM_PROVIDERS_CONFIG_FILENAME), JSON.stringify(body), "utf8");
}

describe("readCustomProviderEntries — fail-soft(文件/JSON/结构异常)", () => {
  let agentDir: string;
  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-custom-provider-"));
  });
  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("providers.json 不存在 → 空数组,不抛", () => {
    expect(readCustomProviderEntries(agentDir)).toEqual([]);
  });

  it("JSON 损坏 → 空数组,不抛", () => {
    writeFileSync(join(agentDir, CUSTOM_PROVIDERS_CONFIG_FILENAME), "{not json", "utf8");
    expect(readCustomProviderEntries(agentDir)).toEqual([]);
  });

  it("顶层不是对象 → 空数组", () => {
    writeProvidersJson(agentDir, [1, 2, 3]);
    expect(readCustomProviderEntries(agentDir)).toEqual([]);
  });

  it("`providers` 字段不是数组 → 空数组", () => {
    writeProvidersJson(agentDir, { providers: "nope" });
    expect(readCustomProviderEntries(agentDir)).toEqual([]);
  });

  it("单条目缺 baseUrl → 只丢弃该条目,不牵连其余条目(逐条目独立校验)", () => {
    writeProvidersJson(agentDir, {
      providers: [
        { id: "bad-one" },
        { id: "good-one", baseUrl: "https://good.example.com/v1", models: [{ id: "m1" }] },
      ],
    });
    const entries = readCustomProviderEntries(agentDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("good-one");
  });

  it("单条目缺 id → 丢弃该条目", () => {
    writeProvidersJson(agentDir, { providers: [{ baseUrl: "https://x.example.com/v1" }] });
    expect(readCustomProviderEntries(agentDir)).toEqual([]);
  });
});

describe("readCustomProviderEntries — 字段解析(enabled 缺省/input·output/models)", () => {
  let agentDir: string;
  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-custom-provider-"));
  });
  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("enabled 缺省视为启用(与 protocol providerEntrySchema 的 default(true) 一致)", () => {
    writeProvidersJson(agentDir, {
      providers: [{ id: "p1", baseUrl: "https://p1.example.com/v1", models: [] }],
    });
    expect(readCustomProviderEntries(agentDir)[0]?.enabled).toBe(true);
  });

  it("enabled:false 显式保留为停用", () => {
    writeProvidersJson(agentDir, {
      providers: [{ id: "p1", baseUrl: "https://p1.example.com/v1", enabled: false, models: [] }],
    });
    expect(readCustomProviderEntries(agentDir)[0]?.enabled).toBe(false);
  });

  it("input/output 非法取值被剔除,合法取值保留(成员校验)", () => {
    writeProvidersJson(agentDir, {
      providers: [
        {
          id: "p1",
          baseUrl: "https://p1.example.com/v1",
          input: ["text", "not-a-modality"],
          output: ["image"],
          models: [],
        },
      ],
    });
    const [entry] = readCustomProviderEntries(agentDir);
    expect(entry?.input).toEqual(["text"]);
    expect(entry?.output).toEqual(["image"]);
  });

  it("models 里缺 id 的条目被剔除,合法的保留", () => {
    writeProvidersJson(agentDir, {
      providers: [
        {
          id: "p1",
          baseUrl: "https://p1.example.com/v1",
          models: [{ name: "no id" }, { id: "m1", name: "M1" }],
        },
      ],
    });
    expect(readCustomProviderEntries(agentDir)[0]?.models).toEqual([{ id: "m1", name: "M1" }]);
  });

  it("完整字段(id/displayName/enabled/baseUrl/apiKey/input/output/models)全部往返", () => {
    writeProvidersJson(agentDir, {
      providers: [
        {
          id: "acme",
          displayName: "Acme AI",
          enabled: true,
          baseUrl: "https://acme.example.com/v1",
          apiKey: "sk-secret",
          input: ["text"],
          output: ["text", "image"],
          models: [{ id: "acme-1", name: "Acme One" }],
        },
      ],
    });
    expect(readCustomProviderEntries(agentDir)).toEqual([
      {
        id: "acme",
        displayName: "Acme AI",
        enabled: true,
        baseUrl: "https://acme.example.com/v1",
        apiKey: "sk-secret",
        input: ["text"],
        output: ["text", "image"],
        models: [{ id: "acme-1", name: "Acme One" }],
      },
    ]);
  });
});

describe("resolveCustomProvidersAgentDir — env 优先级", () => {
  it("PI_WEB_AGENT_DIR 优先于 PI_CODING_AGENT_DIR", () => {
    expect(
      resolveCustomProvidersAgentDir({
        PI_WEB_AGENT_DIR: "/from/pi-web",
        PI_CODING_AGENT_DIR: "/from/pi-coding",
      } as NodeJS.ProcessEnv),
    ).toBe("/from/pi-web");
  });

  it("仅 PI_CODING_AGENT_DIR 时回落到它(runner 子进程恒有)", () => {
    expect(
      resolveCustomProvidersAgentDir({ PI_CODING_AGENT_DIR: "/from/pi-coding" } as NodeJS.ProcessEnv),
    ).toBe("/from/pi-coding");
  });

  it("两者皆无时落到 ~/.pi/agent", () => {
    const resolved = resolveCustomProvidersAgentDir({} as NodeJS.ProcessEnv);
    expect(resolved.endsWith(join(".pi", "agent"))).toBe(true);
  });
});

describe("toProviderDefinitions — 保留 enabled 原值(供 ProviderRegistry.find() 在停用后仍可查到)", () => {
  it("enabled:false 的条目仍被投影,而非被过滤掉", () => {
    const defs = toProviderDefinitions([
      { id: "p1", enabled: false, baseUrl: "https://x", models: [{ id: "m1" }] },
    ]);
    expect(defs).toEqual([{ id: "p1", enabled: false, models: [{ id: "m1" }] }]);
  });
});

/**
 * 完成判据(任务 5.3 描述原文):集成测试断言新增一个自定义 provider 后其模型出现在
 * 目录,停用后消失且配置仍在。
 *
 * 全链路:providers.json(真实磁盘)→ `createCustomProviderSource` →
 * `createProviderRegistry` → `ModelCatalogService.query()`。装配层每次重新读盘
 * (design 既定语义:目录服务每请求构造),故本用例用「重写文件 + 重新组装」模拟
 * 两次请求之间配置发生变化。
 */
describe("CustomProviderSource → ProviderRegistry → ModelCatalogService.query() 全链路(Req 7.2/7.5)", () => {
  let agentDir: string;
  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-custom-provider-catalog-"));
  });
  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  function buildService() {
    const source = createCustomProviderSource(agentDir);
    const registry = createProviderRegistry([source]);
    const svc = createModelCatalogService({
      listSelfChat: () => ({ providers: [], models: [] }),
      imageCatalog: [],
      hiddenProviders: new Set(),
      customProviders: registry,
    });
    return { svc, registry };
  }

  it("新增一个启用的自定义 provider 后,其模型出现在目录里", () => {
    writeProvidersJson(agentDir, {
      providers: [
        {
          id: "my-custom",
          baseUrl: "https://my-custom.example.com/v1",
          apiKey: "sk-abc",
          output: ["image"],
          models: [{ id: "m1", name: "Model One" }],
        },
      ],
    });

    const { svc } = buildService();
    const result = svc.query({});
    expect(result.providers).toContain("my-custom");
    expect(result.models).toContainEqual(
      expect.objectContaining({ provider: "my-custom", id: "m1", source: "custom" }),
    );
  });

  it("停用该 provider 后,其模型从目录里消失,但磁盘上的配置(baseUrl/apiKey/models)原样保留", () => {
    writeProvidersJson(agentDir, {
      providers: [
        {
          id: "my-custom",
          baseUrl: "https://my-custom.example.com/v1",
          apiKey: "sk-abc",
          output: ["image"],
          models: [{ id: "m1", name: "Model One" }],
        },
      ],
    });
    // 第一次:确认它确实先出现过(否则下面的"消失"断言没有对照)。
    expect(buildService().svc.query({}).providers).toContain("my-custom");

    // 停用:只翻 enabled,其余字段原样重写(等价于设置界面的「停用」操作)。
    writeProvidersJson(agentDir, {
      providers: [
        {
          id: "my-custom",
          enabled: false,
          baseUrl: "https://my-custom.example.com/v1",
          apiKey: "sk-abc",
          output: ["image"],
          models: [{ id: "m1", name: "Model One" }],
        },
      ],
    });

    const { svc, registry } = buildService();
    const result = svc.query({});
    expect(result.providers).not.toContain("my-custom");
    expect(result.models.some((m) => m.provider === "my-custom")).toBe(false);

    // 配置仍在:ProviderRegistry.find() 不受 enabled 过滤影响。
    const stillThere = registry.find("my-custom");
    expect(stillThere).toBeDefined();
    expect(stillThere?.enabled).toBe(false);
    expect(stillThere?.models).toEqual([{ id: "m1", name: "Model One" }]);

    // 配置仍在(文件层面):原始条目的连接细节没有被清空或篡改。
    const raw = readCustomProviderEntries(agentDir);
    expect(raw).toEqual([
      {
        id: "my-custom",
        enabled: false,
        baseUrl: "https://my-custom.example.com/v1",
        apiKey: "sk-abc",
        output: ["image"],
        models: [{ id: "m1", name: "Model One" }],
      },
    ]);
  });

  it("未创建 providers.json 时,目录行为与自定义 provider 不存在时一致(零侵入)", () => {
    const { svc } = buildService();
    expect(svc.query({}).models.some((m) => m.source === "custom")).toBe(false);
  });
});
