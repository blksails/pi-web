/**
 * 网关实例三源合并(spec desktop-aigc-egress,任务 2.1;Req 1.2/6.1/6.2/6.3/6.4/9.4)。
 *
 * 网关实例此前只有一个来源(env)。本模块把来源扩展为三个,并在**一处**定序:
 *
 * ```
 * 使用者自填(providers.json)  >  环境配置(PI_WEB_GATEWAYS 等)  >  云端授予
 * ```
 *
 * 这个次序不是随手定的,它与 `cloud-defaults.ts` 已经写进注释的三条约束同源:随包固化的
 * 云端默认值「只是使用者还没表过态时的起点」,绝不能盖掉使用者在设置面板里改过的东西 ——
 * 否则改了保存也没用,而那种失效是**静默**的。授予排在最后是同一条道理的延伸。
 *
 * ## 为什么合并要独占一个模块
 *
 * 下游有三个消费点(模型目录聚合 / 网关转发路由 / 本地会话下发)共用同一份实例列表。定序
 * 若散落在它们各自那里,三处就会以不同的优先级看世界,而这种分歧只会在真机上以「设置页
 * 列得出、会话里选不到」的形态暴露 —— `multi-gateway-providers` 已经吃过一次同形态的亏。
 *
 * ## 让位必须可见
 *
 * 使用者配置压掉授予时,该事实经 {@link InstanceMergeResult.overriddenByUser} 返回。静默
 * 让位会让人对着一个「登录了但云端模型没出现」的界面无从下手(Req 6.3)。
 */
import {
  createGatewayCatalogs,
  grantedGatewayInstance,
  type CapabilityGatewayGrant,
  type GatewayInstanceConfig,
  type GatewayModelCatalog,
  type GatewayModelEntry,
} from "@blksails/pi-web-adapters/ai-gateway/index.js";

/** 三源合并的结果。 */
export interface InstanceMergeResult {
  /** 已定序、已去重的实例列表,直接交给下游三个消费点。 */
  readonly instances: readonly GatewayInstanceConfig[];
  /**
   * 因使用者自填配置优先而被让位的实例标识(Req 6.3)。
   *
   * 空数组 = 没有冲突。调用方应把非空结果**呈现**出来,不要只记日志 —— 这正是 Req 6.3
   * 要求「取舍对使用者可见」的那一项。
   */
  readonly overriddenByUser: readonly string[];
  /**
   * 云端授予因与 env 显式配置同名而未被采用的实例标识。
   *
   * 与 {@link overriddenByUser} **刻意分开**:这一类不是使用者的选择,而是部署方的显式
   * 配置更具体,属正常状态,不必向使用者呈现,但值得记一条诊断 —— 混进同一个字段会让
   * 「我改的设置生效了」和「部署方配置压过了云端」在界面上长得一模一样。
   */
  readonly grantShadowedByEnv: readonly string[];
}

/** {@link mergeGatewayInstanceSources} 的入参。 */
export interface InstanceMergeInput {
  /** 环境配置来源(既有 `resolveGatewayInstances` 的产物)。 */
  readonly fromEnv: readonly GatewayInstanceConfig[];
  /** 云端授予来源(`grantedGatewayInstance` 的产物);未登录 / 未授予时缺省。 */
  readonly fromGrant?: GatewayInstanceConfig;
  /**
   * 使用者在 `providers.json` 里自填的 provider 标识集合。
   *
   * 这里只要标识不要完整配置:自定义 provider 走的是**另一条**装配路径
   * (`customProviders` 注入模型目录服务),本模块不负责把它们变成网关实例 ——
   * 只负责在标识相撞时让路。职责越界会造出第二条自定义 provider 装配链。
   */
  readonly userConfiguredIds: ReadonlySet<string>;
}

/**
 * 合并三个来源的网关实例。
 *
 * 不变式:
 * 1. **无授予且无使用者覆盖时,结果与 `fromEnv` 逐元素相等**(Req 1.2 的零变化保证)。
 * 2. 同标识只保留一个,按上述优先级取胜者。
 * 3. 不抛异常 —— 任何一路来源不可用都只是少一个实例。
 */
