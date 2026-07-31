/**
 * session-options — `AgentDefinition` 的**会话类**字段 → `createAgentSessionFromServices`
 * 入参,以及模型引用的注册表解析。
 *
 * 自 `option-mapper.ts` 原样析出(SRP)。行为逐字保持;`option-mapper.ts` 继续 re-export
 * 本模块的公开符号,既有 import 零改动。
 *
 * 边界:本模块只回答「**会话本身怎么配**」——模型、思考档位、工具集。哪些资源随会话载入
 * 属资源类,见 `resource-options.ts`。
 */
import type {
  AgentDefinition,
  AgentModel,
} from "@blksails/pi-web-core/agent-definition.js";
import type {
  CreateAgentSessionFromServicesOptions,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
// 仅取**命名空间常量**(中立模块),不取任何 adapter 实现 —— 见该文件的位置说明。
import { AI_GATEWAY_PROVIDER_NAME } from "@blksails/pi-web-core/model-provider-names.js";

/**
 * 网关来源的**缺省** provider 名集合(spec multi-gateway-providers,任务 3.7,Req 6.5)。
 *
 * ★ 只作两件事:(1) 调用方(`option-mapper.ts`)未传入运行时集合时的回退,使既有
 *   单实例场景与改造前逐字节等价;(2) 未接线路径(如单元测试直调 `resolveModel`)
 *   的默认值。**真正的判据不再是与本常量比对** —— 多网关实例落地后,一个网关
 *   "来源"会同时产出多个 provider(每个实例一个 id),非缺省实例名(如 `cloudflare`/
 *   `blksails-ai`)与本常量逐字不等,静态比对必然漏判(任务 3.5 只改对了"成员测试
 *   而非 `===`"这一半,判据的**取值来源**仍是模块级常量这一半留到本任务)。
 *   判据现由 `resolveModel` 新增的 `gatewayProviderNames` 形参提供,调用方按模型源
 *   契约的 `providerNamesOf`(见 `model-source-registrar.ts`)回读**运行时实际注册**
 *   的全部实例名后逐次传入 —— 覆盖面天然随实例数伸缩,不必再改这里。
 */
const DEFAULT_GATEWAY_PROVIDER_NAMES: readonly string[] = [AI_GATEWAY_PROVIDER_NAME];

/** 已解析的 pi 会话模型(SDK 侧类型)。 */
export type SessionModel = NonNullable<CreateAgentSessionFromServicesOptions["model"]>;

/**
 * Result of mapping the session-class fields of an {@link AgentDefinition}.
 * Models are intentionally left unresolved here (still `AgentModel`); the
 * factory resolves `{ provider, modelId }` refs against the registry once
 * services exist. Exposed for unit testing.
 */
export interface MappedSessionFields {
  model?: AgentModel;
  thinkingLevel?: AgentDefinition["thinkingLevel"];
  scopedModels?: AgentDefinition["scopedModels"];
  tools?: string[];
  excludeTools?: string[];
  noTools?: AgentDefinition["noTools"];
  customTools?: CreateAgentSessionFromServicesOptions["customTools"];
}

/** True when `m` is a lightweight `{ provider, modelId }` reference. */
export function isModelRef(
  m: AgentModel,
): m is { provider: string; modelId: string } {
  // A fully-resolved pi Model carries an `api` discriminator; the lightweight
  // ref has only `provider` + `modelId`.
  return !("api" in m);
}

/**
 * Map the session-class fields of a definition. Absent fields are omitted so
 * the SDK keeps its defaults. Models stay as {@link AgentModel} (resolved
 * later, against the registry).
 */
export function mapSessionFields(def: AgentDefinition): MappedSessionFields {
  const out: MappedSessionFields = {};
  if (def.model !== undefined) out.model = def.model;
  if (def.thinkingLevel !== undefined) out.thinkingLevel = def.thinkingLevel;
  if (def.scopedModels !== undefined) out.scopedModels = def.scopedModels;
  if (def.tools !== undefined) out.tools = def.tools;
  if (def.excludeTools !== undefined) out.excludeTools = def.excludeTools;
  if (def.noTools !== undefined) out.noTools = def.noTools;
  if (def.customTools !== undefined) out.customTools = def.customTools;
  return out;
}

/**
 * Resolve an {@link AgentModel} to a concrete pi Model via the registry.
 *
 * @param gatewayProviderNames 当前运行时**实际注册**的全部网关实例 provider 名
 *   (spec multi-gateway-providers,任务 3.7,Req 6.5)。调用方(`option-mapper.ts`)
 *   按模型源契约的 `providerNamesOf` 回读后传入,使非缺省实例(如 `cloudflare`/
 *   `blksails-ai`)的解析失败也能命中来源专属文案。未传时回退到
 *   {@link DEFAULT_GATEWAY_PROVIDER_NAMES},与改造前(单实例)逐字节等价。
 */
export function resolveModel(
  model: AgentModel,
  registry: ModelRegistry,
  gatewayProviderNames: readonly string[] = DEFAULT_GATEWAY_PROVIDER_NAMES,
): SessionModel {
  if (!isModelRef(model)) {
    return model as SessionModel;
  }
  const found = registry.find(model.provider, model.modelId);
  if (found === undefined) {
    const base = `Model not found in registry: provider="${model.provider}" modelId="${model.modelId}"`;
    // spec ai-gateway-session-models Req 1.4/4.2:网关来源的失败有其特有成因(目录 TTL
    // 已过期、模型是 :batch/embedding 等不可对话变体、网关套件未启用),裸抛注册表内部
    // 文案会让用户无从下手。非网关来源的文案保持逐字不变。
    // ★ 判据必须是 provider **命名空间**,不能是「该源是否已注册」——
    //   这段文案本身就把「网关套件未启用、会话侧未注册」列为成因之一,
    //   用注册状态当判据会让最需要它的场景恰好拿不到它(实测被 it 档抓到)。
    // ★ 判据的取值来源须覆盖全部**实际注册**的实例名(任务 3.7,Req 6.5),不再是
    //   硬编码的单元素模块常量 —— 见 `gatewayProviderNames` 形参与其默认值的注释。
    if (gatewayProviderNames.includes(model.provider)) {
      throw new Error(
        `${base} — 该模型来自 ai-gateway 目录。常见成因:` +
          `(1) 网关套件未启用或凭据缺失,会话侧未注册该 provider;` +
          `(2) 目录快照已变化,该模型已从上游下线;` +
          `(3) 该条目并非对话模型(如 :batch 变体、embedding/tts),不可用于会话。`,
      );
    }
    throw new Error(base);
  }
  return found as SessionModel;
}
