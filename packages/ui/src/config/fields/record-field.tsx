/**
 * RecordField — 动态键值字段(kind:"record",如 auth 的 provider → 凭证)。
 *
 * 每个条目:键名(provider)+ 按 descriptor.fields 渲染的子字段(经 FieldRenderer 递归);
 * 支持增/删条目。条目子字段路径 = [...path, entryKey, subKey],与 zod issue 路径对齐。
 */
import * as React from "react";
import type { FieldProps } from "../field-registry.js";
import { FieldRenderer } from "../field-renderer.js";
import { Card } from "../../ui/card.js";
import { Button } from "../../ui/button.js";
import { Input } from "../../ui/input.js";
import { FieldShell } from "./field-shell.js";

function asRecord(value: unknown): Record<string, Record<string, unknown>> {
  if (typeof value !== "object" || value === null) return {};
  return value as Record<string, Record<string, unknown>>;
}

export function RecordField({
  descriptor,
  value,
  onChange,
  path,
  errors,
  disabled,
}: FieldProps): React.JSX.Element {
  const record = asRecord(value);
  const entries = Object.entries(record);
  const subFields = descriptor.fields ?? [];
  const [newKey, setNewKey] = React.useState("");

  const setEntry = (key: string, next: Record<string, unknown>): void => {
    onChange({ ...record, [key]: next });
  };
  const removeEntry = (key: string): void => {
    const copy = { ...record };
    delete copy[key];
    onChange(copy);
  };
  const addEntry = (): void => {
    const key = newKey.trim();
    if (key.length === 0 || key in record) return;
    onChange({ ...record, [key]: {} });
    setNewKey("");
  };

  return (
    <FieldShell descriptor={descriptor}>
      <div className="flex flex-col gap-3">
        {entries.length === 0 ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">暂无条目</p>
        ) : null}

        {entries.map(([entryKey, entryValue]) => (
          <Card key={entryKey} className="flex flex-col gap-3 p-3" data-pi-record-entry={entryKey}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{entryKey}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => removeEntry(entryKey)}
              >
                删除
              </Button>
            </div>
            {subFields.map((sub) => (
              <FieldRenderer
                key={sub.key}
                descriptor={sub}
                value={(entryValue as Record<string, unknown>)?.[sub.key]}
                onChange={(next: unknown) =>
                  setEntry(entryKey, { ...entryValue, [sub.key]: next })
                }
                path={[...path, entryKey, sub.key]}
                errors={errors}
                disabled={disabled}
              />
            ))}
          </Card>
        ))}

        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={newKey}
            placeholder="新增条目键(如 anthropic)"
            disabled={disabled}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addEntry();
              }
            }}
          />
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={addEntry}>
            添加
          </Button>
        </div>
      </div>
    </FieldShell>
  );
}
