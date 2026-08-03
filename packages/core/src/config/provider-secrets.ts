/**
 * provider-secrets — providers 配置域（`providers.json`）的凭据掩码与三态合并
 * (spec: multi-gateway-providers，任务 5.2；Req 7.3, 7.4)。
 *
 * **为什么不复用 `./secret-merge.ts`**：通用实现只认两种形态 —— 扁平 object（顶层 secret
 * 字段 + `record` 子字段）与单一 `record` 域（key → object）；而 providers 域顶层是
 * `objectList`（`providers: ProviderEntry[]`），通用遍历器的 `analyzeFormSchema` 只识别
 * `kind === "record"`，对 `kind === "objectList"` 的字段直接原样透传（见其
 * `mode: "object"` 分支的兜底 `result[key] = value`）。
 *
 * ★★ 这不是形式差异：`objectList` 内每个条目的 `apiKey` 会被**原样透传**，即通用实现在
 * providers 域上会把凭据**明文**回传给浏览器（真实的凭据泄露风险，已用生成 red 的单测实测
 * 验证 —— 见 `provider-secrets.test.ts` 中标注为 blind-spot 的用例）。故此处复用 secret
 * 三态协议的语义与类型，只自建针对该已知结构（`objectList` + 单一 secret 字段 `apiKey`，
 * 以 `id` 去重）的遍历器，不去扩展通用实现（会越出本 spec 边界，且影响全部既有域）。
 */
import {
  isSecretMask,
  isSecretWrite,
  type SecretMask,
  type SecretWrite,
} from "@blksails/pi-web-protocol";

/** providers 域内承载凭据的字段名（design.md 数据模型：`providers[].apiKey`）。 */
const SECRET_FIELD = "apiKey" as const;

type Json = Record<string, unknown>;

function isPlainObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function maskOf(value: unknown): SecretMask {
  const set = typeof value === "string" && value.length > 0;
  if (!set) return { __secret: true, set: false };
  const str = value as string;
  const hint = str.length >= 4 ? str.slice(-4) : undefined;
  return hint !== undefined ? { __secret: true, set: true, hint } : { __secret: true, set: true };
}

/**
 * 读路径:把每个 provider 条目的 `apiKey` 替换为掩码占位,**明文绝不回读浏览器**
 * (Req 7.3)。其余字段(含条目内的 `models` 等)原样保留。非 providers 域形状(无
 * `providers` 数组)原样透传,使调用方可无条件调用而不必先判形状。
 */
export function maskProviderSecrets(config: unknown): unknown {
  if (!isPlainObject(config)) return config;
  const providers = config["providers"];
  if (!Array.isArray(providers)) return config;

  return {
    ...config,
    providers: providers.map((entry) => {
      if (!isPlainObject(entry)) return entry;
      return { ...entry, [SECRET_FIELD]: maskOf(entry[SECRET_FIELD]) };
    }),
  };
}

/** 按 provider `id` 建立磁盘侧索引,供 `keep` 取回原值。 */
function indexById(providers: unknown): Map<string, Json> {
  const map = new Map<string, Json>();
  if (!Array.isArray(providers)) return map;
  for (const entry of providers) {
    if (isPlainObject(entry) && typeof entry["id"] === "string") {
      map.set(entry["id"] as string, entry);
    }
  }
  return map;
}

/**
 * 写路径:解析 `apiKey` 的三态语义(Req 7.3, 7.4)。
 * - `keep`  → 取磁盘原值(原值不存在则该键被移除,等价于未设置)
 * - `clear` → 移除该键
 * - `set`   → 采用新明文,覆盖旧值
 * 前端原样回传读回时给的 `SecretMask` 占位(未经用户修改的表单)同样视为 `keep` —— 使用者
 * 没有触碰凭据字段时,提交的仍是掩码对象而非 `SecretWrite`,不能把掩码字面量当明文存盘。
 * 非 `SecretWrite`/`SecretMask` 的普通字符串按明文直存(允许直接粘贴新值,向后兼容);
 * `undefined` 视为 `keep`(与 `secret-merge.ts` 的"字段缺失即保留"语义一致)。
 */
export function mergeProviderSecrets(incoming: unknown, disk: unknown): unknown {
  if (!isPlainObject(incoming)) return incoming;
  const providers = incoming["providers"];
  if (!Array.isArray(providers)) return incoming;

  const diskIndex = indexById(isPlainObject(disk) ? disk["providers"] : undefined);

  return {
    ...incoming,
    providers: providers.map((entry) => {
      if (!isPlainObject(entry)) return entry;

      const diskEntry = typeof entry["id"] === "string" ? diskIndex.get(entry["id"] as string) : undefined;
      const incomingSecret = entry[SECRET_FIELD];
      const next: Json = { ...entry };

      if (incomingSecret === undefined) {
        // Field missing → keep disk value.
        const priorValue = diskEntry?.[SECRET_FIELD];
        if (priorValue !== undefined) next[SECRET_FIELD] = priorValue;
        else delete next[SECRET_FIELD];
      } else if (isSecretWrite(incomingSecret)) {
        const action = (incomingSecret as SecretWrite).action;
        if (action === "clear") {
          delete next[SECRET_FIELD];
        } else if (action === "keep") {
          const priorValue = diskEntry?.[SECRET_FIELD];
          if (priorValue !== undefined) next[SECRET_FIELD] = priorValue;
          else delete next[SECRET_FIELD];
        } else {
          next[SECRET_FIELD] = (incomingSecret as { readonly value: string }).value;
        }
      } else if (isSecretMask(incomingSecret)) {
        // Frontend echoed back the read-side mask placeholder untouched → keep.
        const priorValue = diskEntry?.[SECRET_FIELD];
        if (priorValue !== undefined) next[SECRET_FIELD] = priorValue;
        else delete next[SECRET_FIELD];
      } else if (incomingSecret === null) {
        delete next[SECRET_FIELD];
      } else {
        // Plain value (e.g. legacy plaintext string) → overwrite.
        next[SECRET_FIELD] = incomingSecret;
      }

      return next;
    }),
  };
}
