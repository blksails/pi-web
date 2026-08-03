/**
 * model-catalog · CustomProviderSource — 自定义 provider 作为一类来源接入目录与会话
 * (spec: multi-gateway-providers,任务 5.3;design.md「核心抽象:ProviderSource」的
 * `S3 CustomProviderSource` 落点;Req 7.2, 7.5)。
 *
 * providers 配置域(`<agentDir>/providers.json`,任务 5.1「protocol/config/domains/
 * providers.ts」)落盘的是一份可增删的自定义 provider 条目列表。本模块把该文件**读**
 * 成两种下游各自需要的形状:
 * - {@link toProviderDefinitions} → `ProviderDefinition[]`,喂给 `ProviderRegistry` /
 *   `ModelCatalogService`(部署级目录,只需身份 + 类型声明 + 模型清单,不需要连接细节)。
 * - {@link readCustomProviderEntries} 的完整 {@link CustomProviderEntry}(含
 *   `baseUrl`/`apiKey`)→ 供会话侧(`host-assembly/model-sources.ts`)向 pi SDK
 *   `ModelRegistry.registerProvider` 注册实际可调用的 provider。
 *
 * 两条消费路径读的是**同一份**磁盘文件、同一套解析规则 —— 这正是任务描述里
 * 「同一份定义在会话侧注册」的字面含义:不另建第二份数据源,避免两侧对「这个
 * provider 现在启用与否」的判断漂移。
 *
 * ### 为什么手写宽松解析,而不复用 5.1 的 `createProvidersConfigSchema`
 *
 * 那份 zod schema 是**写入**时的校验(`superRefine` 对整份列表做标识重复 / 保留名
 * 冲突的 fail-fast 校验,任一条目不合规则整份提交被拒)。**读取**时语义不同:磁盘上
 * 的文件理应已经是写入时校验过的产物,但读路径仍应对损坏 / 手工误改的文件保持
 * fail-soft ——单条目结构异常只丢弃该条目,不能因为其中一条格式不对就让**全部**
 * 自定义 provider 从目录里消失(那比"完全不接入自定义 provider"还糟糕:后者至少
 * 是零回归,前者是新引入的一种「读到脏数据就全灭」故障模式)。逐字段独立校验、
 * 逐条目独立丢弃,是该 fail-soft 要求下的直接实现。
 *
 * 文件缺失(未使用过本功能的既有用户)按空列表处理,不抛 —— 与 `aigc.json`
 * (`packages/tool-kit/src/aigc/model-config.ts`)、`mcp.json`
 * (`packages/tool-kit/src/mcp/config-loader.ts`)等既有 config 域的装配期读取同惯例。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Modality } from "./modality.js";
import type { ProviderDefinition, ProviderSource } from "./provider-source.js";

/** providers 配置域的落盘文件名(与 protocol `domains/providers.ts` 头注释一致)。 */
export const CUSTOM_PROVIDERS_CONFIG_FILENAME = "providers.json";

/**
 * `ProviderSource.sourceId`(冲突报告 / 日志用)与会话侧 `ModelSourceRegistrar.sourceId`
 * 共用同一个值 —— 两条消费路径读的是同一份来源,来源身份理应一致。
 */
export const CUSTOM_PROVIDER_SOURCE_ID = "custom-providers";

/** 输入/输出模态取值域(与 `modality.ts` 的 `Modality` 同构,供结构化解析做成员校验)。 */
const MODALITY_VALUES: ReadonlySet<string> = new Set<Modality>([
  "text",
  "image",
  "video",
  "audio",
]);

/** 自定义 provider 携带的单条模型(目录组装所需的最小字段)。 */
export interface CustomProviderModel {
  readonly id: string;
  readonly name?: string;
}

/**
 * 解析所得的单条自定义 provider —— 携带部署级目录与会话注册两侧各自所需的全部字段
 * (前者只用 `id`/`displayName`/`enabled`/`input`/`output`/`models`,后者还需
 * `baseUrl`/`apiKey`)。
 */
export interface CustomProviderEntry {
  readonly id: string;
  readonly displayName?: string;
  /** 缺省视为启用,与 protocol `providerEntrySchema` 的 `enabled.default(true)` 一致。 */
  readonly enabled: boolean;
  readonly baseUrl: string;
  /** 并非全部自定义 provider 都要求凭据(Req 7.2),故可选。 */
  readonly apiKey?: string;
  readonly input?: readonly Modality[];
  readonly output?: readonly Modality[];
  readonly models: readonly CustomProviderModel[];
}

function toModalityArray(v: unknown): readonly Modality[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(
    (x): x is Modality => typeof x === "string" && MODALITY_VALUES.has(x),
  );
  return out.length > 0 ? out : undefined;
}

function parseModels(v: unknown): readonly CustomProviderModel[] {
  if (!Array.isArray(v)) return [];
  const out: CustomProviderModel[] = [];
  for (const item of v) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const id = raw["id"];
    if (typeof id !== "string" || id.length === 0) continue;
    const name = raw["name"];
    out.push({ id, ...(typeof name === "string" && name.length > 0 ? { name } : {}) });
  }
  return out;
}

