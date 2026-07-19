/**
 * ObjectListField — 对象数组控件(kind:"objectList")。
 *
 * value 为对象数组。每项一张卡片:
 *  - 有 `variants`(oneOf 多态):顶部判别键(如 type)选择器 + 所选变体的字段;切换判别即重置该项。
 *  - 否则按 `itemFields` 渲染。
 * 子字段经 `FieldRenderer` 递归(支持嵌套 objectList,如 switchRules)。支持增/删项。
 */
import * as React from "react";
import type { FieldDescriptor } from "@blksails/pi-web-protocol";
import type { FieldProps } from "../field-registry.js";
import { FieldRenderer } from "../field-renderer.js";
import { Card } from "../../ui/card.js";
import { Button } from "../../ui/button.js";
import { FieldShell } from "./field-shell.js";
import { useI18n } from "../../i18n/index.js";

function asItem(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function ObjectListField({
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
  const list = Array.isArray(value) ? value : [];
  const variants = descriptor.variants;
  const itemFields = descriptor.itemFields ?? [];

  const setItem = (i: number, next: Record<string, unknown>): void => {
    const copy = list.slice();
    copy[i] = next;
    onChange(copy);
  };
  const removeItem = (i: number): void => onChange(list.filter((_, idx) => idx !== i));
  const addItem = (): void => {
    if (variants !== undefined && variants.cases.length > 0) {
      onChange([...list, { [variants.discriminator]: variants.cases[0]!.value }]);
    } else {
      onChange([...list, {}]);
    }
  };

  const fieldsForItem = (item: Record<string, unknown>): readonly FieldDescriptor[] => {
    if (variants === undefined) return itemFields;
    const disc = item[variants.discriminator];
    const c = variants.cases.find((x) => x.value === disc) ?? variants.cases[0];
    return c?.fields ?? [];
  };

  return (
    <FieldShell descriptor={descriptor}>
      <div className="flex flex-col gap-3">
        {list.length === 0 ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{t("config.objectList.empty")}</p>
        ) : null}
        {list.map((raw, i) => {
          const item = asItem(raw);
          const discValue = variants !== undefined ? String(item[variants.discriminator] ?? "") : "";
          return (
            <Card key={i} className="flex flex-col gap-3 p-3" data-pi-objlist-item={i}>
              <div className="flex items-center justify-between gap-2">
                {variants !== undefined ? (
                  <select
                    value={discValue}
                    disabled={disabled}
                    data-pi-objlist-discriminator={i}
                    onChange={(e) => setItem(i, { [variants.discriminator]: e.target.value })}
                    className="rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
                  >
                    {variants.cases.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label ?? c.value}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-sm font-medium text-[hsl(var(--muted-foreground))]">#{i + 1}</span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => removeItem(i)}
                >
                  {t("common.delete")}
                </Button>
              </div>
              {fieldsForItem(item).map((sub) => (
                <FieldRenderer
                  key={sub.key}
                  descriptor={sub}
                  value={item[sub.key]}
                  onChange={(next: unknown) => setItem(i, { ...item, [sub.key]: next })}
                  path={[...path, String(i), sub.key]}
                  errors={errors}
                  disabled={disabled}
                  registry={registry}
                  sourceKey={sourceKey}
                />
              ))}
            </Card>
          );
        })}
        <div>
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={addItem}>
            {t("config.objectList.addItem")}
          </Button>
        </div>
      </div>
    </FieldShell>
  );
}
