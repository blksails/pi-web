/**
 * model-catalog · Visibility Filter —— provider 与模型在**展示清单**中的可见性过滤
 * (provider-visibility-config spec design.md「Core / 过滤器」组件块,Req 2.1, 2.2,
 * 4.2–4.4, 7.1, 7.4)。
 *
 * ★ 与 `service.ts` 内部的 `hiddenProviders`(`PI_WEB_HIDE_PROVIDERS`)是**两回事**:
 * 那一套是 multi-gateway-providers Req 5 的「彻底禁用」——被禁的 provider 连工具
 * schema 都没有;本模块是「仅从清单隐藏」,只作用于展示出口的产出,已有会话与工具
 * 照常可用。两者层次分明:彻底禁用在服务**内部**生效,可见性过滤在服务**外部**、
 * 更靠近出口。本模块因此不改 `service.ts` 一个字节(design.md「Out of Boundary」)。
 *
 * 纯函数、零状态、零 IO。配置形态是**稀疏的否定式声明**:只记录被隐藏的东西,
 * 于是「默认全展示」与「目录新增的模型自动可见」成为结构性质,而不是需要维护的
 * 同步逻辑(Req 4.3, 4.4)。
 */

/** 单个 provider 的可见性配置(黑名单式;缺省即全展示)。 */
export interface ProviderVisibility {
  /** true = 从展示清单中隐藏该 provider(不影响工具与已有会话)。 */
  readonly hidden?: boolean;
  /** 被勾掉的模型 id;不在此列的一律展示,含目录后来新增的模型(Req 4.4)。 */
  readonly hiddenModels?: readonly string[];
}

/** 以 provider 标识为键。 */
export type ProviderVisibilityConfig = Readonly<Record<string, ProviderVisibility>>;

/** 过滤器能处理的模型条目最小形状(`ModelOption` 与 `CatalogModel` 都满足)。 */
interface VisibilityModelShape {
  readonly provider: string;
  readonly id: string;
}

/** 过滤器能处理的结果最小形状(`ModelOptions` 与 `CatalogQueryResult` 都满足)。 */
interface VisibilityResultShape<M extends VisibilityModelShape> {
  readonly providers: readonly string[];
  readonly models: readonly M[];
}

/**
 * 空配置判据:无键,或全部键都既未隐藏 provider 也未勾掉任何模型。
 *
 * 「有键但内容为空」也算空 —— 界面把某 provider 打开又关上会留下 `{}` 这样的
 * 空壳条目,若不视作空,零侵入承诺(Req 7.1)会被一次无意义的编辑破坏。
 */
export function isVisibilityEmpty(cfg: ProviderVisibilityConfig | undefined): boolean {
  if (cfg === undefined) return true;
  for (const entry of Object.values(cfg)) {
    if (entry === undefined || entry === null) continue;
    if (entry.hidden === true) return false;
    if (entry.hiddenModels !== undefined && entry.hiddenModels.length > 0) return false;
  }
  return true;
}

/**
 * 只过滤模型清单本身(不含 `providers` 列表)的宽松形态版本。
 *
 * 形态放宽到 `provider?: unknown` / `id?: unknown`,与既有 `excludeProviderModels`
 * 一致 —— 会话侧 `get_available_models` 的条目来自 agent 上游,形状不由本产品保证。
 * 非字符串的 provider/id 一律视为「无法判定」而**保留**,宁可多显示也不误删。
 *
 * 空配置同样返回入参同一引用(零侵入判据,Req 7.1)。
 */
export function filterVisibleModels<
  T extends { readonly provider?: unknown; readonly id?: unknown },
>(models: readonly T[], cfg: ProviderVisibilityConfig | undefined): readonly T[] {
  if (isVisibilityEmpty(cfg) || cfg === undefined) return models;

  const filtered = models.filter((model) => {
    if (typeof model.provider !== "string") return true;
    const entry = cfg[model.provider];
    if (entry === undefined || entry === null) return true;
    if (entry.hidden === true) return false;
    if (typeof model.id !== "string") return true;
    return entry.hiddenModels?.includes(model.id) !== true;
  });

  return filtered.length === models.length ? models : filtered;
}

/**
 * 对 `{providers, models}` 形态的展示结果套用可见性过滤。
 *
 * ★ 空配置时返回**入参同一引用**,不是内容相等的新对象 —— 这是 Req 7.1
 * 「未配置时与引入前一致」的机械判据:测试用引用相等(`toBe`)断言即可证明零侵入,
 * 不必逐字段比对。既有的 `chatOptions()` 零筛选路径本就承诺字节兼容
 * (multi-gateway-providers Req 10.1),这条保证使本特性叠加其上仍然成立。
 *
 * `providers` 列表按过滤后的 `models` 重算,而非按配置直接删键 —— 这样配置里
 * 引用了已消失的 provider 或模型时会自然失效,不牵连其余条目(Req 7.4)。
 */
export function applyProviderVisibility<
  M extends VisibilityModelShape,
  R extends VisibilityResultShape<M>,
>(result: R, cfg: ProviderVisibilityConfig | undefined): R {
  if (isVisibilityEmpty(cfg) || cfg === undefined) return result;

  const models = filterVisibleModels(result.models, cfg);
  if (models === result.models) return result;

  // providers 由剩余 models 反推:某 provider 的模型被逐条勾光时,它也随之从
  // provider 列表消失,与「隐藏该 provider」殊途同归,界面无须再做一次收敛。
  const remaining = new Set(models.map((model) => model.provider));
  const providers = result.providers.filter((provider) => remaining.has(provider));

  return { ...result, models, providers };
}
