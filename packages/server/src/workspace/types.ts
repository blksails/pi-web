/**
 * 宿主状态存储端口 —— 类型契约与错误分类(spec: host-contract-ports,任务 1.3;
 * Req 2.1/2.2/3.4/4.1/9.1)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §3。本文件**只有类型与错误**,无任何实现,
 * 使两端(pi-clouds 的 TenantWorkspace / 桌面的 LocalWorkspace)可先据此实现,再由
 * 一致性套件统一验收。
 *
 * 边界(契约 §3 与 §0.2):
 *  - 只管**状态**。计算归 `RpcTransport`,网络归 `CapabilityProvider`。此边界写死,
 *    防止本端口演变为万能对象。
 *  - **不含**会话条目存储:那是「追加日志 + 索引」,与本端口的「文档存储」语义正交
 *    (需事务性幂等追加、按值字段索引查询、投影读与派生列,本端口一样都不提供)。
 *    见契约 §3.9。
 *  - **不含**附件字节:`BlobStore` 已是成熟可插拔端口,并入只是重复抽象。附件的
 *    **描述符**(JSON)才归本端口。
 *
 * pi-SDK-free:零外部依赖,可安全经 server 主 barrel 重导出。
 */
import { HOST_CONTRACT_VERSION } from "../host-contract-version.js";

/**
 * 键:`/` 分隔的**相对**路径,如 `settings.json`、`sources/<sourceKey>/settings.json`。
 *
 * ⚠ 键空间规则是**安全边界**而非便利检查:本地实现将键直接映射为真实路径,任何校验
 * 疏漏即为路径穿越。规则详见 `./key.js` 的 `validateWorkspaceKey`,由各实现在触及
 * 存储**之前**强制执行(Req 1.1)。
 */
export type WorkspaceKey = string;

/** 存储的值形态:JSON 对象(非数组、非标量)。 */
export type JsonObject = Readonly<Record<string, unknown>>;

/** 错误判别码。**跨边界一律按此判别,不用 `instanceof`**(见 {@link WorkspaceError})。 */
export type WorkspaceErrorCode = "key" | "limit" | "corrupt" | "io";

/**
 * 所有 Workspace 错误的共同基类,携带稳定的 {@link WorkspaceErrorCode} 判别式。
 *
 * ⚠ **判别一律用 `code`,不用 `instanceof`。** 一致性套件要跨仓运行(pi-clouds 引用
 * pi-web 导出的套件),跨包/跨仓时同名类可能来自不同模块实例,`instanceof` 会**假阴性**
 * ——测试看起来通过,实际什么都没验到。此结论与兄弟仓 `pi-clouds/packages/registry-client`
 * 的契约套件一致(其按 `RegistryError.code` 而非构造函数判定)。
 */
export abstract class WorkspaceError extends Error {
  abstract readonly code: WorkspaceErrorCode;
}

/** 键违反键空间规则(Req 1.1-1.4)。**这是安全边界**,调用方应视为编程错误而非可降级故障。 */
export class WorkspaceKeyError extends WorkspaceError {
  readonly code = "key" as const;
  constructor(
    public readonly key: string,
    public readonly reason: string,
  ) {
    super(`invalid workspace key ${JSON.stringify(key)}: ${reason}`);
    this.name = "WorkspaceKeyError";
  }
}

/** 写入值超过当前单键上限(Req 3.4)。只在**写**路径抛;读路径永不校验上限(Req 3.5)。 */
export class WorkspaceLimitError extends WorkspaceError {
  readonly code = "limit" as const;
  constructor(
    public readonly key: string,
    public readonly size: number,
    public readonly limit: number,
  ) {
    super(`workspace value too large for ${key}: ${size} bytes exceeds limit ${limit}`);
    this.name = "WorkspaceLimitError";
  }
}

/**
 * 既有值不是合法 JSON 对象(Req 2.2)。
 *
 * ⚠ 读取遇损坏**必须抛错**,不得静默返回 `{}`:那会让一次损坏被视作「空配置」,随后被
 * 下一次写入整体覆盖 —— 静默数据丢失。这是数据完整性问题,不是可用性问题。
 */
export class WorkspaceCorruptError extends WorkspaceError {
  readonly code = "corrupt" as const;
  constructor(
    public readonly key: string,
    // 刻意复用标准 `Error.cause`(ES2022)而非另起名字:调用方与日志工具对它已有共识。
    public override readonly cause?: unknown,
  ) {
    super(`workspace value at ${key} is not valid JSON`);
    this.name = "WorkspaceCorruptError";
  }
}

/** 后端 I/O 失败(权限、网络、磁盘等)。各 store 自定处置,多数应降级为空并记日志。 */
export class WorkspaceIoError extends WorkspaceError {
  readonly code = "io" as const;
  constructor(
    public readonly key: string,
    public override readonly cause?: unknown,
  ) {
    super(`workspace io failure at ${key}`);
    this.name = "WorkspaceIoError";
  }
}

/** `writeJson` 选项。 */
export interface WorkspaceWriteOptions {
  /**
   * 缺省 `true` = 与既有值**深度合并**(对象递归合并、数组整体替换、保留未涉及字段);
   * `false` = **整体覆盖**,使既有值中本次未提供的字段被删除(保留删除语义)。
   */
  readonly merge?: boolean;
}

/**
 * 单个命名空间的读写面。
 *
 * 语义保证(契约 §3.4,由一致性套件验收):
 *  - **单键原子可见性**:并发读者只见某次写入的完整值,绝不见部分写入(Req 2.6)。
 *  - **无跨键事务**:契约不提供,调用方不得依赖多键一致性。
 *  - **读己之写**:同实例内 `writeJson` resolve 后的 `readJson` 必见新值(Req 2.5)。
 */
export interface WorkspaceNamespace {
  /** 读 JSON 对象。键不存在 → `{}`(不抛,Req 2.1);既有值非法 → `WorkspaceCorruptError`(Req 2.2)。 */
  readJson(key: WorkspaceKey): Promise<JsonObject>;

  /** 写 JSON 对象。合并语义见 {@link WorkspaceWriteOptions}(Req 2.3/2.4);超限抛 `WorkspaceLimitError`(Req 3.4)。 */
  writeJson(
    key: WorkspaceKey,
    values: JsonObject,
    opts?: WorkspaceWriteOptions,
  ): Promise<void>;

  /**
   * 列出 `prefix` 下**直接子级中持有值的键**(Req 2.7)。
   * - 不递归;更深层结构(分组)**不返回、也不展开**。
   * - 返回顺序按键**字典序升序**,保证跨实现确定性。
   * - 无匹配 → `[]`。
   */
  list(prefix: WorkspaceKey): Promise<readonly WorkspaceKey[]>;

  /** 删除。键不存在 → **幂等成功**,不抛(Req 2.8)。 */
  delete(key: WorkspaceKey): Promise<void>;

  /** 存在性探测(Req 2.9)。 */
  exists(key: WorkspaceKey): Promise<boolean>;
}

/**
 * 宿主状态存储(双根)。
 *
 * ⚠ **两个根不可合并**(契约 §3.3):`user` 与 `project` 语义不同,per-source settings 的两个
 * scope 就分别落在两根上。v1 即固定为双命名空间——事后再加第二根会很痛。
 */
export interface Workspace {
  readonly contractVersion: typeof HOST_CONTRACT_VERSION;
  /** 用户级命名空间。本地对应 `<agentDir>`。 */
  readonly user: WorkspaceNamespace;
  /** 项目级命名空间。本地对应 `<cwd>/.pi`。 */
  readonly project: WorkspaceNamespace;
}
