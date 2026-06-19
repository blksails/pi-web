/**
 * FieldRenderer — 字段分派器。
 *
 * 解析顺序:注册表覆盖(按 fieldKey/widget)→ 注册表 kind 覆盖 → 内置默认控件。
 * 未知 kind 安全降级为只读 JSON 文本,不崩溃。复用既有 PartRenderer 的分派语义。
 */
import * as React from "react";
import type { FieldProps, FieldRegistry } from "./field-registry.js";
import { defaultFieldRegistry } from "./field-registry.js";
import { StringField } from "./fields/string-field.js";
import { SecretField } from "./fields/secret-field.js";
import { EnumField } from "./fields/enum-field.js";
import { RecordField } from "./fields/record-field.js";
import { BooleanField } from "./fields/boolean-field.js";
import { StringListField } from "./fields/string-list-field.js";
import { ObjectField } from "./fields/object-field.js";
import { ObjectListField } from "./fields/object-list-field.js";
import { FieldShell } from "./fields/field-shell.js";

export interface FieldRendererProps extends FieldProps {
  /** 可注入隔离注册表(默认用模块级单例)。 */
  readonly registry?: FieldRegistry;
}

function FallbackField(props: FieldProps): React.JSX.Element {
  return (
    <FieldShell descriptor={props.descriptor}>
      <pre className="overflow-auto rounded border border-[hsl(var(--input))] bg-[hsl(var(--muted))] p-2 text-xs">
        {JSON.stringify(props.value ?? null, null, 2)}
      </pre>
    </FieldShell>
  );
}

const DEFAULTS: Partial<
  Record<string, React.ComponentType<FieldProps>>
> = {
  string: StringField,
  secret: SecretField,
  enum: EnumField,
  record: RecordField,
  boolean: BooleanField,
  stringList: StringListField,
  object: ObjectField,
  objectList: ObjectListField,
};

export function FieldRenderer({
  registry = defaultFieldRegistry,
  ...props
}: FieldRendererProps): React.JSX.Element {
  const Override = registry.resolve(props.descriptor);
  const Default = DEFAULTS[props.descriptor.kind] ?? FallbackField;
  const Component = Override ?? Default;
  // 透传生效的注册表,使容器字段(record/object)的嵌套渲染沿用宿主的覆盖。
  return <Component {...props} registry={registry} />;
}
