/**
 * register-panels-logging（任务 3.4）：logging 面板注册与 logNamespaceToggles renderer 测试。
 *
 * 覆盖 requirements:
 *  - Req 6.1 — logging 面板被注册（注册表含 logging 条目）
 *  - Req 6.7 — logNamespaceToggles 字段 renderer 被注册
 *
 * 由于 register-panels 使用模块级单例，测试用 vi.resetModules() 隔离各用例。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock 注册函数，捕获调用 ────────────────────────────────────────────────────

const registeredPanels: string[] = [];
const registeredFieldRenderers: string[] = [];

vi.mock("@blksails/pi-web-react", () => ({
  registerSettingsPanel: (panel: { id: string }) => {
    registeredPanels.push(panel.id);
  },
  makeConfigDomainIO: (domain: string) => ({ load: vi.fn(), save: vi.fn(), domain }),
  zodValidator: () => vi.fn(),
  secretAwareValidator: () => vi.fn(),
}));

vi.mock("@blksails/pi-web-ui", () => ({
  registerFieldRendererByKey: (key: string) => {
    registeredFieldRenderers.push(key);
  },
  ExtensionsKvField: vi.fn(),
  ConfigFilesField: vi.fn(),
  ModelSelectField: vi.fn(),
  NamespaceTogglesField: vi.fn(),
  // aigc-tool-settings 后 register-panels 亦注册 aigcModelToggles 渲染器(register-panels.ts:146),
  // mock 须同步补齐,否则被测模块 import 即崩(与被测断言无关的装配依赖)。
  AigcModelTogglesField: vi.fn(),
}));

// protocol 是纯 schema 包(无运行时副作用),故整体透传真实导出而非逐项白名单:
// 白名单每次新增 config 域都要同步补齐,否则被测模块 import 即崩——已连续踩中两次
// (aigc 一次、mcp 一次,后者是 register-panels.ts:212 的 mcpFormSchema)。透传后
// 本用例只关心「logging 面板/renderer 是否注册」,不再被无关域的装配依赖牵连。
vi.mock("@blksails/pi-web-protocol", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@blksails/pi-web-protocol")>()),
}));

describe("registerConfigPanels — logging 面板与 renderer 注册", () => {
  beforeEach(() => {
    registeredPanels.length = 0;
    registeredFieldRenderers.length = 0;
    vi.resetModules();
  });

  it("注册后面板列表包含 logging（Req 6.1）", async () => {
    // Re-import after resetModules to get a fresh module without the `registered` flag set.
    const { registerConfigPanels } = await import("@/lib/settings/register-panels");
    // Reset the singleton guard by re-importing (module is fresh after resetModules).
    registerConfigPanels();
    expect(registeredPanels).toContain("logging");
  });

  it("注册 logNamespaceToggles 字段渲染器（Req 6.7）", async () => {
    const { registerConfigPanels } = await import("@/lib/settings/register-panels");
    registerConfigPanels();
    expect(registeredFieldRenderers).toContain("logNamespaceToggles");
  });
});
