/**
 * builtin-components — server-driven UI 的内置白名单组件库(信任模型路径 1)。
 *
 * agent 以 `kind:"builtin"` + component 名 + JSON props 声明,这里提供一组通用可视化:
 *   - metric    指标卡(label / value / delta / tone)
 *   - keyValue  键值表(rows)
 *   - table     数据表(columns / rows / caption)
 *   - alert     告示条(tone / title / message)
 *   - progress  进度条(value / max / label)
 *
 * 每个组件对 JSON props 做**容错提取**(类型不符即忽略该字段),不信任 agent 输入形状。
 * 经 `registerBuiltinUiComponents` 注入注册表;宿主可再注册自有组件覆盖/扩展。
 */
import * as React from "react";
import type { UiTone } from "@pi-web/protocol";
import { Card } from "../ui/card.js";
import { cn } from "../lib/cn.js";
import { toneSoft, toneText } from "./ui-tokens.js";
import type {
  UiComponent,
  UiComponentRegistry,
} from "./ui-component-registry.js";

// ── 容错提取助手(不信任 props 形状) ───────────────────────────────
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
const TONES: ReadonlySet<string> = new Set([
  "default",
  "muted",
  "primary",
  "success",
  "warning",
  "danger",
  "info",
]);
function tone(v: unknown): UiTone | undefined {
  return typeof v === "string" && TONES.has(v) ? (v as UiTone) : undefined;
}
/** 把 unknown 转可显示文本(用于表格单元格等)。 */
function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

// ── metric:指标卡 ─────────────────────────────────────────────────
const Metric: UiComponent = ({ props }) => {
  const label = str(props.label);
  const value = str(props.value) ?? num(props.value)?.toString() ?? "—";
  const delta = str(props.delta) ?? num(props.delta)?.toString();
  const t = tone(props.tone);
  return (
    <Card className="p-4" data-pi-ui-builtin="metric">
      {label !== undefined ? (
        <div className="text-xs text-[hsl(var(--muted-foreground))]">
          {label}
        </div>
      ) : null}
      <div className="mt-1 text-2xl font-semibold text-[hsl(var(--foreground))]">
        {value}
      </div>
      {delta !== undefined ? (
        <div className={cn("mt-1 text-xs", toneText(t ?? "muted"))}>{delta}</div>
      ) : null}
    </Card>
  );
};

// ── keyValue:键值表 ───────────────────────────────────────────────
const KeyValue: UiComponent = ({ props }) => {
  const raw = Array.isArray(props.rows) ? props.rows : [];
  const rows = raw
    .map((r) =>
      r !== null && typeof r === "object"
        ? {
            key: cell((r as Record<string, unknown>).key),
            value: cell((r as Record<string, unknown>).value),
          }
        : undefined,
    )
    .filter((r): r is { key: string; value: string } => r !== undefined);
  return (
    <Card className="p-4" data-pi-ui-builtin="keyValue">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map((row, i) => (
          <React.Fragment key={i}>
            <dt className="font-medium text-[hsl(var(--muted-foreground))]">
              {row.key}
            </dt>
            <dd className="text-[hsl(var(--foreground))]">{row.value}</dd>
          </React.Fragment>
        ))}
      </dl>
    </Card>
  );
};

// ── table:数据表 ──────────────────────────────────────────────────
const Table: UiComponent = ({ props }) => {
  const columns = (Array.isArray(props.columns) ? props.columns : []).map(cell);
  const rows = (Array.isArray(props.rows) ? props.rows : []).map((r) =>
    Array.isArray(r) ? r.map(cell) : [],
  );
  const caption = str(props.caption);
  return (
    <Card className="overflow-x-auto p-4" data-pi-ui-builtin="table">
      <table className="w-full border-collapse text-sm">
        {caption !== undefined ? (
          <caption className="mb-1 text-left text-xs text-[hsl(var(--muted-foreground))]">
            {caption}
          </caption>
        ) : null}
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th
                key={i}
                className="border-b border-[hsl(var(--border))] px-2 py-1 text-left font-medium text-[hsl(var(--muted-foreground))]"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((c, ci) => (
                <td
                  key={ci}
                  className="border-b border-[hsl(var(--border))] px-2 py-1 text-[hsl(var(--foreground))]"
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
};

// ── alert:告示条 ──────────────────────────────────────────────────
const Alert: UiComponent = ({ props }) => {
  const t = tone(props.tone) ?? "info";
  const title = str(props.title);
  const message = str(props.message);
  return (
    <div
      className={cn("rounded-[var(--radius)] px-3 py-2 text-sm", toneSoft(t))}
      role="status"
      data-pi-ui-builtin="alert"
    >
      {title !== undefined ? (
        <div className="font-medium">{title}</div>
      ) : null}
      {message !== undefined ? <div>{message}</div> : null}
    </div>
  );
};

// ── progress:进度条 ───────────────────────────────────────────────
const Progress: UiComponent = ({ props }) => {
  const value = num(props.value) ?? 0;
  const max = num(props.max) ?? 100;
  const label = str(props.label);
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div data-pi-ui-builtin="progress">
      {label !== undefined ? (
        <div className="mb-1 flex justify-between text-xs text-[hsl(var(--muted-foreground))]">
          <span>{label}</span>
          <span>{Math.round(pct)}%</span>
        </div>
      ) : null}
      <div className="h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]">
        <div
          className="h-full rounded-full bg-[hsl(var(--primary))]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

// ── card:通用卡片(标题 + 正文 + 可选脚注) ───────────────────────
const CardComponent: UiComponent = ({ props }) => {
  const title = str(props.title);
  const body = str(props.body);
  const footer = str(props.footer);
  return (
    <Card className="space-y-1 p-4" data-pi-ui-builtin="card">
      {title !== undefined ? (
        <div className="text-sm font-semibold text-[hsl(var(--foreground))]">{title}</div>
      ) : null}
      {body !== undefined ? (
        <div className="text-sm text-[hsl(var(--foreground))]">{body}</div>
      ) : null}
      {footer !== undefined ? (
        <div className="text-xs text-[hsl(var(--muted-foreground))]">{footer}</div>
      ) : null}
    </Card>
  );
};

// ── codeBlock:代码块 ──────────────────────────────────────────────
const CodeBlock: UiComponent = ({ props }) => {
  const code = str(props.code) ?? "";
  const lang = str(props.lang);
  return (
    <pre
      className="overflow-x-auto rounded-[var(--radius)] bg-[hsl(var(--muted))] p-3 text-xs text-[hsl(var(--foreground))]"
      data-pi-ui-builtin="codeBlock"
      data-lang={lang}
    >
      <code>{code}</code>
    </pre>
  );
};

/** 内置组件清单(名 → 组件)。用 satisfies 保留具体键类型,便于按名直接取用。 */
export const builtinUiComponents = {
  metric: Metric,
  keyValue: KeyValue,
  table: Table,
  alert: Alert,
  progress: Progress,
  card: CardComponent,
  codeBlock: CodeBlock,
} satisfies Record<string, UiComponent>;

/** 把内置组件注入给定注册表(幂等,覆盖语义)。 */
export function registerBuiltinUiComponents(
  registry: UiComponentRegistry,
): void {
  for (const [name, component] of Object.entries(builtinUiComponents)) {
    registry.registerUiComponent(name, component);
  }
}
