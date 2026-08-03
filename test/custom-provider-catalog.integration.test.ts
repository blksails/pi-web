/**
 * Integration: 自定义 provider 接入部署级目录 —— 经真实生产装配路径验证
 * (spec multi-gateway-providers,任务 5.3 修复轮,Req 7.2, 7.5)。
 *
 * 上一轮的缺口:`packages/core/src/model-catalog/service.ts` 的 `customProviders`
 * 合并逻辑与 `packages/server/src/host-assembly/model-sources.ts` 的会话侧接线都已
 * 落地,但全仓唯一的生产 `createModelCatalogService(...)` 调用点
 * (`lib/app/pi-handler.ts` 的 `makeModelCatalog()`)从未注入 `customProviders`——
 * 于是 `GET /api/config/models` 上该合并恒为死代码。本测试直接打生产 HTTP 端点,
 * 不经任何测试专用捷径,证明这条路径是真的。
 *
 * ★ 必须带筛选参数(`?output=text`):pi-handler.ts 在**无筛选参数**时刻意走
 *   `chatOptions()` 而非 `query()`(Req 10.1「零筛选=行为不变」的既定取舍),
 *   `chatOptions()` 不含自定义 provider。生产消费方 `model-select-field.tsx` 恒以
 *   `{ output: "text" }` 取数,筛选路径才是真实路径。
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";

process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_STUB_AGENT_PATH = path.join(
  process.cwd(),
  "lib",
  "app",
  "stub-agent-process.mjs",
);
// 目录断言的确定性:不让宿主环境的 hidden 配置渗入,也不让宿主的网关套件渗入。
delete process.env.PI_WEB_HIDE_PROVIDERS;
delete process.env.AI_GATEWAY_BASE_URL;
delete process.env.PI_WEB_GATEWAYS;

const agentDir = mkdtempSync(join(tmpdir(), "pi-web-custom-provider-catalog-"));
process.env.PI_WEB_AGENT_DIR = agentDir;

const CUSTOM_PROVIDER_ID = "acme-custom";
const CUSTOM_MODEL_ID = "acme-model-1";

function writeProvidersJson(body: unknown): void {
  writeFileSync(join(agentDir, "providers.json"), JSON.stringify(body), "utf8");
}

writeProvidersJson({
  providers: [
    {
      id: CUSTOM_PROVIDER_ID,
      displayName: "Acme Custom",
      baseUrl: "https://acme.example.com/v1",
      apiKey: "sk-acme-test",
      models: [{ id: CUSTOM_MODEL_ID, name: "Acme Model One" }],
    },
  ],
});

const route = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

function req(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost${pathname}`, init);
}

afterAll(async () => {
  await shutdownHandler();
  rmSync(agentDir, { recursive: true, force: true });
});

interface CatalogModel {
  readonly provider: string;
  readonly id: string;
  readonly source?: string;
}

interface CatalogResponse {
  readonly providers: readonly string[];
  readonly models: readonly CatalogModel[];
}

describe("GET /api/config/models?output=text — 自定义 provider 接入部署级目录(Req 7.2)", () => {
  it("新增一个自定义 provider 后,其 provider 与模型均出现在目录中", async () => {
    const res = await route.GET(req("/api/config/models?output=text"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as CatalogResponse;

    expect(body.providers).toContain(CUSTOM_PROVIDER_ID);
    const model = body.models.find(
      (m) => m.provider === CUSTOM_PROVIDER_ID && m.id === CUSTOM_MODEL_ID,
    );
    expect(model, "自定义 provider 的模型未出现在目录中").toBeDefined();
    expect(model!.source).toBe("custom");
  });
});

describe("停用后 — 模型从目录消失但配置仍在(Req 7.5)", () => {
  it("停用该 provider 后,GET /api/config/models?output=text 不再含其模型,而 providers.json 仍保留其完整定义", async () => {
    writeProvidersJson({
      providers: [
        {
          id: CUSTOM_PROVIDER_ID,
          displayName: "Acme Custom",
          enabled: false,
          baseUrl: "https://acme.example.com/v1",
          apiKey: "sk-acme-test",
          models: [{ id: CUSTOM_MODEL_ID, name: "Acme Model One" }],
        },
      ],
    });

    const res = await route.GET(req("/api/config/models?output=text"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as CatalogResponse;

    expect(body.providers).not.toContain(CUSTOM_PROVIDER_ID);
    const model = body.models.find(
      (m) => m.provider === CUSTOM_PROVIDER_ID && m.id === CUSTOM_MODEL_ID,
    );
    expect(model, "停用后模型仍出现在目录中").toBeUndefined();

    // 配置仍在磁盘上,完整未被清除(每请求重新读盘,不缓存)。
    const raw = JSON.parse(readFileSync(join(agentDir, "providers.json"), "utf8")) as {
      providers: Array<{ id: string; enabled: boolean; baseUrl: string }>;
    };
    expect(raw.providers).toHaveLength(1);
    expect(raw.providers[0]!.id).toBe(CUSTOM_PROVIDER_ID);
    expect(raw.providers[0]!.enabled).toBe(false);
    expect(raw.providers[0]!.baseUrl).toBe("https://acme.example.com/v1");
  });
});
