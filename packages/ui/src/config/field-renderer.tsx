/**
 * FieldRenderer — 字段分派器。
 *
 * 解析顺序:per-source scoped 注册表(按 fieldKey/widget,须提供 sourceKey)→
 * 全局注册表覆盖(按 fieldKey/widget)→ 注册表 kind 覆盖 → 内置默认控件。
 * 未知 kind 安全降级为只读 JSON 文本,不崩溃。
 *
 * 面⑦ per-source 动态控件的降级语义(仅在提供 sourceKey 时生效,不影响宿主内建
 * widget 如 modelSelect):字段声明了 `widget` 但 scoped + 全局两级注册表均未命中
 * (该 source 的 webext settingsWidgets 未装/验签失败)→ 降级只读 JSON,不回退到
 * kind 默认控件(默认控件不认得动态控件专属的数据形状)。未提供 sourceKey 的表单
 * (如宿主内建设置面板)保持既有行为:未命中 widget 时按 kind 默认控件渲染。
 */
import * as React from "react";
import type { FieldProps, FieldRegistry, SourceFieldRegistry } from "./field-registry.js";
import { defaultFieldRegistry, defaultSourceFieldRegistry } from "./field-registry.js";
import { StringField } from "./fields/string-field.js";
import { SecretField } from "./fields/secret-field.js";
import { EnumField } from "./fields/enum-field.js";
import { RecordField } from "./fields/record-field.js";
import { BooleanField } from "./fields/boolean-field.js";
import { NumberField } from "./fields/number-field.js";
import { StringListField } from "./fields/string-list-field.js";
import { ObjectField } from "./fields/object-field.js";
import { ObjectListField } from "./fields/object-list-field.js";
import { FieldShell } from "./fields/field-shell.js";

export interface FieldRendererProps extends FieldProps {
  /** 可注入隔离注册表(默认用模块级单例)。 */
  readonly registry?: FieldRegistry;
  /** 可注入隔离 scoped 注册表(默认用模块级单例;测试用)。 */
  readonly sourceFieldRegistry?: SourceFieldRegistry;
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
  number: NumberField,
  stringList: StringListField,
  object: ObjectField,
  objectList: ObjectListField,
};

export function FieldRenderer({
  registry = defaultFieldRegistry,
  sourceFieldRegistry = defaultSourceFieldRegistry,
  ...props
}: FieldRendererProps): React.JSX.Element {
  const Scoped =
    props.sourceKey !== undefined
      ? sourceFieldRegistry.resolve(props.sourceKey, props.descriptor)
      : undefined;
  const Override = Scoped ?? registry.resolve(props.descriptor);
  // 仅 per-source 语境(提供了 sourceKey)下,widget 未命中才降级只读 JSON;
  // 宿主内建 widget(如未提供 sourceKey 的全局设置表单)保持既有 kind 默认回退。
  const degradeMissingWidget =
    props.sourceKey !== undefined && props.descriptor.widget !== undefined;
  const Default = degradeMissingWidget ? FallbackField : DEFAULTS[props.descriptor.kind] ?? FallbackField;
  const Component = Override ?? Default;
  // 透传生效的注册表与 sourceKey,使容器字段(record/object)的嵌套渲染沿用宿主的覆盖。
  return <Component {...props} registry={registry} />;
}
