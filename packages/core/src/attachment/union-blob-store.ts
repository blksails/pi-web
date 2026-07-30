/**
 * attachment · `UnionBlobStore` 组合后端(`attachment-backend-pluggable` spec,任务 3.1/3.2)。
 *
 * 对门面呈现为单一 {@link BlobStore},内部组合多个具名后端:
 * - **写路由**:`writePolicy` 选定单一后端落字节,回执报告后端名(供门面固化进描述符,Req 3.1);
 * - **读路由**:描述符权威(`resolveBackendName` 命中即只走该后端)+ 迁移期探测链(未命中按
 *   声明顺序探测,吞 `BlobNotFoundError` 续试,其余错误直抛,全部未命中抛 `BlobNotFoundError`,
 *   Req 4.1/4.2);
 * - **绑定失配**:描述符指向未注册的后端名 → 抛出含后端名的配置错误,不静默降级为探测(Req 4.3);
 * - **删除双路径**:有绑定删绑定后端;无绑定对全部后端幂等删(Req 7.1/7.2)。
 *
 * union 本身不持久化路由状态(不变式:描述符就是持久化的路由权威),经注入的
 * `resolveBackendName` 查询——由 config 工厂接到 registry,避免 union 依赖 registry 类型
 * (design.md §UnionBlobStore(核心契约))。
 */
import {
  BlobNotFoundError,
  type BlobMeta,
  type BlobStore,
  type PutOptions,
  type PutReceipt,
} from "./blob-store.js";

/** 具名后端条目(名字 = 描述符 `backend` 字段取值域;顺序 = 探测链顺序)。 */
export interface NamedBackend {
  readonly name: string;
  readonly store: BlobStore;
}

/** 写路由策略:按元数据选后端名;返回未注册名字 → `put` 抛错(配置错误尽早暴露)。 */
export type WritePolicy = (meta: BlobMeta) => string;

export interface UnionBlobStoreDeps {
  /** 至少一个;顺序 = 迁移期探测链顺序。 */
  readonly backends: readonly NamedBackend[];
  /** 写路由;缺省恒选 `backends[0]`(primary)。 */
  readonly writePolicy?: WritePolicy;
  /**
   * 读路由权威:key → 落库时固化的后端名(config 工厂接 registry:
   * `(key) => registry.get(key).then((d) => d?.backend)`)。
   * 返回 `undefined` = 历史对象/描述符缺失 → 走探测链。
   */
  readonly resolveBackendName: (key: string) => Promise<string | undefined>;
}

/**
 * 绑定的后端名未在当前拓扑中注册(配置错误,不静默降级为探测,Req 4.3)。
 */
export class UnknownBackendBindingError extends Error {
  constructor(public readonly backendName: string, public readonly key: string) {
    super(
      `UnionBlobStore: descriptor for "${key}" is bound to unconfigured backend "${backendName}"`,
    );
    this.name = "UnknownBackendBindingError";
  }
}

/**
 * 组合多个 `BlobStore` 的联合后端。对门面呈现为单一 `BlobStore`:
 * - `put`:`writePolicy` 选一个后端落字节,回执报告后端名(门面固化进描述符);
 * - 读路径:优先描述符路由;缺省(迁移期)按声明顺序探测,吞 `BlobNotFoundError` 直到命中;
 * - `delete`:幂等语义(端口契约),路由命中删对应后端,缺省对全部后端幂等删。
 */
export class UnionBlobStore implements BlobStore {
  private readonly byName: ReadonlyMap<string, BlobStore>;
  private readonly ordered: readonly NamedBackend[];
  private readonly writePolicy: WritePolicy;
  private readonly resolveBackendName: (key: string) => Promise<string | undefined>;

  constructor(deps: UnionBlobStoreDeps) {
    if (deps.backends.length === 0) {
      throw new Error("UnionBlobStore: backends must be non-empty");
    }
    const names = new Set(deps.backends.map((b) => b.name));
    if (names.size !== deps.backends.length) {
      throw new Error("UnionBlobStore: duplicate backend name");
    }
    this.ordered = deps.backends;
    this.byName = new Map(deps.backends.map((b) => [b.name, b.store]));
    this.writePolicy = deps.writePolicy ?? (() => deps.backends[0]!.name);
    this.resolveBackendName = deps.resolveBackendName;
  }

  async put(
    key: string,
    body: Uint8Array | NodeJS.ReadableStream,
    meta: BlobMeta,
    opts?: PutOptions,
  ): Promise<PutReceipt> {
    // per-call 写目标覆盖优先于 writePolicy(agent-attachment-profile spec,Req 3.1/3.3);
    // 未注册名字与 writePolicy 越权同一语义:throw(配置/调用错误尽早暴露)。
    const name = opts?.writeBackend ?? this.writePolicy(meta);
    const target = this.byName.get(name);
    if (target === undefined) {
      throw new Error(`UnionBlobStore: writePolicy chose unknown backend "${name}"`);
    }
    await target.put(key, body, meta);
    return { backendName: name };
  }

  async getReadStream(
    key: string,
  ): Promise<{ stream: NodeJS.ReadableStream; meta: BlobMeta }> {
    return this.route(key, (s) => s.getReadStream(key));
  }

  async head(key: string): Promise<BlobMeta> {
    return this.route(key, (s) => s.head(key));
  }

  async presignUrl(key: string, opts?: { expiresInMs?: number }): Promise<string> {
    // 混合语义天然成立:本地后端签 /raw URL,S3 后端 presign 直链,按对象各走各的。
    return this.route(key, (s) => s.presignUrl(key, opts));
  }

  async delete(key: string): Promise<void> {
    const name = await this.resolveBackendName(key);
    if (name !== undefined) {
      await this.byName.get(name)?.delete(key);
      return;
    }
    // 无路由信息(历史对象/回滚场景):对全部后端幂等删(端口契约:不存在不抛,Req 7.2)。
    for (const b of this.ordered) await b.store.delete(key);
  }

  /** 读路由:描述符权威 → 命中后端;缺省走声明顺序探测链(仅迁移期路径)。 */
  private async route<T>(key: string, op: (s: BlobStore) => Promise<T>): Promise<T> {
    const name = await this.resolveBackendName(key);
    if (name !== undefined) {
      const target = this.byName.get(name);
      // 描述符指向已被运维摘除的后端 → 明确报错,不静默探测(配置错误可见,Req 4.3)。
      if (target === undefined) throw new UnknownBackendBindingError(name, key);
      return op(target);
    }
    for (const b of this.ordered) {
      try {
        return await op(b.store);
      } catch (err) {
        if (err instanceof BlobNotFoundError) continue;
        throw err;
      }
    }
    throw new BlobNotFoundError(key);
  }
}
