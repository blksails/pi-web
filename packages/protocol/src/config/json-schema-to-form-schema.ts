/**
 * 适配器 — 由 JSON Schema(Draft-07 子集)推导 `FormSchema`(表单 IR)。
 *
 * 支持:object/properties/required、动态键 map(`additionalProperties`/`patternProperties` 且无固定
 * `properties` → record)、string(+enum)、number|integer(+const)、boolean、
 * array(标量→stringList、enum→multiEnum、对象/oneOf→objectList)、oneOf-对象-const判别→variants、
 * 内部 `$ref`(`#/$defs|definitions/<name>`)。不支持的构造降级为 string(不抛)。
 *
 * 与 zod 适配器并列:渲染层只认 `FormSchema`,故 JSON Schema 来源经此即可被 `SchemaForm` 渲染。
 */
import type { FieldDescriptor, FieldKind, FieldVariants, FormSchema } from "./form-schema.js";
import { prettifyKey } from "./meta.js";

type JsonSchema = Record<string, unknown>;

function isObject(v: unknown): v is JsonSchema {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 解析 `$ref`(仅内部 `#/$defs|definitions/<name>`,支持单层指针)。 */
function resolveRef(node: JsonSchema, root: JsonSchema): JsonSchema {
  let cur = node;
  const seen = new Set<string>();
  while (typeof cur["$ref"] === "string") {
    const ref = cur["$ref"] as string;
    if (seen.has(ref)) break;
    seen.add(ref);
    if (!ref.startsWith("#/")) break;
    const segs = ref.slice(2).split("/");
    let target: unknown = root;
    for (const s of segs) {
      target = isObject(target) ? target[decodeURIComponent(s)] : undefined;
    }
    if (!isObject(target)) break;
    cur = target;
  }
  return cur;
}

function typeOf(node: JsonSchema): string | undefined {
  const t = node["type"];
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return t.find((x) => x !== "null") as string | undefined;
  return undefined;
}

/** 节点是否有固定命名字段(非空 `properties`)。 */
function hasNamedProps(node: JsonSchema): boolean {
  return isObject(node["properties"]) && Object.keys(node["properties"] as JsonSchema).length > 0;
}

/**
 * 取动态键 map 的「值模板」schema:
 *  - `additionalProperties` 为对象 schema → 用之;
 *  - 否则 `patternProperties` 取首个模式的值 schema;
 *  - `additionalProperties` 为 false/true(布尔) 或缺省 → 非 map(返回 undefined)。
 */
function recordValueSchema(node: JsonSchema): JsonSchema | undefined {
  const ap = node["additionalProperties"];
  if (isObject(ap)) return ap;
  const pp = node["patternProperties"];
  if (isObject(pp)) {
    const first = Object.values(pp).find((v) => isObject(v));
    if (isObject(first)) return first;
  }
  return undefined;
}

/** 标量节点 → record 的元素类型(itemKind)。 */
function scalarKindOf(node: JsonSchema): FieldKind {
  const t = typeOf(node);
  if (t === "number" || t === "integer") return "number";
  if (t === "boolean") return "boolean";
  return "string";
}

function enumValues(node: JsonSchema): string[] | undefined {
  const e = node["enum"];
  if (!Array.isArray(e)) return undefined;
  return e.filter((v): v is string | number => typeof v === "string" || typeof v === "number").map(String);
}

/** 找 oneOf 各对象分支共有的 const 判别键(优先 "type")。 */
function findDiscriminator(branches: JsonSchema[]): string | undefined {
  if (branches.length === 0) return undefined;
  const first = branches[0];
  const props = isObject(first?.["properties"]) ? (first!["properties"] as JsonSchema) : {};
  const candidates = Object.keys(props).sort((a, b) => (a === "type" ? -1 : b === "type" ? 1 : 0));
  for (const key of candidates) {
    const ok = branches.every((b) => {
      const p = isObject(b["properties"]) ? (b["properties"] as JsonSchema) : {};
      const pk = isObject(p[key]) ? (p[key] as JsonSchema) : undefined;
      return pk !== undefined && pk["const"] !== undefined;
    });
    if (ok) return key;
  }
  return undefined;
}

function variantsFromBranches(
  branches: JsonSchema[],
  root: JsonSchema,
): FieldVariants | undefined {
  const resolved = branches.map((b) => resolveRef(b, root)).filter((b) => isObject(b["properties"]));
  if (resolved.length < 2) return undefined;
  const discriminator = findDiscriminator(resolved);
  if (discriminator === undefined) return undefined;
  const cases = resolved.map((b) => {
    const props = b["properties"] as JsonSchema;
    const disc = props[discriminator] as JsonSchema;
    return {
      value: String(disc["const"]),
      label: typeof b["title"] === "string" ? (b["title"] as string) : undefined,
      // 变体字段排除判别键本身(由选择器设定)。
      fields: fieldsFromObject(b, root, [discriminator]),
    };
  });
  return { discriminator, cases };
}

function fieldsFromObject(
  objNode: JsonSchema,
  root: JsonSchema,
  exclude: readonly string[] = [],
): FieldDescriptor[] {
  const props = isObject(objNode["properties"]) ? (objNode["properties"] as JsonSchema) : {};
  const required = Array.isArray(objNode["required"]) ? (objNode["required"] as string[]) : [];
  const out: FieldDescriptor[] = [];
  for (const [key, raw] of Object.entries(props)) {
    if (exclude.includes(key)) continue;
    if (!isObject(raw)) continue;
    out.push(nodeToField(key, raw, root, required.includes(key)));
  }
  return out;
}

function baseDescriptor(
  key: string,
  node: JsonSchema,
  kind: FieldKind,
  required: boolean,
): FieldDescriptor {
  const examples = Array.isArray(node["examples"]) ? node["examples"] : undefined;
  const placeholder =
    examples !== undefined && examples.length > 0 ? String(examples[0]) : undefined;
  const desc: Record<string, unknown> = {
    key,
    kind,
    label: typeof node["title"] === "string" ? (node["title"] as string) : prettifyKey(key),
    required,
  };
  if (typeof node["description"] === "string") desc["description"] = node["description"];
  if (placeholder !== undefined) desc["placeholder"] = placeholder;
  if (node["default"] !== undefined) desc["default"] = node["default"];
  else if (node["const"] !== undefined) desc["default"] = node["const"];
  if (typeof node["minimum"] === "number") desc["min"] = node["minimum"];
  if (typeof node["maximum"] === "number") desc["max"] = node["maximum"];
  return desc as unknown as FieldDescriptor;
}

/** 单个 schema 节点 → FieldDescriptor。 */
export function nodeToField(
  key: string,
  rawNode: JsonSchema,
  root: JsonSchema,
  required: boolean,
): FieldDescriptor {
  const node = resolveRef(rawNode, root);

  // oneOf 对象(字段值为多态对象)→ object + variants。
  const oneOf = node["oneOf"];
  if (Array.isArray(oneOf)) {
    const variants = variantsFromBranches(oneOf as JsonSchema[], root);
    if (variants !== undefined) {
      return { ...baseDescriptor(key, node, "object", required), variants };
    }
  }

  const t = typeOf(node);

  if (t === "array") {
    const items = isObject(node["items"]) ? resolveRef(node["items"] as JsonSchema, root) : {};
    const itemOneOf = items["oneOf"];
    if (Array.isArray(itemOneOf)) {
      const variants = variantsFromBranches(itemOneOf as JsonSchema[], root);
      if (variants !== undefined) {
        return { ...baseDescriptor(key, node, "objectList", required), variants };
      }
    }
    if (typeOf(items) === "object" || isObject(items["properties"])) {
      return {
        ...baseDescriptor(key, node, "objectList", required),
        itemFields: fieldsFromObject(items, root),
      };
    }
    const itemEnum = enumValues(items);
    if (itemEnum !== undefined) {
      return {
        ...baseDescriptor(key, node, "multiEnum", required),
        enumOptions: itemEnum.map((value) => ({ value })),
      };
    }
    return { ...baseDescriptor(key, node, "stringList", required), itemKind: "string" };
  }

  // 动态键 map(无固定 properties,且 additionalProperties/patternProperties 给出值模板)→ record。
  // 有固定 properties 的对象优先按 object 渲染(命名字段占主导)。
  if (!hasNamedProps(node)) {
    const recVal = recordValueSchema(node);
    if (recVal !== undefined) {
      const valNode = resolveRef(recVal, root);
      if (typeOf(valNode) === "object" || isObject(valNode["properties"])) {
        return {
          ...baseDescriptor(key, node, "record", required),
          fields: fieldsFromObject(valNode, root),
        };
      }
      return { ...baseDescriptor(key, node, "record", required), itemKind: scalarKindOf(valNode) };
    }
  }

  if (t === "object" || isObject(node["properties"])) {
    return { ...baseDescriptor(key, node, "object", required), fields: fieldsFromObject(node, root) };
  }

  const en = enumValues(node);
  if (en !== undefined) {
    return {
      ...baseDescriptor(key, node, "enum", required),
      enumOptions: en.map((value) => ({ value })),
    };
  }

  if (t === "number" || t === "integer") return baseDescriptor(key, node, "number", required);
  if (t === "boolean") return baseDescriptor(key, node, "boolean", required);
  if (t === "string") return baseDescriptor(key, node, "string", required);

  // const 推断 / 兜底。
  if (typeof node["const"] === "boolean") return baseDescriptor(key, node, "boolean", required);
  if (typeof node["const"] === "number") return baseDescriptor(key, node, "number", required);
  return baseDescriptor(key, node, "string", required);
}

export interface JsonSchemaToFormSchemaOptions {
  readonly domain?: string;
}

/** 把(顶层为 object 的)JSON Schema 转为 FormSchema。 */
export function jsonSchemaToFormSchema(
  schema: unknown,
  opts: JsonSchemaToFormSchemaOptions = {},
): FormSchema {
  const root = isObject(schema) ? schema : {};
  const title = typeof root["title"] === "string" ? (root["title"] as string) : undefined;
  const domain = opts.domain ?? title ?? "config";
  const node = resolveRef(root, root);
  const fields =
    typeOf(node) === "object" || isObject(node["properties"])
      ? fieldsFromObject(node, root)
      : [nodeToField(domain, node, root, false)];
  return { domain, title, fields };
}
