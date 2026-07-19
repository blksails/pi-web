/**
 * module-settings-agent UI 扩展 — 面⑦ 动态控件供给方 fixture(spec:
 * source-settings-and-slots,任务 7.1;`settingsWidgets` capability;Req 5.4, 5.5)。
 *
 * 唯一贡献是 `defaultEntity` 字段(`settings/schema.json` 声明 `widget:"entity-picker"`)的
 * 动态控件:`EntityPickerWidget` 挂载时经 `GET {baseUrl}/sessions/{sessionId}/agent-routes/entities`
 * (本模块自己的 agent-declared-route,`routes/entities.ts`)取候选实体列表并渲染下拉选择,
 * 演示面⑤(第三方/本模块 webext 动态控件)与面⑥⑦(声明式 routes + per-source settings)
 * 三面互为供给、无需任何第三方源。
 *
 * `baseUrl`/`sessionId` 缺省(如设置面板尚未绑定活跃会话)时降级为禁用态提示,不崩溃、
 * 不发起请求(Req 5.5 同族的「数据不可用」降级,与「webext 未装」降级并列但不同因)。
 */
import * as React from "react";
import { defineWebExtension } from "@blksails/pi-web-kit";
import type { SettingsWidgetProps } from "@blksails/pi-web-kit";

interface EntityOption {
  readonly value: string;
  readonly label: string;
}

function EntityPickerWidget({
  value,
  onChange,
  disabled,
  baseUrl,
  sessionId,
}: SettingsWidgetProps): React.JSX.Element {
  const [options, setOptions] = React.useState<readonly EntityOption[] | undefined>(undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    if (baseUrl === undefined || sessionId === undefined) return;
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const res = await fetch(`${baseUrl}/sessions/${sessionId}/agent-routes/entities`);
        if (!res.ok) throw new Error(`entities route failed (${res.status})`);
        // GET /sessions/:id/agent-routes/:name 回吐 route handler 的原始返回值
        // (`rawJsonResponse(frame.result)`,不裹 `{result:…}` 信封)——
        // `entitiesHandler()` 返回 `{ entities }`,故直接取顶层 `entities`。
        const body = (await res.json()) as { entities?: EntityOption[] };
        if (!cancelled) setOptions(body.entities ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, sessionId]);

  if (baseUrl === undefined || sessionId === undefined) {
    return (
      <span data-testid="entity-picker-unavailable" className="text-xs opacity-70">
        entity picker unavailable(no active session)
      </span>
    );
  }
  if (error !== undefined) {
    return (
      <span role="alert" data-testid="entity-picker-error">
        {error}
      </span>
    );
  }

  const current = typeof value === "string" ? value : "";
  return (
    <select
      data-testid="entity-picker"
      value={current}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">—</option>
      {(options ?? []).map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export default defineWebExtension({
  manifestId: "module-settings-agent",
  capabilities: ["settingsWidgets"],
  settingsWidgets: {
    "entity-picker": EntityPickerWidget,
  },
});
