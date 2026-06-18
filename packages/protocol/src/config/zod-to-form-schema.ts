/**
 * 适配器 — 由 zod object schema 推导归一化 `FormSchema`(表单 IR)。
 *
 * 仅依赖 zod 3 的稳定内省点(`_def.typeName` + shape),解包 Optional/Default/
 * Nullable/Effects 等包装,合并 `.describe()` 承载的 UI 元数据(parseDescribeMeta)。
 * 把"按字段类型判别 → 控件"这一映射集中在此,渲染层与 zod 版本解耦。
 */
import { z } from "zod";
import type {
  FieldDescriptor,
  FieldGroup,
  FieldKind,
  FormSchema,
} from "./form-schema.js";
import { parseDescribeMeta, prettifyKey, type UIMeta } from "./meta.js";

type AnyZod = z.ZodTypeAny;

interface Unwrapped {
  readonly inner: AnyZod;
  readonly required: boolean;
  readonly default?: unknown;
}

function typeName(s: AnyZod): string {
  return (s as { _def?: { typeName?: string } })._def?.typeName ?? "";
}

/** 解包 Optional/Default/Nullable/Effects/Branded,得到内层类型与 required/default。 */
function unwrap(schema: AnyZod): Unwrapped {
  let s: AnyZod = schema;
  let required = true;
  let dflt: unknown = undefined;
  for (;;) {
    const tn = typeName(s);
    const def = (s as { _def?: Record<string, unknown> })._def ?? {};
    if (tn === "ZodOptional") {
      required = false;
      s = def.innerType as AnyZod;
      continue;
    }
    if (tn === "ZodDefault") {
      required = false;
      const dv = def.defaultValue;
      dflt = typeof dv === "function" ? (dv as () => unknown)() : dv;
      s = def.innerType as AnyZod;
      continue;
    }
    if (tn === "ZodNullable") {
      s = def.innerType as AnyZod;
      continue;
    }
    if (tn === "ZodEffects") {
      s = def.schema as AnyZod;
      continue;
    }
    if (tn === "ZodBranded") {
      s = def.type as AnyZod;
      continue;
    }
    break;
  }
  return { inner: s, required, default: dflt };
}

/** 取 schema 的 description(外层优先,回退内层)。 */
function descriptionOf(outer: AnyZod, inner: AnyZod): string | undefined {
  const o = (outer as { description?: string }).description;
  if (o !== undefined) return o;
  return (inner as { description?: string }).description;
}

const SECRET_KEY_RE = /(apikey|api_key|token|secret|password|credential)/i;

function inferKind(inner: AnyZod, key: string, meta: UIMeta): FieldKind {
  if (meta.kind !== undefined) return meta.kind;
  const tn = typeName(inner);
  switch (tn) {
    case "ZodString":
      return meta.secret === true || SECRET_KEY_RE.test(key) ? "secret" : "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodEnum":
    case "ZodNativeEnum":
      return "enum";
    case "ZodArray": {
      const el = unwrap((inner as { _def: { type: AnyZod } })._def.type).inner;
      return typeName(el) === "ZodEnum" ? "multiEnum" : "stringList";
    }
    case "ZodObject":
      return "object";
    case "ZodRecord":
      return "record";
    default:
      return "string";
  }
}

function enumOptions(inner: AnyZod, meta: UIMeta) {
  const tn = typeName(inner);
  let values: string[] = [];
  if (tn === "ZodEnum") {
    values = ((inner as { _def: { values: string[] } })._def.values ?? []).slice();
  } else if (tn === "ZodNativeEnum") {
    const obj = (inner as { _def: { values: Record<string, string | number> } })
      ._def.values;
    values = Object.values(obj).filter((v): v is string => typeof v === "string");
  }
  return values.map((value) => ({
    value,
    label: meta.enumLabels?.[value] ?? value,
  }));
}

function shapeOf(objSchema: AnyZod): Record<string, AnyZod> {
  const def = (objSchema as { _def: { shape: () => Record<string, AnyZod> } })._def;
  return typeof def.shape === "function" ? def.shape() : {};
}

/** 由单个字段 schema 推导 FieldDescriptor。 */
function fieldFrom(key: string, schema: AnyZod): FieldDescriptor {
  const { inner, required, default: dflt } = unwrap(schema);
  const meta = parseDescribeMeta(descriptionOf(schema, inner));
  const kind = inferKind(inner, key, meta);

  const base: FieldDescriptor = {
    key,
    kind,
    label: meta.label ?? prettifyKey(key),
    description: meta.description,
    placeholder: meta.placeholder,
    required,
    default: dflt,
    group: meta.group,
    order: meta.order,
    widget: meta.widget,
    secret: kind === "secret" ? true : meta.secret,
    readOnly: meta.readOnly,
    min: meta.min,
    max: meta.max,
    step: meta.step,
  };

  if (kind === "enum" || kind === "multiEnum") {
    return { ...base, enumOptions: enumOptions(inner, meta) };
  }
  if (kind === "object") {
    return { ...base, fields: fieldsFromObject(inner) };
  }
  if (kind === "stringList") {
    return { ...base, itemKind: "string" };
  }
  if (kind === "record") {
    const valueType = unwrap(
      (inner as { _def: { valueType: AnyZod } })._def.valueType,
    ).inner;
    if (typeName(valueType) === "ZodObject") {
      return { ...base, fields: fieldsFromObject(valueType) };
    }
    return { ...base, itemKind: inferKind(valueType, key, {}) };
  }
  return base;
}

function fieldsFromObject(objSchema: AnyZod): FieldDescriptor[] {
  const shape = shapeOf(objSchema);
  const fields = Object.entries(shape).map(([k, s]) => fieldFrom(k, s));
  // 稳定排序:有 order 的按 order,其余保持声明序(order 缺省置后)。
  return fields
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const ao = a.f.order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.f.order ?? Number.MAX_SAFE_INTEGER;
      return ao === bo ? a.i - b.i : ao - bo;
    })
    .map(({ f }) => f);
}

export interface ZodToFormSchemaOptions {
  readonly title?: string;
  readonly groups?: readonly FieldGroup[];
}

/**
 * 把一个 zod object(或 record)schema 转为 FormSchema。
 * - object → 逐字段映射;
 * - record(顶层,如 auth)→ 单个 record 字段(domain 名为 key)。
 */
export function zodToFormSchema(
  domain: string,
  schema: AnyZod,
  opts: ZodToFormSchemaOptions = {},
): FormSchema {
  const { inner } = unwrap(schema);
  const tn = typeName(inner);

  let fields: FieldDescriptor[];
  if (tn === "ZodObject") {
    fields = fieldsFromObject(inner);
  } else if (tn === "ZodRecord") {
    fields = [fieldFrom(domain, schema)];
  } else {
    fields = [fieldFrom(domain, schema)];
  }

  return {
    domain,
    title: opts.title,
    fields,
    groups: opts.groups,
  };
}
