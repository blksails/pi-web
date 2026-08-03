/**
 * 「Provider」设置面板的登记(spec: multi-gateway-providers,任务 5.4;Req 7.1, 11.7)。
 *
 * 覆盖:面板常驻登记(不依赖任何探测)、复用 5.1 的 providersFormSchema(objectList +
 * secret + multiEnum)、IO 走通用 `/config/providers`(makeConfigDomainIO,与 mcp 独立
 * 探测式路由不同)。
 *
 * protocol 用**真实模块**,以便直接断言真实的 providersFormSchema 结构与
 * createProvidersConfigSchema 是否被正确调用(经 mock 的 secretAwareValidator 转发实参)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FormSchema } from "@blksails/pi-web-protocol";

interface RegisteredPanel {
  readonly id: string;
  readonly title?: string;
  readonly formSchema?: FormSchema;
  readonly domain?: string;
}

const registeredPanels: RegisteredPanel[] = [];
const secretAwareValidatorCalls: unknown[] = [];

vi.mock("@blksails/pi-web-react", () => ({
  registerSettingsPanel: (panel: RegisteredPanel) => {
    registeredPanels.push(panel);
  },
  makeConfigDomainIO: (domain: string) => ({ load: vi.fn(), save: vi.fn(), domain }),
  zodValidator: () => vi.fn(),
  secretAwareValidator: (schema: unknown) => {
    secretAwareValidatorCalls.push(schema);
    return vi.fn();
  },
}));

vi.mock("@blksails/pi-web-ui", () => ({
  registerFieldRendererByKey: vi.fn(),
  ExtensionsKvField: vi.fn(),
  ConfigFilesField: vi.fn(),
  ModelSelectField: vi.fn(),
  NamespaceTogglesField: vi.fn(),
  AigcModelTogglesField: vi.fn(),
  VisionModelSelectField: vi.fn(),
}));

beforeEach(() => {
  registeredPanels.length = 0;
  secretAwareValidatorCalls.length = 0;
  vi.resetModules();
});

async function registerAll(): Promise<void> {
  const { registerConfigPanels } = await import("@/lib/settings/register-panels");
  registerConfigPanels();
}

const providersPanel = (): RegisteredPanel | undefined =>
  registeredPanels.find((p) => p.id === "providers");

describe("Provider 面板常驻登记(Req 11.7)", () => {
  it("无需任何探测即登记 providers 面板", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await registerAll();
    // 变异判据:若漏了这次 registerSettingsPanel 调用 → 转红。
    expect(providersPanel()).toBeDefined();
    expect(providersPanel()?.title).toBe("Provider");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("IO 走通用 /config/providers(makeConfigDomainIO),不是独立探测式路由", async () => {
    await registerAll();
    // 变异判据:若改用 makeUrlIO("/api/config/mcp"...) 之类的裸路径 → domain 字段消失/错位。
    expect(providersPanel()?.domain).toBe("providers");
  });
});

describe("Provider 面板复用 5.1 交付的表单 IR(Req 7.1)", () => {
  it("providers 字段是 objectList(可增删),含标识/显示名/启用/地址/凭据/类型/模型清单", async () => {
    await registerAll();
    const providersField = providersPanel()?.formSchema?.fields.find((f) => f.key === "providers");
    expect(providersField?.kind).toBe("objectList");
    const itemKeys = (providersField?.itemFields ?? []).map((f) => f.key);
    expect(itemKeys).toEqual(
      expect.arrayContaining(["id", "displayName", "enabled", "baseUrl", "apiKey", "input", "output", "models"]),
    );
  });

  it("凭据字段为 secret,故用 secretAwareValidator 而非 zodValidator(Req 7.3)", async () => {
    await registerAll();
    // secretAwareValidatorCalls 含全部使用 secretAwareValidator 登记的域(如 auth),故不能
    // 按调用次数断言;改为断言其中**存在**一个 schema 接受 providers 域形状的载荷 ——
    // 变异判据:若 providers 面板改用 zodValidator(schema 压根没被传给
    // secretAwareValidator)→ 没有任何记录能通过下面这条 safeParse,断言转红。
    const acceptsProvidersShape = secretAwareValidatorCalls.some((schema) => {
      const s = schema as { safeParse: (v: unknown) => { success: boolean } };
      return s.safeParse({
        providers: [{ id: "e2e-check", baseUrl: "https://api.example.com/v1" }],
      }).success;
    });
    expect(acceptsProvidersShape).toBe(true);
  });
});
