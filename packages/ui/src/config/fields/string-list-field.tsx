/**
 * StringListField — 字符串列表字段(kind:"stringList",如沙箱的路径/域名清单)。
 *
 * 每行一个可编辑字符串,支持增/删。值为 string[];空列表渲染为"暂无条目"。
 * 行级错误按点路径 [...path, index] 取(与 zod array issue 路径对齐)。
 */
import * as React from "react";
import type { FieldProps } from "../field-registry.js";
import { Input } from "../../ui/input.js";
import { Button } from "../../ui/button.js";
import { FieldShell, errorAt } from "./field-shell.js";

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v : String(v))) : [];
}

export function StringListField({
  descriptor,
  value,
  onChange,
  path,
  errors,
  disabled,
}: FieldProps): React.JSX.Element {
  const list = asList(value);
  const error = errorAt(errors, path);

  const update = (next: string[]): void => onChange(next);
  const setAt = (i: number, v: string): void => {
    const next = list.slice();
    next[i] = v;
    update(next);
  };
  const removeAt = (i: number): void => update(list.filter((_, idx) => idx !== i));
  const add = (): void => update([...list, ""]);

  return (
    <FieldShell descriptor={descriptor} error={error}>
      <div className="flex flex-col gap-2">
        {list.length === 0 ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">暂无条目</p>
        ) : null}
        {list.map((item, i) => (
          <div key={i} className="flex items-center gap-2" data-pi-list-row={i}>
            <Input
              type="text"
              value={item}
              placeholder={descriptor.placeholder}
              disabled={disabled ?? descriptor.readOnly}
              aria-invalid={errorAt(errors, [...path, String(i)]) !== undefined}
              onChange={(e) => setAt(i, e.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => removeAt(i)}
            >
              删除
            </Button>
          </div>
        ))}
        <div>
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={add}>
            添加
          </Button>
        </div>
      </div>
    </FieldShell>
  );
}
