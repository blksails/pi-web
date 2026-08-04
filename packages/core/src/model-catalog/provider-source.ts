/**
 * model-catalog · provider 来源契约与注册表(spec: multi-gateway-providers,任务 1.3;
 * design.md「core / ProviderSource 与 ProviderRegistry」组件块;
 * Req 1.1, 1.3, 1.5, 2.1, 2.3, 8.1, 8.2, 8.3)。
 *
 * `ProviderSource` 是「网关实例 / 本地模型配置 / 自定义 provider / 云端下发」四类来源
 * 的统一抽象(design.md「核心抽象:ProviderSource」)——多网关实例、自定义 provider、
 * 云端下发 provider 是同一问题的三个变体,不必各开一套装配逻辑。
 *
 * `ProviderRegistry` 在**组装期**(而非查询期)一次性做完:
 * - 汇总全部来源的 provider 定义(Req 2.1 单一标识空间);
 * - 标识唯一性校验,冲突则抛出含**全部**冲突标识与来源的错误(沿用 `provider-identity.ts`
 *   的 `findProviderIdConflicts`,任务 1.1 的产物);
 * - 按 `enabled` 过滤(`providers()`),同时保留按标识精确查找(`find()`)不受该过滤影响
 *   ——停用的 provider 仍应可查到其定义(Req 7.5:配置保留、模型消失是两件事)。
 *
 * ★ 契约要求 `ProviderSource.list()` 不得抛错(失败即空集并自记),但注册表在
 *   **组装侧**仍防御性地 try/catch 包一层——单个行为不合规的来源(意外抛错)不应
 *   牵连其余来源的正常注册(Req 1.5 的组装期落地;完成判据「单来源抛错不牵连其他来源」)。
 *
 * ★ Req 8 的落地方式:云端来源就是一个未被注册的 `ProviderSource` 实现位。未注册时
 *   `providers()`/`find()` 的输出与该来源不存在时逐字节一致(Req 8.2)——这是本抽象的
 *   自然性质,不需要额外代码分支。同名取舍(Req 8.3)由「组装时的注册顺序 + 冲突即报错」
 *   这一确定规则兜底,不随启动顺序产生歧义结果:后注册的重名来源使冲突校验直接失败,
 *   而不是静默地谁先谁赢。
 *
 * 纯组装模块:零 IO、零 env 读取——`list()` 的实现(读磁盘、发 HTTP)留给具体
 * `ProviderSource` 实现,本文件只负责契约与聚合。
 */
import type { Modality } from "./modality.js";
import { findProviderIdConflicts, type ProviderIdSource } from "./provider-identity.js";

/** 单个 provider 的定义;`models` 的具体条目形状由消费方(目录服务)决定,故取 `unknown`。 */
export interface ProviderDefinition<TModel = unknown> {
  readonly id: string;
  readonly displayName?: string;
  readonly enabled: boolean;
  /** provider 级类型声明;模型条目可细化覆盖(Req 4.6/4.7,由 `modality.ts` 落地)。 */
  readonly input?: readonly Modality[];
  readonly output?: readonly Modality[];
  readonly models: readonly TModel[];
}

/**
 * 一类 provider 来源(网关实例 / 本地模型配置 / 自定义 provider / 云端下发之一)。
 *
 * `sourceId` 与 provider id **不是同一回事**:一个来源可产出多个 provider(如一份
 * `providers` 配置域可登记多条自定义 provider),`sourceId` 只用于冲突报告与日志。
 */
export interface ProviderSource<TModel = unknown> {
  /** 来源身份,用于冲突报告与日志。 */
  readonly sourceId: string;
  /** 同步列出本来源当前的 provider 定义。不得抛错——失败即返回空集并自行记录。 */
  list(): readonly ProviderDefinition<TModel>[];
}

/** 组装完成的 provider 注册表:身份已唯一、可按启用态过滤、可按标识精确查找。 */
export interface ProviderRegistry<TModel = unknown> {
  /** 全部 provider(已做冲突校验,已按 `enabled` 过滤)。 */
  providers(): readonly ProviderDefinition<TModel>[];
  /** 按 id 精确查找,不受 `enabled` 过滤影响——停用的 provider 定义仍可查到(Req 7.5)。 */
  find(id: string): ProviderDefinition<TModel> | undefined;
}

/**
 * provider 标识冲突错误:携带**全部**冲突标识及其**全部**来源(Req 1.4 的组装期落地),
 * 供装配层在启动期一次性报出全部问题,而非遇到第一个即停。
 */
export class ProviderIdConflictError extends Error {
  constructor(public readonly conflicts: readonly { id: string; sources: readonly string[] }[]) {
    super(
      `provider id 冲突: ${conflicts
        .map((c) => `"${c.id}"(来源: ${c.sources.join(", ")})`)
        .join("; ")}`,
    );
    this.name = "ProviderIdConflictError";
  }
}

/**
 * 组装 provider 注册表:汇总全部来源、校验标识唯一性、按启用态过滤。
 *
 * 零来源时,`providers()`/`find()` 的输出与该来源不存在时逐字节一致(Req 8.2/10.1)——
 * 未传入任何 `sources` 与传入空数组是同一种「零来源」形态。
 */
export function createProviderRegistry<TModel = unknown>(
  sources: readonly ProviderSource<TModel>[],
): ProviderRegistry<TModel> {
  const byId = new Map<string, ProviderDefinition<TModel>>();
  const idSources: ProviderIdSource[] = [];

  for (const source of sources) {
    let definitions: readonly ProviderDefinition<TModel>[];
    try {
      definitions = source.list();
    } catch (err) {
      // 防御性兜底:契约要求 list() 不得抛错,但单个行为不合规的来源不应牵连其他来源
      // (Req 1.5)。视作该来源本轮为空集,并自记以便诊断(Req 10.2 精神的延伸)。
      console.error(
        `[model-catalog] ProviderSource "${source.sourceId}" 的 list() 抛出异常,视为空集: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      definitions = [];
    }

    for (const definition of definitions) {
      idSources.push({ id: definition.id, source: source.sourceId });
      byId.set(definition.id, definition);
    }
  }

  const conflicts = findProviderIdConflicts(idSources);
  if (conflicts.length > 0) {
    throw new ProviderIdConflictError(conflicts);
  }

  return {
    providers(): readonly ProviderDefinition<TModel>[] {
      return Array.from(byId.values()).filter((p) => p.enabled);
    },
    find(id: string): ProviderDefinition<TModel> | undefined {
      return byId.get(id);
    },
  };
}
