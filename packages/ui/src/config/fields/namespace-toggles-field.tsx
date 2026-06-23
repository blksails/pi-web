/**
 * NamespaceTogglesField — 命名空间开关字段（widget: "logNamespaceToggles"）。
 *
 * 将 Record<string, boolean> 渲染为逐项开关列表，支持：
 *  - 逐条开关切换（onChange 回写 Record<string, boolean>）
 *  - 删除已有条目
 *  - 添加新命名空间条目
 *
 * Requirements: 6.7 (按命名空间开关)
 */
import * as React from "react";
import type { FieldProps } from "../field-registry.js";
import { Input } from "../../ui/input.js";
import { Button } from "../../ui/button.js";
import { FieldShell } from "./field-shell.js";

function asNamespaceRecord(value: unknown): Record<string, boolean> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = v !== false;
  }
  return out;
}

export function NamespaceTogglesField({
  descriptor,
  value,
  onChange,
  disabled,
}: FieldProps): React.JSX.Element {
  const record = asNamespaceRecord(value);
  const entries = Object.entries(record);
  const [newNs, setNewNs] = React.useState("");

  const toggle = (ns: string, checked: boolean): void => {
    onChange({ ...record, [ns]: checked });
  };

  const remove = (ns: string): void => {
    const next = { ...record };
    delete next[ns];
    onChange(next);
  };

  const addNs = (): void => {
    const ns = newNs.trim();
    if (ns.length === 0 || ns in record) return;
    onChange({ ...record, [ns]: true });
    setNewNs("");
  };

  return (
    <FieldShell descriptor={descriptor}>
      <div className="flex flex-col gap-2" data-pi-ns-toggles>
        {entries.length === 0 ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">暂无命名空间（全部默认）</p>
        ) : null}
        {entries.map(([ns, enabled]) => (
          <div
            key={ns}
            className="flex items-center gap-2"
            data-pi-ns-row={ns}
          >
            <label className="flex flex-1 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                disabled={disabled}
                data-pi-ns-toggle={ns}
                onChange={(e) => toggle(ns, e.target.checked)}
                className="h-4 w-4 rounded border-[hsl(var(--input))]"
              />
              <span className="font-mono">{ns}</span>
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => remove(ns)}
            >
              删
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <Input
            type="text"
            value={newNs}
            placeholder="添加命名空间（如 agent:tool）"
            disabled={disabled}
            onChange={(e) => setNewNs(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addNs();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={addNs}
          >
            添加
          </Button>
        </div>
      </div>
    </FieldShell>
  );
}
