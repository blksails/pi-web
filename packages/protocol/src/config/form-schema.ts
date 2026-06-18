/**
 * 表单 IR(FieldDescriptor / FormSchema)— "由 object schema 生成 UI" 的渲染契约"窄腰"。
 *
 * 渲染层只认这里的归一化描述,任何来源(zod / JSON Schema / 手写)只要产出 `FormSchema`
 * 即可被渲染。与 zod 版本及内部结构解耦(见 zod-to-form-schema.ts 适配器)。
 */

/** 字段类型(决定默认控件)。P0 实现 string/secret/enum/record;其余留接缝。 */
export type FieldKind =
  | "string"
  | "secret"
  | "number"
  | "boolean"
  | "enum"
  | "multiEnum"
  | "stringList"
  | "object"
  | "record";

/** 全部已知 FieldKind(运行期可枚举,供分派/校验)。 */
export const FIELD_KINDS: readonly FieldKind[] = [
  "string",
  "secret",
  "number",
  "boolean",
  "enum",
  "multiEnum",
  "stringList",
  "object",
  "record",
];

/** enum / multiEnum 的可选项。 */
export interface EnumOption {
  readonly value: string;
  readonly label?: string;
}

/** 归一化字段描述。 */
export interface FieldDescriptor {
  readonly key: string;
  readonly kind: FieldKind;
  readonly label: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly required: boolean;
  readonly default?: unknown;
  readonly group?: string;
  readonly order?: number;
  /** enum / multiEnum 选项。 */
  readonly enumOptions?: readonly EnumOption[];
  /** number 约束。 */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** object 子字段;record 值为对象时,作为每条记录的子字段模板。 */
  readonly fields?: readonly FieldDescriptor[];
  /** stringList / record 标量值的元素类型。 */
  readonly itemKind?: FieldKind;
  /** 渲染覆盖:指定自定义渲染器(覆盖默认 kind→控件)。 */
  readonly widget?: string;
  /** secret 快捷标记(与 kind:"secret" 等价语义)。 */
  readonly secret?: boolean;
  readonly readOnly?: boolean;
}

/** 分组定义。 */
export interface FieldGroup {
  readonly id: string;
  readonly title: string;
  readonly order?: number;
}

/** 一个配置域的完整表单 IR。 */
export interface FormSchema {
  readonly domain: string;
  readonly title?: string;
  readonly fields: readonly FieldDescriptor[];
  readonly groups?: readonly FieldGroup[];
}
