/**
 * NumberField — 数字字段(kind:"number")。
 *
 * value 为 null/undefined 时显示空输入框，不显示字面 "null"。
 */
import * as React from "react";
import type { FieldProps } from "../field-registry.js";
import { Input } from "../../ui/input.js";
import { FieldShell, errorAt } from "./field-shell.js";

export function NumberField({
  descriptor,
  value,
  onChange,
  path,
  errors,
  disabled,
}: FieldProps): React.JSX.Element {
  const id = React.useId();
  const error = errorAt(errors, path);

  // null/undefined → 空字符串；有效数字 → 字符串表示
  const displayValue =
    typeof value === "number" && !Number.isNaN(value)
      ? String(value)
      : "";

  return (
    <FieldShell descriptor={descriptor} htmlFor={id} error={error}>
      <Input
        id={id}
        type="number"
        value={displayValue}
        placeholder={descriptor.placeholder}
        min={descriptor.min}
        max={descriptor.max}
        step={descriptor.step}
        disabled={disabled ?? descriptor.readOnly}
        aria-invalid={error !== undefined}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(undefined);
          } else {
            const n = Number(raw);
            onChange(Number.isNaN(n) ? undefined : n);
          }
        }}
      />
    </FieldShell>
  );
}
