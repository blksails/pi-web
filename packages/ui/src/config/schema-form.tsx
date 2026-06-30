/**
 * SchemaForm — 由 FormSchema 渲染的受控配置表单。
 *
 * 受控:`values`(整域对象)/ `onChange(next)`(返回完整下一对象)/ `errors`(点路径→消息)。
 * 按 group/order 分区,逐字段经 <FieldRenderer> 渲染。不内嵌任何传输逻辑。
 * 顶层 record 特例(如 auth):单 record 字段 key===domain 时直接绑定根对象。
 */
import * as React from "react";
import type { FormSchema, FieldDescriptor } from "@blksails/pi-web-protocol";
import { FieldRenderer } from "./field-renderer.js";
import type { FieldRegistry } from "./field-registry.js";
import { cn } from "../lib/cn.js";

export interface SchemaFormProps {
  readonly formSchema: FormSchema;
  readonly values: Record<string, unknown>;
  readonly onChange: (next: Record<string, unknown>) => void;
  readonly errors?: Readonly<Record<string, string>>;
  readonly registry?: FieldRegistry;
  readonly disabled?: boolean;
  readonly className?: string;
  /** 文件名 → 服务端已解析 JSON Schema(透传给顶层 configFiles 控件)。 */
  readonly fileSchemas?: Record<string, unknown>;
}

function isRootRecord(formSchema: FormSchema): boolean {
  const f = formSchema.fields;
  return (
    f.length === 1 &&
    f[0]?.kind === "record" &&
    f[0]?.key === formSchema.domain
  );
}

export function SchemaForm({
  formSchema,
  values,
  onChange,
  errors = {},
  registry,
  disabled,
  className,
  fileSchemas,
}: SchemaFormProps): React.JSX.Element {
  // 顶层 record:整域即一个 record(auth)。
  if (isRootRecord(formSchema)) {
    const field = formSchema.fields[0] as FieldDescriptor;
    return (
      <div className={cn("flex flex-col gap-4", className)} data-pi-schema-form={formSchema.domain}>
        <FieldRenderer
          descriptor={field}
          value={values}
          onChange={(next: unknown) => onChange(next as Record<string, unknown>)}
          path={[]}
          errors={errors}
          registry={registry}
          disabled={disabled}
        />
      </div>
    );
  }

  const renderField = (field: FieldDescriptor): React.JSX.Element => (
    <FieldRenderer
      key={field.key}
      descriptor={field}
      value={values[field.key]}
      onChange={(next: unknown) => onChange({ ...values, [field.key]: next })}
      path={[field.key]}
      errors={errors}
      registry={registry}
      disabled={disabled}
      fileSchemas={fileSchemas}
    />
  );

  const groups = formSchema.groups ?? [];
  const ungrouped = formSchema.fields.filter(
    (f) => f.group === undefined || !groups.some((g) => g.id === f.group),
  );

  return (
    <div className={cn("flex flex-col gap-6", className)} data-pi-schema-form={formSchema.domain}>
      {[...groups]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((group) => {
          const fields = formSchema.fields.filter((f) => f.group === group.id);
          if (fields.length === 0) return null;
          return (
            <fieldset key={group.id} className="flex flex-col gap-4">
              <legend className="text-sm font-semibold text-[hsl(var(--foreground))]">
                {group.title}
              </legend>
              {fields.map(renderField)}
            </fieldset>
          );
        })}
      {ungrouped.length > 0 ? (
        <div className="flex flex-col gap-4">{ungrouped.map(renderField)}</div>
      ) : null}
    </div>
  );
}
