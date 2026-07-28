/**
 * 「MCP」设置面板的登记(spec: builtin-mcp-client,任务 4.2;Req 4.1, 4.2, 4.5, 5.2, 2.4)。
 *
 * 行为变更:此前是「装了 pi-mcp-adapter 才出现」的异步 installed 探测门控;MCP 内置化后
 * 改为**常驻登记**(Req 5.2),且表单从裸 JSON 升级为结构化 IR(Req 4.1)。
 *
 * protocol 用**真实模块**(纯包),以便直接断言真实的 mcpFormSchema 结构。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FormSchema } from "@blksails/pi-web-protocol";

const registeredPanels: Array<{ id: string; title?: string; formSchema?: FormSchema }> = [];

vi.mock("@blksails/pi-web-react", () => ({
  registerSettingsPanel: (panel: { id: string; title?: string; formSchema?: FormSchema }) => {
    registeredPanels.push(panel);
  },
  makeConfigDomainIO: (domain: string) => ({ load: vi.fn(), save: vi.fn(), domain }),
  zodValidator: () => vi.fn(),
  secretAwareValidator: () => vi.fn(),
}));

vi.mock("@blksails/pi-web-ui", () => ({
  registerFieldRendererByKey: vi.fn(),
  ExtensionsKvField: vi.fn(),
  ConfigFilesField: vi.fn(),
  ModelSelectField: vi.fn(),
  NamespaceTogglesField: vi.fn(),
  AigcModelTogglesField: vi.fn(),
}));

beforeEach(() => {
  registeredPanels.length = 0;
  vi.resetModules();
});

async function registerAll(): Promise<void> {
  const { registerConfigPanels } = await import("@/lib/settings/register-panels");
  registerConfigPanels();
}

const mcpPanel = () => registeredPanels.find((p) => p.id === "mcp");

describe("MCP 面板常驻登记(Req 5.2)", () => {
  it("无需任何扩展探测即登记 MCP 面板", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await registerAll();
    // 变异判据:若恢复 installed 门控,未探测时该面板不会被登记 → 转红。
    expect(mcpPanel()).toBeDefined();
    expect(mcpPanel()?.title).toBe("MCP");
    // 登记过程不得依赖任何网络探测
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("MCP 面板使用结构化表单 IR(Req 4.1, 4.2, 4.5, 2.4)", () => {
  it("server 列表是 objectList,不再是裸 JSON 文本框", async () => {
    await registerAll();
    const fields = mcpPanel()?.formSchema?.fields ?? [];
    const servers = fields.find((f) => f.key === "servers");
    // 变异判据:若退回 configFiles 裸 JSON widget,两条断言均转红。
    expect(servers?.kind).toBe("objectList");
    expect(fields.some((f) => f.widget === "configFiles")).toBe(false);
  });

  it("条目含名称 / 启用开关 / 传输判别(Req 4.2, 4.5)", async () => {
    await registerAll();
    const servers = mcpPanel()?.formSchema?.fields.find((f) => f.key === "servers");
    const itemKeys = (servers?.itemFields ?? []).map((f) => f.key);
    expect(itemKeys).toEqual(expect.arrayContaining(["name", "enabled", "transport"]));
  });

  it("传输字段按类型切换字段集,覆盖三种标准传输(Req 2.4)", async () => {
    await registerAll();
    const servers = mcpPanel()?.formSchema?.fields.find((f) => f.key === "servers");
    const transport = servers?.itemFields?.find((f) => f.key === "transport");
    expect(transport?.variants?.discriminator).toBe("type");
    expect([...(transport?.variants?.cases ?? [])].map((c) => c.value).sort()).toEqual([
      "sse",
      "stdio",
      "streamable-http",
    ]);
  });

  it("凭据字段(env / headers)按 secret 掩码(Req 7.2)", async () => {
    await registerAll();
    const servers = mcpPanel()?.formSchema?.fields.find((f) => f.key === "servers");
    const cases = servers?.itemFields?.find((f) => f.key === "transport")?.variants?.cases ?? [];
    const envField = cases.find((c) => c.value === "stdio")?.fields.find((f) => f.key === "env");
    const headerField = cases
      .find((c) => c.value === "streamable-http")
      ?.fields.find((f) => f.key === "headers");
    expect(envField?.itemKind).toBe("secret");
    expect(headerField?.itemKind).toBe("secret");
  });
});
