/**
 * secret-merge — secret 字段掩码(GET 路径)与仅写合并(PUT 路径)。
 *
 * ### 掩码占位形状(读)
 * 使用 @pi-web/protocol 的 SecretMask:
 * ```ts
 * { __secret: true, set: boolean, hint?: string }
 * ```
 * - `set: true`  → 磁盘中有值(不回传明文);`hint` 为明文末 4 字符。
 * - `set: false` → 磁盘中无此键。
 *
 * ### PUT 写语义(写,secret 字段)
 * 使用 @pi-web/protocol 的 SecretWrite 显式三态:
 * - `{ __secret:true, action:"keep" }`          → 保留磁盘原值不变。
 * - `{ __secret:true, action:"clear" }`         → 删除磁盘中该键。
 * - `{ __secret:true, action:"set", value:"…" }` → 覆盖磁盘值。
 *
 * 对 secret 字段的旧式兼容:
 * - 字段缺失/`undefined` → 等同 keep(保留)。
 * - SecretMask 对象      → 等同 keep(前端回传掩码,不修改)。
 *
 * ### auth 域特殊处理
 * auth.json 是一个 record(动态键→provider对象),对应 FormSchema 中的单个 `record`
 * 字段(key = domain name)。顶层数据键均为动态 provider 名,其子字段(apiKey, baseURL)
 * 按 FormSchema 子字段的 secret 标记处理。
 * 对 provider 本身(而非子字段):null → 删除 provider,undefined → 跳过。
 */
import type { ConfigDomainId, FieldDescriptor, FormSchema } from "@pi-web/protocol";
import {
  type SecretMask,
  type SecretWrite,
  isSecretMask,
  isSecretWrite,
  CONFIG_FORM_SCHEMAS,
} from "@pi-web/protocol";

export type { SecretMask, SecretWrite };
export { isSecretMask, isSecretWrite };

function buildMask(diskValue: unknown): SecretMask {
  if (diskValue === undefined || diskValue === null || diskValue === "") {
    return { __secret: true, set: false };
  }
  const str = String(diskValue);
  const hint = str.length >= 4 ? str.slice(-4) : undefined;
  return hint !== undefined
    ? { __secret: true, set: true, hint }
    : { __secret: true, set: true };
}

/** 判断 descriptor 是否为 secret 字段。 */
function isSecretDescriptor(d: FieldDescriptor): boolean {
  return d.kind === "secret" || d.secret === true;
}

/**
 * 分析 FormSchema 的结构:
 * - 若顶层只有一个 `record` 字段(其 key 等于 domain name),则整个 rawValues 是该
 *   record 的条目(如 auth 域:顶层键是 provider name)。
 *   返回 `{ mode: "top-level-record", subSecrets }` 其中 subSecrets 是记录值对象中
 *   的 secret 子字段名集合。
 * - 否则为 flat object:返回 `{ mode: "object", topLevel, nestedRecords }`:
 *   `topLevel` 是直接 secret 字段 key 集合,`nestedRecords` 是 record 字段 key →
 *   其子 secret 字段集合的 Map。
 */
type SchemaAnalysis =
  | { readonly mode: "top-level-record"; readonly subSecrets: Set<string> }
  | {
      readonly mode: "object";
      readonly topLevel: Set<string>;
      readonly nestedRecords: Map<string, Set<string>>;
    };

function analyzeFormSchema(domain: string, formSchema: FormSchema): SchemaAnalysis {
  const { fields } = formSchema;
  // auth-like: single record field whose key matches the domain name.
  if (
    fields.length === 1 &&
    fields[0] !== undefined &&
    fields[0].kind === "record" &&
    fields[0].key === domain
  ) {
    const recordField = fields[0];
    const subSecrets = new Set<string>();
    if (recordField.fields !== undefined) {
      for (const subField of recordField.fields) {
        if (isSecretDescriptor(subField)) {
          subSecrets.add(subField.key);
        }
      }
    }
    return { mode: "top-level-record", subSecrets };
  }

  // flat object (settings-like).
  const topLevel = new Set<string>();
  const nestedRecords = new Map<string, Set<string>>();
  for (const field of fields) {
    if (isSecretDescriptor(field)) {
      topLevel.add(field.key);
    }
    if (field.kind === "record" && field.fields !== undefined) {
      const sub = new Set<string>();
      for (const subField of field.fields) {
        if (isSecretDescriptor(subField)) {
          sub.add(subField.key);
        }
      }
      if (sub.size > 0) {
        nestedRecords.set(field.key, sub);
      }
    }
  }
  return { mode: "object", topLevel, nestedRecords };
}

/** 掩码一个 provider 对象中的 secret 子字段。 */
function maskProviderObject(
  val: unknown,
  subSecrets: Set<string>,
): Record<string, unknown> {
  if (val === null || typeof val !== "object" || Array.isArray(val)) {
    return {};
  }
  const obj = val as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = subSecrets.has(k) ? buildMask(v) : v;
  }
  return result;
}

/**
 * GET 路径:将 rawValues 中的 secret 字段替换为掩码占位,非 secret 字段透传。
 */
export function maskSecrets(
  domain: ConfigDomainId,
  rawValues: Record<string, unknown>,
  formSchema?: FormSchema,
): Record<string, unknown> {
  const schema = formSchema ?? CONFIG_FORM_SCHEMAS[domain];
  const analysis = analyzeFormSchema(domain, schema);

  if (analysis.mode === "top-level-record") {
    // All top-level keys are dynamic record entries (e.g. provider names).
    const { subSecrets } = analysis;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawValues)) {
      result[key] = maskProviderObject(value, subSecrets);
    }
    return result;
  }

  // Flat object mode.
  const { topLevel, nestedRecords } = analysis;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawValues)) {
    if (topLevel.has(key)) {
      result[key] = buildMask(value);
      continue;
    }
    const subSecrets = nestedRecords.get(key);
    if (subSecrets !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)) {
      // Nested record field: each entry's values get masked.
      const providerMap = value as Record<string, unknown>;
      const maskedMap: Record<string, unknown> = {};
      for (const [pKey, pVal] of Object.entries(providerMap)) {
        maskedMap[pKey] = maskProviderObject(pVal, subSecrets);
      }
      result[key] = maskedMap;
      continue;
    }
    result[key] = value;
  }
  return result;
}

