/**
 * ai-gateway · Key 解析(design.md §2.2,Req Story 3)。
 *
 * `KeyResolver` 接口把「该请求应使用哪把 sk-gw key」抽成可演进的接缝:P0
 * `EnvKeyResolver` 从宿主 env 请求期即时读取单一平台 key(不缓存,换 key 即时生效);
 * P1 `PerUserKeyResolver` 只占位(接口签名携带用户标识入参),本期不实现查表逻辑,
 * 装配处不接线。
 *
 * 真实 key 只在 server 进程内存中流转(resolve 的返回值),调用方(routes.ts)用后即弃,
 * 不落任何下发给浏览器的配置/状态(Req 3.4)。
 */

/** `KeyResolver.resolve` 的入参。 */
export interface KeyResolveInput {
  /** 会话用户(Supabase uuid);匿名/未启用多租户时为 `undefined`。 */
  readonly userId?: string;
}

/** Key 解析接口(design.md §2.2)。 */
export interface KeyResolver {
  /** 解析该请求应使用的 sk-gw key;`undefined` = 无凭据(路由层 → 502)。 */
  resolve(input: KeyResolveInput): Promise<string | undefined>;
}

/**
 * P0 实现:请求期即时读取宿主 env `BLKSAILS_GATEWAY_API_KEY`(旧名 `AI_GATEWAY_API_KEY`
 * 回落,Req 3.1)。
 *
 * 不在构造期捕获 env 快照——每次 `resolve` 调用都重新读取传入的 `env` 引用,故运维原地
 * 替换该 env(或注入的等价源)后,下一次请求立即生效,不需要重启进程或重建实例。
 */
export class EnvKeyResolver implements KeyResolver {
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env;
  }

  async resolve(_input: KeyResolveInput): Promise<string | undefined> {
    // 新名优先,旧名回落(存量部署)。改名理由见 config.ts 的
    // AI_GATEWAY_BASE_URL_ENV_LEGACY 注释:旧名会被 pi 子进程继承并劫持模型调用。
    const raw =
      this.env.BLKSAILS_GATEWAY_API_KEY ?? this.env.AI_GATEWAY_API_KEY;
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
}

/**
 * P1 占位:按会话用户查 per-user key(本期不实现查表逻辑)。
 *
 * 构造入参预留一个「store」接缝(键为 `userId`,值为已发放给该用户的 sk-gw key),仅用于
 * 把未来查表依赖的形状固化到类型系统里;`resolve` 本期直接抛 `NotImplementedError`——
 * 装配处不得实例化/接线本类(仅保证接口形状被类型检查覆盖,design.md §2.2)。
 */
export class PerUserKeyResolver implements KeyResolver {
  constructor(
    private readonly store?: {
      lookup(userId: string): Promise<string | undefined>;
    },
  ) {}

  async resolve(_input: KeyResolveInput): Promise<string | undefined> {
    void this.store;
    throw new NotImplementedError(
      "PerUserKeyResolver is a P1 placeholder and is not implemented yet.",
    );
  }
}

/** `PerUserKeyResolver.resolve` 尚未实现时抛出的错误类型。 */
export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}