/** 单条目结构校验;不合规(缺 `id`/`baseUrl` 或类型不对)→ `undefined`(该条目被丢弃)。 */
function parseEntry(v: unknown): CustomProviderEntry | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const raw = v as Record<string, unknown>;
  const id = raw["id"];
  const baseUrl = raw["baseUrl"];
  if (typeof id !== "string" || id.length === 0) return undefined;
  if (typeof baseUrl !== "string" || baseUrl.length === 0) return undefined;

  const displayName = raw["displayName"];
  const apiKey = raw["apiKey"];
  return {
    id,
    ...(typeof displayName === "string" && displayName.length > 0 ? { displayName } : {}),
    enabled: raw["enabled"] !== false,
    baseUrl,
    ...(typeof apiKey === "string" && apiKey.length > 0 ? { apiKey } : {}),
    ...(toModalityArray(raw["input"]) !== undefined ? { input: toModalityArray(raw["input"]) } : {}),
    ...(toModalityArray(raw["output"]) !== undefined
      ? { output: toModalityArray(raw["output"]) }
      : {}),
    models: parseModels(raw["models"]),
  };
}

/**
 * 解析 agent 目录:`PI_WEB_AGENT_DIR`(pi-web 覆盖)> `PI_CODING_AGENT_DIR`(runner 子进程
 * 恒有,由 `assemble-spawn.ts` 写入)> `~/.pi/agent`。与 `packages/tool-kit/src/aigc/
 * model-config.ts` 的 `resolveAgentDir` 同惯例 —— 两处对「agentDir 从哪个 env 来」的
 * 判断不能漂移。
 */
export function resolveCustomProvidersAgentDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["PI_WEB_AGENT_DIR"] ?? env["PI_CODING_AGENT_DIR"];
  if (typeof override === "string" && override.length > 0) return override;
  return path.join(os.homedir(), ".pi", "agent");
}

/**
 * 读取并解析 `<agentDir>/providers.json`。文件缺失 / 非法 JSON / 顶层结构不对 →
 * 空数组,不抛(fail-soft,与既有 config 域装配期读取同惯例)。返回**全部**条目
 * ——含 `enabled: false` 的 —— 由调用方按各自用途决定是否过滤(Req 7.5:目录侧要
 * 「停用后消失但配置仍在」,故不能在这一层就把停用条目丢弃)。
 */
export function readCustomProviderEntries(agentDir: string): readonly CustomProviderEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(agentDir, CUSTOM_PROVIDERS_CONFIG_FILENAME), "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const list = (parsed as Record<string, unknown>)["providers"];
  if (!Array.isArray(list)) return [];

  const out: CustomProviderEntry[] = [];
  for (const item of list) {
    const entry = parseEntry(item);
    if (entry !== undefined) out.push(entry);
  }
  return out;
}

/**
 * 投影为部署级目录所需的 `ProviderDefinition`(丢弃 `baseUrl`/`apiKey` 等连接细节 ——
 * 目录只需身份、类型声明与模型清单)。**保留** `enabled` 原值,包括 `false` ——
 * `ProviderRegistry.providers()` 按 `enabled` 过滤,`find()` 不过滤(Req 7.5 的落地
 * 依赖这一点:停用的 provider 必须仍能被 `find()` 查到,否则「配置仍在」无法验证)。
 */
export function toProviderDefinitions(
  entries: readonly CustomProviderEntry[],
): readonly ProviderDefinition<CustomProviderModel>[] {
  return entries.map((e) => ({
    id: e.id,
    ...(e.displayName !== undefined ? { displayName: e.displayName } : {}),
    enabled: e.enabled,
    ...(e.input !== undefined ? { input: e.input } : {}),
    ...(e.output !== undefined ? { output: e.output } : {}),
    models: e.models,
  }));
}

/**
 * 部署级目录来源(design.md `CustomProviderSource`):同步读 `<agentDir>/providers.json`,
 * 产出 `ProviderDefinition[]`。`list()` 不抛(读取失败已在 {@link readCustomProviderEntries}
 * 内部降级为空数组),满足 `ProviderSource` 契约(任务 1.3)。
 *
 * `agentDir` 在构造时确定(装配层每次组装目录服务时传入当前 `agentDir`),`list()`
 * 每次调用重新读盘 —— 与既有「每请求构造 `ModelCatalogService`」的既定语义一致
 * (hidden 名单同理即时生效),使新增 / 停用 provider 无需重启即可反映(不缓存)。
 */
export function createCustomProviderSource(
  agentDir: string,
): ProviderSource<CustomProviderModel> {
  return {
    sourceId: CUSTOM_PROVIDER_SOURCE_ID,
    list: () => toProviderDefinitions(readCustomProviderEntries(agentDir)),
  };
}
