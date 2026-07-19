import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { FormSchema } from "@blksails/pi-web-protocol";
import { createSettingsRegistry } from "../../src/config/settings-registry.js";
import {
  registerSourceSettingsPanel,
  sourceSettingsPanelId,
  unregisterSourceSettingsPanel,
  useSourceSettingsPanel,
} from "../../src/config/register-source-settings-panel.js";

const SCHEMA: FormSchema = {
  domain: "source:abc123",
  title: "CRM 助手",
  fields: [{ key: "apiBase", kind: "string", label: "API Base", required: false }],
};

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function notFoundResponse(): Response {
  return { ok: false, status: 404, json: async () => ({}) } as Response;
}

describe("registerSourceSettingsPanel", () => {
  it("GET 命中 schema → 登记面板,id 含 sourceKey,标题取 schema.title", async () => {
    const registry = createSettingsRegistry();
    const fetchImpl = vi.fn(async () => okResponse({ schema: SCHEMA, values: {}, scope: "source" }));
    const added = await registerSourceSettingsPanel("abc123", "CRM(回退名)", { registry, fetchImpl });
    expect(added).toBe(true);
    expect(registry.listPanels().map((p) => p.id)).toEqual([sourceSettingsPanelId("abc123")]);
    expect(registry.resolvePanel(sourceSettingsPanelId("abc123"))?.title).toBe("CRM 助手");
    expect(fetchImpl).toHaveBeenCalledWith("/api/config/source/abc123", { method: "GET" });
  });

  it("schema 无 title 时回退调用方传入的 fallbackTitle", async () => {
    const registry = createSettingsRegistry();
    const untitled: FormSchema = { domain: "source:abc123", fields: [] };
    const fetchImpl = vi.fn(async () => okResponse({ schema: untitled, values: {} }));
    await registerSourceSettingsPanel("abc123", "回退名", { registry, fetchImpl });
    expect(registry.resolvePanel(sourceSettingsPanelId("abc123"))?.title).toBe("回退名");
  });

  it("响应体清单级 title/icon 优先于 schema.title(Req 5.2,任务 5.1 附带修复)", async () => {
    const registry = createSettingsRegistry();
    const fetchImpl = vi.fn(async () =>
      okResponse({ schema: SCHEMA, values: {}, title: "清单标题", icon: "🔧" }),
    );
    await registerSourceSettingsPanel("abc123", "回退名", { registry, fetchImpl });
    const panel = registry.resolvePanel(sourceSettingsPanelId("abc123"));
    expect(panel?.title).toBe("清单标题");
    expect(panel?.icon).toBe("🔧");
  });

  it("响应体无清单 title 时回退 schema.title(兼容既有 source)", async () => {
    const registry = createSettingsRegistry();
    const fetchImpl = vi.fn(async () => okResponse({ schema: SCHEMA, values: {} }));
    await registerSourceSettingsPanel("abc123", "回退名", { registry, fetchImpl });
    expect(registry.resolvePanel(sourceSettingsPanelId("abc123"))?.title).toBe("CRM 助手");
  });

  it("opts.icon 显式覆盖响应体清单 icon", async () => {
    const registry = createSettingsRegistry();
    const fetchImpl = vi.fn(async () =>
      okResponse({ schema: SCHEMA, values: {}, icon: "manifest-icon" }),
    );
    await registerSourceSettingsPanel("abc123", "回退名", {
      registry,
      fetchImpl,
      icon: "explicit-icon",
    });
    expect(registry.resolvePanel(sourceSettingsPanelId("abc123"))?.icon).toBe("explicit-icon");
  });

  it("重复激活幂等:同 sourceKey 两次登记只留一条面板", async () => {
    const registry = createSettingsRegistry();
    const fetchImpl = vi.fn(async () => okResponse({ schema: SCHEMA, values: {} }));
    await registerSourceSettingsPanel("abc123", "回退名", { registry, fetchImpl });
    await registerSourceSettingsPanel("abc123", "回退名", { registry, fetchImpl });
    expect(registry.listPanels()).toHaveLength(1);
  });

  it("GET 404(未声明 settings)→ 不登记,静默跳过", async () => {
    const registry = createSettingsRegistry();
    const fetchImpl = vi.fn(async () => notFoundResponse());
    const added = await registerSourceSettingsPanel("def456", "回退名", { registry, fetchImpl });
    expect(added).toBe(false);
    expect(registry.listPanels()).toHaveLength(0);
  });

  it("门控关闭(端点统一 404)→ 与「无 settings」同一降级路径,不登记", async () => {
    const registry = createSettingsRegistry();
    const fetchImpl = vi.fn(async () => notFoundResponse());
    const added = await registerSourceSettingsPanel("abc123", "回退名", { registry, fetchImpl });
    expect(added).toBe(false);
  });

  it("网络异常 → 不抛,不登记", async () => {
    const registry = createSettingsRegistry();
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const added = await registerSourceSettingsPanel("abc123", "回退名", { registry, fetchImpl });
    expect(added).toBe(false);
    expect(registry.listPanels()).toHaveLength(0);
  });

  it("面板的 load/save 转发到同一端点", async () => {
    const registry = createSettingsRegistry();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "PUT") return okResponse({ ok: true });
      if (url.includes("scope=")) return okResponse({ schema: SCHEMA, values: { apiBase: "https://x" } });
      return okResponse({ schema: SCHEMA, values: { apiBase: "https://x" } });
    });
    await registerSourceSettingsPanel("abc123", "回退名", { registry, fetchImpl });
    const panel = registry.resolvePanel(sourceSettingsPanelId("abc123"))!;
    const loaded = await panel.load();
    expect(loaded).toEqual({ values: { apiBase: "https://x" } });
    await panel.save({ apiBase: "https://y" });
    const putCall = fetchImpl.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    expect(putCall).toBeDefined();
    expect(JSON.parse((putCall![1] as RequestInit).body as string)).toEqual({
      values: { apiBase: "https://y" },
    });
  });
});

