/**
 * apply-settings-widgets × <SettingsShell> — 面⑦动态控件端到端咬合(spec
 * source-settings-and-slots,任务 7.1;Requirements 5.3, 5.4, 5.5)。
 *
 * 全链:webext `settingsWidgets` capability 提供的窄接口组件 → `applySettingsWidgets`
 * 并入 per-source scoped field registry → `SettingsPanelDescriptor.sourceKey` 经真实
 * `<SettingsShell>`/`<SchemaForm>` 透给 `<FieldRenderer>` → schema 字段 `widget:"entity-picker"`
 * 命中该 renderer 渲染(而非 kind 默认 <input>)→ widget 内部经真实 URL 形状
 * `GET {baseUrl}/sessions/{sessionId}/agent-routes/{name}` 取数据渲染选项(数据侧,
 * fetch 打桩到与生产同形的响应体,真实网络/子进程由 `e2e/node/module-settings-agent.e2e.test.ts`
 * 覆盖)。对照组:webext 未装载(未调用 applySettingsWidgets)时同字段降级只读 JSON。
 */
import * as React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { FormSchema } from "@blksails/pi-web-protocol";
import { createSettingsRegistry, type SettingsPanelDescriptor } from "@blksails/pi-web-react";
import type { WebExtension, SettingsWidgetProps } from "@blksails/pi-web-kit";
import { SettingsShell } from "../../src/config/settings-shell.js";
import { defaultSourceFieldRegistry } from "../../src/config/field-registry.js";
import { applySettingsWidgets } from "../../src/config/apply-settings-widgets.js";

const SOURCE_KEY = "src-entity-picker-fixture";
const BASE_URL = "/api";
const SESSION_ID = "sess-abc123";

const FORM_SCHEMA: FormSchema = {
  domain: `source:${SOURCE_KEY}`,
  title: "Module Settings 示例",
  fields: [
    {
      key: "defaultEntity",
      kind: "string",
      label: "默认实体",
      widget: "entity-picker",
      required: false,
    },
  ],
};

/**
 * 镜像 examples/module-settings-agent/.pi/web/web.config.tsx 的 EntityPickerWidget 行为。
 * `SettingsWidgetComponent`(即 `WebExtension.settingsWidgets` 的值类型)固定 `V=unknown`
 * (宿主对 value 的具体类型领域中立);组件内部按字段自身约定的形状(此处 string)窄化。
 */
function EntityPickerWidget({
  value,
  onChange,
  baseUrl,
  sessionId,
}: SettingsWidgetProps): React.JSX.Element {
  const [options, setOptions] = React.useState<
    ReadonlyArray<{ value: string; label: string }> | undefined
  >(undefined);

  React.useEffect(() => {
    if (baseUrl === undefined || sessionId === undefined) return;
    void fetch(`${baseUrl}/sessions/${sessionId}/agent-routes/entities`)
      .then((r) => r.json())
      // 真实端点回吐 route handler 原始返回值(不裹 `{result:…}`),见
      // agent-route-routes.ts 的 `rawJsonResponse(frame.result)`。
      .then((body: { entities?: Array<{ value: string; label: string }> }) =>
        setOptions(body.entities ?? []),
      );
  }, [baseUrl, sessionId]);

  if (baseUrl === undefined || sessionId === undefined) {
    return <span data-testid="entity-picker-unavailable">unavailable</span>;
  }
  const current = typeof value === "string" ? value : "";
  return (
    <select data-testid="entity-picker" value={current} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {(options ?? []).map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
function makeExt(): WebExtension {
  return {
    manifestId: "module-settings-agent",
    capabilities: ["settingsWidgets"],
    settingsWidgets: { "entity-picker": EntityPickerWidget },
  };
}

function makePanel(over: Partial<SettingsPanelDescriptor> = {}): SettingsPanelDescriptor {
  return {
    id: `source-settings:${SOURCE_KEY}`,
    title: "Module Settings 示例",
    formSchema: FORM_SCHEMA,
    sourceKey: SOURCE_KEY,
    load: async () => ({ defaultEntity: "" }),
    save: async () => undefined,
    ...over,
  };
}

afterEach(() => {
  defaultSourceFieldRegistry.reset();
  vi.unstubAllGlobals();
});

describe("面⑦动态控件端到端 — applySettingsWidgets × SettingsShell", () => {
  it("webext 已装载:widget 声明命中 scoped renderer,渲染动态控件并经 agent-declared-route 取数据", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe(`${BASE_URL}/sessions/${SESSION_ID}/agent-routes/entities`);
        return {
          ok: true,
          json: async () => ({
            entities: [
              { value: "customer", label: "客户" },
              { value: "order", label: "订单" },
            ],
          }),
        } as Response;
      }),
    );

    const dispose = applySettingsWidgets(SOURCE_KEY, makeExt(), {
      baseUrl: BASE_URL,
      sessionId: SESSION_ID,
    });

    const registry = createSettingsRegistry();
    registry.registerPanel(makePanel());
    render(<SettingsShell registry={registry} />);

    await waitFor(() => expect(screen.queryByText("加载中…")).not.toBeInTheDocument());

    const select = await screen.findByTestId("entity-picker");
    expect(select).toBeInTheDocument();
    // 未走 kind 默认 <input type=text>(FieldRenderer 三级解析命中 widget,不回退默认控件)。
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("客户")).toBeInTheDocument());
    expect(screen.getByText("订单")).toBeInTheDocument();

    dispose();
  });

  it("对照组:webext 未装载(未调用 applySettingsWidgets)→ 同字段降级只读 JSON,面板不失败", async () => {
    const registry = createSettingsRegistry();
    registry.registerPanel(makePanel({ load: async () => ({ defaultEntity: "seed-value" }) }));
    render(<SettingsShell registry={registry} />);

    await waitFor(() => expect(screen.queryByText("加载中…")).not.toBeInTheDocument());

    expect(screen.queryByTestId("entity-picker")).not.toBeInTheDocument();
    // FallbackField 只读 JSON 展示原值。
    expect(screen.getByText(/"seed-value"/)).toBeInTheDocument();
  });

  it("回收(dispose)后回落降级只读 JSON,不留孤儿 renderer", async () => {
    const dispose = applySettingsWidgets(SOURCE_KEY, makeExt(), {
      baseUrl: BASE_URL,
      sessionId: SESSION_ID,
    });
    dispose();

    const registry = createSettingsRegistry();
    registry.registerPanel(makePanel());
    render(<SettingsShell registry={registry} />);

    await waitFor(() => expect(screen.queryByText("加载中…")).not.toBeInTheDocument());
    expect(screen.queryByTestId("entity-picker")).not.toBeInTheDocument();
  });
});
