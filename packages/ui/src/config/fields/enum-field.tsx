/**
 * EnumField — 单选枚举字段(kind:"enum"),用 shadcn Select。
 */
import * as React from "react";
import type { FieldProps } from "../field-registry.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select.js";
import { FieldShell, errorAt } from "./field-shell.js";

export function EnumField({
  descriptor,
  value,
  onChange,
  path,
  errors,
  disabled,
}: FieldProps): React.JSX.Element {
  const id = React.useId();
  const error = errorAt(errors, path);
  const options = descriptor.enumOptions ?? [];
  const current = typeof value === "string" ? value : undefined;

  return (
    <FieldShell descriptor={descriptor} htmlFor={id} error={error}>
      <Select
        value={current}
        disabled={disabled ?? descriptor.readOnly}
        onValueChange={(v) => onChange(v)}
      >
        <SelectTrigger id={id} aria-invalid={error !== undefined}>
          <SelectValue placeholder={descriptor.placeholder ?? "请选择…"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label ?? opt.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}