/**
 * 解析 secret 字段的写语义。
 *
 * - SecretWrite { action:"keep" } → "keep"
 * - SecretWrite { action:"clear" } → "clear"
 * - SecretWrite { action:"set", value } → { op:"set", value }
 * - SecretMask (旧式掩码回传) → "keep"
 * - undefined / 字段缺失 → "keep"
 * - 非空字符串 → { op:"set", value }  (向后兼容)
 * - null → "clear" (非 secret 字段的 null 语义,此处也兼容)
 */
type SecretOp =
  | "keep"
  | "clear"
  | { readonly op: "set"; readonly value: unknown };

function resolveSecretOp(incoming: unknown): SecretOp {
  if (incoming === undefined) return "keep";
  if (isSecretWrite(incoming)) {
    if (incoming.action === "keep") return "keep";
    if (incoming.action === "clear") return "clear";
    // action === "set"
    return { op: "set", value: incoming.value };
  }
  if (isSecretMask(incoming)) return "keep";
  if (incoming === null) return "clear";
  return { op: "set", value: incoming };
}

/**
 * PUT 路径:将 incoming 中的 secret 字段按"仅写"语义合并到 diskValues 上。
 *
 * 返回合并后的完整值(可直接传给 codec.save)。
 */
export function mergeSecrets(
  domain: ConfigDomainId,
  incomingValues: Record<string, unknown>,
  diskValues: Record<string, unknown>,
  formSchema?: FormSchema,
): Record<string, unknown> {
  const schema = formSchema ?? CONFIG_FORM_SCHEMAS[domain];
  const analysis = analyzeFormSchema(domain, schema);

  if (analysis.mode === "top-level-record") {
    return mergeTopLevelRecord(incomingValues, diskValues, analysis.subSecrets);
  }

  return mergeObjectFields(incomingValues, diskValues, analysis.topLevel, analysis.nestedRecords);
}

/**
 * 合并 top-level-record 模式(auth 域):
 * 顶层键是动态 provider 名,值是含 secret 子字段的对象。
 */
function mergeTopLevelRecord(
  incoming: Record<string, unknown>,
  disk: Record<string, unknown>,
  subSecrets: Set<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...disk };

  for (const [providerKey, incomingProvider] of Object.entries(incoming)) {
    if (incomingProvider === undefined) continue;

    if (incomingProvider === null) {
      delete result[providerKey];
      continue;
    }

    if (typeof incomingProvider !== "object" || Array.isArray(incomingProvider)) {
      result[providerKey] = incomingProvider;
      continue;
    }

    // Merge provider object with secret sub-field semantics.
    const diskProvider =
      disk[providerKey] !== null &&
      typeof disk[providerKey] === "object" &&
      !Array.isArray(disk[providerKey])
        ? (disk[providerKey] as Record<string, unknown>)
        : {};

    const mergedProvider: Record<string, unknown> = { ...diskProvider };
    const incomingObj = incomingProvider as Record<string, unknown>;

    for (const [fieldKey, fieldVal] of Object.entries(incomingObj)) {
      if (subSecrets.has(fieldKey)) {
        // Secret field: apply SecretWrite semantics.
        const op = resolveSecretOp(fieldVal);
        if (op === "keep") continue;
        if (op === "clear") { delete mergedProvider[fieldKey]; continue; }
        mergedProvider[fieldKey] = op.value;
      } else {
        // Non-secret: direct overwrite.
        if (fieldVal === undefined) continue;
        if (fieldVal === null) {
          delete mergedProvider[fieldKey];
        } else {
          mergedProvider[fieldKey] = fieldVal;
        }
      }
    }

    result[providerKey] = mergedProvider;
  }

  return result;
}

/**
 * 合并 object 模式(settings 域):
 * 顶层键是已知字段名。
 */
function mergeObjectFields(
  incoming: Record<string, unknown>,
  disk: Record<string, unknown>,
  topLevelSecrets: Set<string>,
  nestedRecords: Map<string, Set<string>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...disk };

  for (const [key, incomingVal] of Object.entries(incoming)) {
    if (topLevelSecrets.has(key)) {
      const op = resolveSecretOp(incomingVal);
      if (op === "keep") continue;
      if (op === "clear") { delete result[key]; continue; }
      result[key] = op.value;
      continue;
    }

    const subSecrets = nestedRecords.get(key);
    if (subSecrets !== undefined) {
      if (incomingVal === null) { delete result[key]; continue; }
      if (incomingVal === undefined) continue;
      if (typeof incomingVal !== "object" || Array.isArray(incomingVal)) {
        result[key] = incomingVal;
        continue;
      }
      result[key] = mergeTopLevelRecord(
        incomingVal as Record<string, unknown>,
        disk[key] !== null && typeof disk[key] === "object" && !Array.isArray(disk[key])
          ? (disk[key] as Record<string, unknown>)
          : {},
        subSecrets,
      );
      continue;
    }

    // Non-secret, non-record field.
    if (incomingVal === undefined) continue;
    if (incomingVal === null) {
      delete result[key];
    } else {
      result[key] = incomingVal;
    }
  }

  return result;
}
