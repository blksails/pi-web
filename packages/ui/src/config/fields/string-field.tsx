/**
 * StringField — 单行文本字段(kind:"string")。
 */
import * as React from "react";
import type { FieldProps } from "../field-registry.js";
import { Input } from "../../ui/input.js";
import { FieldShell, errorAt } from "./field-shell.js";

export function StringField({
  descriptor,
  value,
  onChange,
  path,
  errors,
  disabled,
}: FieldProps): React.JSX.Element {
  const id = React.useId();
  const error = errorAt(errors, path);
  return (
    <FieldShell descriptor={descriptor} htmlFor={id} error={error}>
      <Input
        id={id}
        type="text"
        value={typeof value === "string" ? value : ""}
        placeholder={descriptor.placeholder}
        disabled={disabled ?? descriptor.readOnly}
        aria-invalid={error !== undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  );
}
