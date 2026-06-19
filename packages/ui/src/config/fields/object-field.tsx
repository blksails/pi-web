/**
 * ObjectField — 嵌套对象字段(kind:"object",如沙箱的 network / filesystem)。
 *
 * 按 descriptor.fields 递归渲染子字段(经 FieldRenderer,沿用宿主注册表覆盖)。
 * 子字段值路径 = [...path, subKey],与 zod issue 路径对齐;值缺省视为 {}。
 */
import * as React from "react";
import type { FieldProps } from "../field-registry.js";
import { FieldRenderer } from "../field-renderer.js";
import { Card } from "../../ui/card.js";
import { FieldShell } from "./field-shell.js";

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function ObjectField({
  descriptor,
  value,
  onChange,
  path,
  errors,
  disabled,
  registry,
}: FieldProps): React.JSX.Element {
  const obj = asObject(value);
  const variants = descriptor.variants;
  // oneOf 多态对象:按判别键选择变体,渲染该变体字段;切换判别即重置该对象。
  const subFields = (() => {
    if (variants === undefined) return descriptor.fields ?? [];
    const c = variants.cases.find((x) => x.value === obj[variants.discriminator]) ?? variants.cases[0];
    return c?.fields ?? [];
  })();

  return (
    <FieldShell descriptor={descriptor}>
      <Card className="flex flex-col gap-4 p-3" data-pi-object={descriptor.key}>
        {variants !== undefined ? (
          <select
            value={String(obj[variants.discriminator] ?? "")}
            disabled={disabled}
            data-pi-object-discriminator={descriptor.key}
            onChange={(e) => onChange({ [variants.discriminator]: e.target.value })}
            className="self-start rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
          >
            {variants.cases.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label ?? c.value}
              </option>
            ))}
          </select>
        ) : null}
        {subFields.map((sub) => (
          <FieldRenderer
            key={sub.key}
            descriptor={sub}
            value={obj[sub.key]}
            onChange={(next: unknown) => onChange({ ...obj, [sub.key]: next })}
            path={[...path, sub.key]}
            errors={errors}
            disabled={disabled}
            registry={registry}
          />
        ))}
      </Card>
    </FieldShell>
  );
}
