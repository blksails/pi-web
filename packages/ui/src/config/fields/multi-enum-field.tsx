/**
 * MultiEnumField — 多选枚举字段(kind:"multiEnum")。
 *
 * `providers` 域的 input/output 类型声明(multi-gateway-providers 任务 5.1/5.4,Req 7.7)
 * 是这套渲染栈里第一个也是唯一一个用到 `kind:"multiEnum"` 的字段——`FieldRenderer` 的
 * 内置默认表(`DEFAULTS`)此前没有登记它,未命中会降级到 `FallbackField`(只读 JSON),
 * 使这两个字段在界面上不可编辑,只能看见一坨 `["text","image"]` 式的原始文本。
 *
 * 渲染为一组勾选框(`descriptor.enumOptions` 固定选项集,不同于 `objectList`/
 * `namespaceToggles` 那种可增删的动态键集合),值为选中项组成的字符串数组。
 */
import * as React from "react";
import type { FieldProps } from "../field-registry.js";
import { FieldShell, errorAt } from "./field-shell.js";

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function MultiEnumField({
  descriptor,
  value,
  onChange,
  path,
  errors,
  disabled,
}: FieldProps): React.JSX.Element {
  const error = errorAt(errors, path);
  const selected = asStringArray(value);
  const options = descriptor.enumOptions ?? [];

  const toggle = (optValue: string, checked: boolean): void => {
    const next = checked
      ? selected.includes(optValue)
        ? selected
        : [...selected, optValue]
      : selected.filter((v) => v !== optValue);
    onChange(next);
  };

  return (
    <FieldShell descriptor={descriptor} error={error}>
      <div className="flex flex-wrap gap-3" data-pi-multienum={descriptor.key}>
        {options.map((opt) => (
          <label key={opt.value} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(opt.value)}
              disabled={disabled ?? descriptor.readOnly}
              aria-invalid={error !== undefined}
              data-pi-multienum-option={`${descriptor.key}:${opt.value}`}
              onChange={(e) => toggle(opt.value, e.target.checked)}
              className="h-4 w-4 rounded border-[hsl(var(--input))]"
            />
            <span>{opt.label ?? opt.value}</span>
          </label>
        ))}
      </div>
    </FieldShell>
  );
}
