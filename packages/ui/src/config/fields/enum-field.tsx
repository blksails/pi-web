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
import { useI18n } from "../../i18n/index.js";

export function EnumField({
  descriptor,
  value,
  onChange,
  path,
  errors,
  disabled,
}: FieldProps): React.JSX.Element {
  const t = useI18n();
  const id = React.useId();
  const error = errorAt(errors, path);
  const options = descriptor.enumOptions ?? [];
  // value=undefined 时回显 descriptor.default（如有且为字符串）
  const effective = value === undefined ? descriptor.default : value;
  const current = typeof effective === "string" ? effective : undefined;

  return (
    <FieldShell descriptor={descriptor} htmlFor={id} error={error}>
      <Select
        value={current}
        disabled={disabled ?? descriptor.readOnly}
        onValueChange={(v) => onChange(v)}
      >
        <SelectTrigger id={id} aria-invalid={error !== undefined}>
          <SelectValue placeholder={descriptor.placeholder ?? t("common.selectPlaceholder")} />
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