export function mergeGatewayInstanceSources(
  input: InstanceMergeInput,
): InstanceMergeResult {
  const { fromEnv, fromGrant, userConfiguredIds } = input;
  const overriddenByUser: string[] = [];
  const grantShadowedByEnv: string[] = [];
  const byId = new Map<string, GatewayInstanceConfig>();

  // env 来源先入。使用者自填同名 → 让位(使用者优先)。
  for (const inst of fromEnv) {
    if (userConfiguredIds.has(inst.id)) {
      overriddenByUser.push(inst.id);
      continue;
    }
    // 同一 env 列表内的重复标识由上游解析层负责,此处后者不覆盖前者,保持既有顺序语义。
    if (!byId.has(inst.id)) byId.set(inst.id, inst);
  }

  // 授予最后入:被使用者自填或 env 占用的标识一律不覆盖。
  if (fromGrant !== undefined) {
    if (userConfiguredIds.has(fromGrant.id)) {
      overriddenByUser.push(fromGrant.id);
    } else if (!byId.has(fromGrant.id)) {
      byId.set(fromGrant.id, fromGrant);
    } else {
      // env 已声明同名实例 → env 胜(它是部署方的显式配置,比账号级授予更具体)。
      grantShadowedByEnv.push(fromGrant.id);
    }
  }

  return {
    instances: [...byId.values()],
    overriddenByUser,
    grantShadowedByEnv,
  };
}

// ── 惰性求值运行时 ───────────────────────────────────────────────────────────

/** {@link GrantedGatewayRuntime.current} 的返回。 */
export interface GrantedGatewayView extends InstanceMergeResult {
  /** 与 {@link InstanceMergeResult.instances} 一一对应的目录聚合器。 */
  readonly catalogs: ReadonlyMap<string, GatewayModelCatalog>;
  /**
   * 云端声明的图像模型清单,按实例标识索引(spec desktop-aigc-egress 任务 3.1)。
   *
   * 只有**授予来源**的实例可能有条目 —— env 来源的网关实例没有图像声明这一概念。
   * 键不存在 = 未声明 → 消费方回退内置白名单;值为空数组 = 明确声明没有。
   *
   * ★ 不放进 `GatewayInstanceConfig`:那是 env 域的类型,加一个只有授予来源才有的字段
   *   会让 env 解析路径凭空多出一个永远为 undefined 的成员。
   */
  readonly imageModelsByInstance: ReadonlyMap<string, readonly string[]>;
}

/**
 * 按当前登录态求值的网关实例视图。
 *
 * ## ★ 为什么不能在装配期求值一次
 *
 * 登录态(`AuthSessionState`)是**运行期可变**的进程级单例:鉴权端点写、会话 spawn 读。
 * 若在装配期把实例列表算死,用户登录之后它**永远不会更新** —— 表现为"登录了但云端模型
 * 一个也没出现,重启才有",直接违反 Req 4.3;登出后同理不失效,违反 Req 8.4。
 *
 * 本设计初版正是画在装配期的,这一条在实施期核实 `AuthSessionState` 语义时才发现,已回改
 * 至 design.md。
 *
 * ## 缓存键必须含凭据指纹
 *
 * 目录快照按实例缓存。若只以"有没有授予"为键,切号后会复用**上一个账号**的目录,而那份
 * 目录是按上一把 key 的可见性拉的 —— 既是信息泄露,也会让新账号看到自己用不了的模型。
 */
export interface GrantedGatewayRuntime {
  /** 按当前登录态求值;凭据与授予未变时复用上次结果及其目录快照。 */
  current(): GrantedGatewayView;
}

/** {@link createGrantedGatewayRuntime} 的依赖。 */
export interface GrantedGatewayRuntimeDeps {
  /** env 来源实例(装配期解析一次即可,它不随登录态变化)。 */
  readonly fromEnv: readonly GatewayInstanceConfig[];
  /** env 来源实例对应的目录聚合器(装配期建好,原样复用)。 */
  readonly envCatalogs: ReadonlyMap<string, GatewayModelCatalog>;
  /** 取当前有效桌面凭据;未登录/已过期 → `undefined`。 */
  readonly getCredential: () => string | undefined;
  /** 取当前网关授予;未启用/未拿到 → `undefined`。 */
  readonly getGrant: () => CapabilityGatewayGrant | undefined;
  /** 取使用者自填的 provider 标识集合。 */
  readonly getUserConfiguredIds: () => ReadonlySet<string>;
  /** 供测试注入(建授予实例的目录聚合器)。 */
  readonly createCatalogs?: typeof createGatewayCatalogs;
}

/** 缓存标识:凭据 + 授予地址 + 图像清单 + 使用者标识集合,任一变化即重建。 */
function cacheKeyOf(
  credential: string | undefined,
  grant: CapabilityGatewayGrant | undefined,
  userIds: ReadonlySet<string>,
): string {
  return JSON.stringify([
    credential ?? null,
    grant?.baseUrl ?? null,
    grant?.imageModels ?? null,
    [...userIds].sort(),
  ]);
}

