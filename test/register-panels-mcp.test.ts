/**
 * registerMcpPanelIfInstalled — 「装了 pi-mcp-adapter 才出现」门控:
 *  - GET /api/config/mcp installed:true  → 登记「mcp」面板
 *  - installed:false / 请求失败          → 不登记
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const registeredPanels: string[] = [];

vi.mock("@blksails/pi-web-react", () => ({
  registerSettingsPanel: (panel: { id: string }) => {
    registeredPanels.push(panel.id);
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
}));

vi.mock("@blksails/pi-web-protocol", () => ({
  authFormSchema: { domain: "auth", fields: [] },
  authConfigSchema: {},
  settingsFormSchema: { domain: "settings", fields: [] },
  settingsConfigSchema: {},
  sandboxFormSchema: { domain: "sandbox", fields: [] },
  sandboxConfigSchema: {},
  extensionsFormSchema: { domain: "extensions", fields: [] },
  extensionsConfigSchema: {},
  loggingFormSchema: { domain: "logging", fields: [] },
  loggingConfigSchema: {},
}));

function fetchReturning(installed: boolean | undefined, ok = true): typeof fetch {
  return vi.fn(async () => ({
    ok,
    json: async () => (installed === undefined ? {} : { installed }),
  })) as unknown as typeof fetch;
}

describe("registerMcpPanelIfInstalled", () => {
  beforeEach(() => {
    registeredPanels.length = 0;
    vi.resetModules();
  });

  it("installed:true → 登记 mcp 面板,返回 true", async () => {
    const { registerMcpPanelIfInstalled } = await import("@/lib/settings/register-panels");
    const added = await registerMcpPanelIfInstalled(fetchReturning(true));
    expect(added).toBe(true);
    expect(registeredPanels).toContain("mcp");
  });

  it("installed:false → 不登记,返回 false", async () => {
    const { registerMcpPanelIfInstalled } = await import("@/lib/settings/register-panels");
    const added = await registerMcpPanelIfInstalled(fetchReturning(false));
    expect(added).toBe(false);
    expect(registeredPanels).not.toContain("mcp");
  });

  it("请求失败 → 不登记", async () => {
    const { registerMcpPanelIfInstalled } = await import("@/lib/settings/register-panels");
    const added = await registerMcpPanelIfInstalled(fetchReturning(undefined, false));
    expect(added).toBe(false);
    expect(registeredPanels).not.toContain("mcp");
  });
});