describe("unregisterSourceSettingsPanel", () => {
  it("撤销已登记的面板,不留孤儿条目", async () => {
    const registry = createSettingsRegistry();
    const fetchImpl = vi.fn(async () => okResponse({ schema: SCHEMA, values: {} }));
    await registerSourceSettingsPanel("abc123", "回退名", { registry, fetchImpl });
    expect(registry.listPanels()).toHaveLength(1);
    unregisterSourceSettingsPanel("abc123", registry);
    expect(registry.listPanels()).toHaveLength(0);
    expect(registry.resolvePanel(sourceSettingsPanelId("abc123"))).toBeUndefined();
  });

  it("撤销未登记的 sourceKey 静默忽略", () => {
    const registry = createSettingsRegistry();
    expect(() => unregisterSourceSettingsPanel("never-registered", registry)).not.toThrow();
  });
});

describe("useSourceSettingsPanel", () => {
  it("挂载即登记(激活→面板长出),onChange 命中一次", async () => {
    const registry = createSettingsRegistry();
    const fetchImpl = vi.fn(async () => okResponse({ schema: SCHEMA, values: {} }));
    const onChange = vi.fn();
    renderHook(() =>
      useSourceSettingsPanel("abc123", "回退名", { registry, fetchImpl, onChange }),
    );
    await waitFor(() => expect(registry.listPanels()).toHaveLength(1));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("切源:sourceKey 变化时回收旧面板、登记新面板", async () => {
    const registry = createSettingsRegistry();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("abc123")) return okResponse({ schema: SCHEMA, values: {} });
      if (url.includes("def456"))
        return okResponse({
          schema: { domain: "source:def456", title: "第二个", fields: [] },
          values: {},
        });
      return notFoundResponse();
    });
    const onChange = vi.fn();
    const { rerender } = renderHook(
      ({ sourceKey }: { sourceKey: string }) =>
        useSourceSettingsPanel(sourceKey, "回退名", { registry, fetchImpl, onChange }),
      { initialProps: { sourceKey: "abc123" } },
    );
    await waitFor(() => expect(registry.resolvePanel(sourceSettingsPanelId("abc123"))).toBeDefined());

    rerender({ sourceKey: "def456" });

    await waitFor(() => expect(registry.resolvePanel(sourceSettingsPanelId("def456"))).toBeDefined());
    expect(registry.resolvePanel(sourceSettingsPanelId("abc123"))).toBeUndefined();
    expect(registry.listPanels()).toHaveLength(1);
  });

  it("卸载(去激活)时回收面板", async () => {
    const registry = createSettingsRegistry();
    const fetchImpl = vi.fn(async () => okResponse({ schema: SCHEMA, values: {} }));
    const { unmount } = renderHook(() => useSourceSettingsPanel("abc123", "回退名", { registry, fetchImpl }));
    await waitFor(() => expect(registry.listPanels()).toHaveLength(1));
    unmount();
    expect(registry.listPanels()).toHaveLength(0);
  });

  it("sourceKey 为 undefined(未选中 source)时不探测、不登记", async () => {
    const registry = createSettingsRegistry();
    const fetchImpl = vi.fn(async () => okResponse({ schema: SCHEMA, values: {} }));
    renderHook(() => useSourceSettingsPanel(undefined, "回退名", { registry, fetchImpl }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(registry.listPanels()).toHaveLength(0);
  });

  it("无 settings 的 source(404)不登记,卸载也无残留", async () => {
    const registry = createSettingsRegistry();
    const fetchImpl = vi.fn(async () => notFoundResponse());
    const { unmount } = renderHook(() => useSourceSettingsPanel("no-settings", "回退名", { registry, fetchImpl }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(registry.listPanels()).toHaveLength(0);
    unmount();
    expect(registry.listPanels()).toHaveLength(0);
  });
});