/**
 * 建立惰性视图。
 *
 * 授予不可用(未登录 / 无授予 / 转换失败)时退化为纯 env 结果,与本特性引入前逐元素相等
 * (Req 1.2)。
 */
export function createGrantedGatewayRuntime(
  deps: GrantedGatewayRuntimeDeps,
): GrantedGatewayRuntime {
  const makeCatalogs = deps.createCatalogs ?? createGatewayCatalogs;
  let cachedKey: string | undefined;
  let cached: GrantedGatewayView | undefined;

  return {
    current(): GrantedGatewayView {
      const credential = deps.getCredential();
      const grant = deps.getGrant();
      const userIds = deps.getUserConfiguredIds();
      const key = cacheKeyOf(credential, grant, userIds);
      if (cached !== undefined && cachedKey === key) return cached;

      const grantInstance =
        credential !== undefined && grant !== undefined
          ? grantedGatewayInstance({ grant, credential })
          : undefined;

      const merged = mergeGatewayInstanceSources({
        fromEnv: deps.fromEnv,
        ...(grantInstance !== undefined ? { fromGrant: grantInstance } : {}),
        userConfiguredIds: userIds,
      });

      // env 实例复用装配期建好的目录(保住既有的 TTL 快照,别每次登录态变化都清空它);
      // 只为真正被采用的授予实例新建。
      const catalogs = new Map<string, GatewayModelCatalog>();
      for (const inst of merged.instances) {
        const existing = deps.envCatalogs.get(inst.id);
        if (existing !== undefined) {
          catalogs.set(inst.id, existing);
          continue;
        }
        const built = makeCatalogs([inst]).get(inst.id);
        if (built !== undefined) catalogs.set(inst.id, built);
      }

      // 图像清单只随授予而来,且只在该授予实例真的被采用时才有意义(被使用者配置或 env
      // 让位掉的授予,其图像声明也一并作废)。
      const imageModelsByInstance = new Map<string, readonly string[]>();
      if (
        grantInstance !== undefined &&
        grant?.imageModels !== undefined &&
        merged.instances.some((i) => i.id === grantInstance.id)
      ) {
        imageModelsByInstance.set(grantInstance.id, grant.imageModels);
      }

      cached = { ...merged, catalogs, imageModelsByInstance };
      cachedKey = key;
      return cached;
    },
  };
}

// ── 会话下发 ────────────────────────────────────────────────────────────────

/** 单个实例下发给 runner 的最小信息(与 `computeAiGatewaySessionsSpawnEnv` 的入参同形)。 */
export interface SessionSpawnInstance {
  readonly instanceId: string;
  readonly baseUrl: string;
  /** `undefined`/空白 → 下游视该实例未启用(fail-soft),与 env 来源同规。 */
  readonly apiKey: string | undefined;
  readonly catalog: readonly GatewayModelEntry[];
  /** 云端声明的图像清单;`undefined` = 未声明(回退内置白名单)。 */
  readonly imageModelIds?: readonly string[];
}

/**
 * 把当前视图折成会话下发条目(spec desktop-aigc-egress 任务 2.2)。
 *
 * ★ **凭据来源二选一,顺序不能反**:实例自身带凭据(授予来源,值是桌面凭据)则直接用;
 *   否则才回 env 解析(env 来源实例的既有路径)。反过来写会让授予实例去 env 里找一把
 *   根本不存在的 key,解析出空串后被 `computeAiGatewaySessionsSpawnEnv` 判为"无凭据"
 *   而**静默跳过** —— 表现为登录了、目录里也有模型,一选就"模型未找到"。
 *
 * @param resolveEnvApiKey env 来源实例的凭据解析(装配处注入既有的同步解析器)。
 */
export function toSessionSpawnInstances(
  view: GrantedGatewayView,
  resolveEnvApiKey: (inst: GatewayInstanceConfig) => string | undefined,
): readonly SessionSpawnInstance[] {
  return view.instances.map((inst) => {
    const imageModelIds = view.imageModelsByInstance.get(inst.id);
    return {
      instanceId: inst.id,
      baseUrl: inst.baseUrl,
      apiKey: inst.apiKey.length > 0 ? inst.apiKey : resolveEnvApiKey(inst),
      catalog: view.catalogs.get(inst.id)?.get() ?? [],
      // 键不存在 → 不带该字段(未声明);存在(含空数组)→ 原样下发。
      ...(imageModelIds !== undefined ? { imageModelIds } : {}),
    };
  });
}
