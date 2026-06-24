/**
 * BooleanField — 开关字段(kind:"boolean")。
 */
import * as React from "react";
import type { FieldProps } from "../field-registry.js";
import { FieldShell, errorAt } from "./field-shell.js";

export function BooleanField({
  descriptor,
  value,
  onChange,
  path,
  errors,
  disabled,
}: FieldProps): React.JSX.Element {
  const id = React.useId();
  const error = errorAt(errors, path);
  // value=undefined 时回显 descriptor.default（如有），否则视为 false
  const effective = value === undefined ? descriptor.default : value;
  const checked = effective === true;
  return (
    <FieldShell descriptor={descriptor} htmlFor={id} error={error}>
      <label className="flex items-center gap-2 text-sm">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled ?? descriptor.readOnly}
          aria-invalid={error !== undefined}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-[hsl(var(--input))]"
        />
        <span className="text-[hsl(var(--muted-foreground))]">
          {checked ? "已启用" : "已关闭"}
        </span>
      </label>
    </FieldShell>
  );
}
