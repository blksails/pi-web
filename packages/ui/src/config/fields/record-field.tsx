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
import { useI18n } from "../../i18n/index.js";

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
  registry,
  sourceKey,
}: FieldProps): React.JSX.Element {
  const t = useI18n();
  const record = asRecord(value);
  // 已删除条目以 null 标记保留在值中(显式删除意图),不渲染。
  const entries = Object.entries(record).filter(([, v]) => v !== null);
  const subFields = descriptor.fields ?? [];
  // 标量值 record(如 Record<string,string>):无对象子字段,值本身是标量(itemKind)。
  const scalarKind = subFields.length === 0 ? descriptor.itemKind : undefined;
  const [newKey, setNewKey] = React.useState("");

  const setEntry = (key: string, next: unknown): void => {
    onChange({ ...record, [key]: next });
  };
  const removeEntry = (key: string): void => {
    // 置 null 而非删除键:表单代表完整期望态,null 让服务端按删除标记移除该条目
    // (omit 会被合并语义当作"保留")。
    onChange({ ...record, [key]: null });
  };
  const addEntry = (): void => {
    const key = newKey.trim();
    if (key.length === 0 || key in record) return;
    const initial: unknown =
      scalarKind === "boolean" ? false : scalarKind === "number" ? 0 : scalarKind !== undefined ? "" : {};
    onChange({ ...record, [key]: initial });
    setNewKey("");
  };

  return (
    <FieldShell descriptor={descriptor}>
      <div className="flex flex-col gap-3">
        {entries.length === 0 ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{t("config.record.empty")}</p>
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
                {t("common.remove")}
              </Button>
            </div>
            {scalarKind !== undefined ? (
              <FieldRenderer
                descriptor={{ key: entryKey, kind: scalarKind, label: t("config.record.valueLabel"), required: false }}
                value={entryValue}
                onChange={(next: unknown) => setEntry(entryKey, next)}
                path={[...path, entryKey]}
                errors={errors}
                disabled={disabled}
                registry={registry}
                sourceKey={sourceKey}
              />
            ) : (
              subFields.map((sub) => (
                <FieldRenderer
                  key={sub.key}
                  descriptor={sub}
                  value={(entryValue as Record<string, unknown>)?.[sub.key]}
                  onChange={(next: unknown) =>
                    setEntry(entryKey, { ...(entryValue as Record<string, unknown>), [sub.key]: next })
                  }
                  path={[...path, entryKey, sub.key]}
                  errors={errors}
                  disabled={disabled}
                  registry={registry}
                  sourceKey={sourceKey}
                />
              ))
            )}
          </Card>
        ))}

        <div className="flex items-center gap-2">
          <Input
            type="text"
            value={newKey}
            placeholder={t("config.record.newKeyPlaceholder")}
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
            {t("common.add")}
          </Button>
        </div>
      </div>
    </FieldShell>
  );
}
