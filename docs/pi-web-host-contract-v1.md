# pi-web 宿主契约 v1（中间标准）

> 状态：**v1 已冻结**（2026-07-21，§9 四项决议全部拍板）。后续变更走 §1 版本流程。
> 两端可据此开工。
> 设计动机与取舍见 `docs/desktop-cloud-integration-design.md`；**本文只定契约，不重复论证**。
>
> **地位**：pi-web 是中间标准，pi-clouds（云端宿主）与 desktop（桌面宿主）是两端。
> 两端一律**只实现本文定义的端口**，不得改 `packages/*`。本文冻结后，两端可并行开工。

---

## 0. 契约边界

### 0.1 契约覆盖什么

**Layer 1 · 控制面**：宿主状态（JSON）、能力授予、能力面装配、配置域注册。

### 0.2 契约明确**不**覆盖什么

| 不在契约内 | 原因 | 归属 |
|---|---|---|
| agent 运行时的真实文件系统（`cwd`、真实 `agentDir`、`auth.json`、`models.json`、`npm/node_modules`、`git/`） | pi SDK 与 jiti 直接做 fs I/O，pi-web 只递路径；**不可虚拟化** | Layer 2，走 `RpcTransport`（已有端口） |
| 附件**字节**存储 | 已有成熟可插拔端口（`BlobStore` + `UnionBlobStore`，三个 backend kind），并入只会重复抽象 | `BlobStore`（保持独立） |
| **会话条目存储** | **语义正交**：Workspace 是文档存储（整值读写、无事务、按键前缀列）；会话条目是**追加日志 + 索引**（流式读、幂等追加、按值字段查询）。见 §3.9 | `SessionEntryStore`（保持独立） |
| 进程 spawn 与传输 | 已有 `RpcTransport` 端口 | Layer 2 |

**注意附件的切分线**：**描述符（JSON）进 Workspace，字节留 `BlobStore`。** 这条线与集成设计 §6.4 推荐的「描述符本地、字节上云」是同一条线——不是巧合，是同一个分层。

---

## 1. 版本与兼容

- 契约版本 `1`，导出常量 `HOST_CONTRACT_VERSION = 1`。
- **仅允许增量演进**：加可选成员、加新端口。
- 任何以下改动都是破坏性的，必须升 v2：改方法签名、改语义、把可选改必填、收紧既有输入域。
- 两端实现须声明所实现的契约版本；宿主装配期比对，不符即**拒绝启动**（不降级）。

---

## 2. 契约总览

| # | 端口 | 职责 | 两端是否必须实现 |
|---|---|---|---|
| P1 | `Workspace` | 宿主状态的读写底座 | **必须** |
| P2 | `CapabilityProvider` | 能力授予（egress / sources / attachments / tenant） | 云端可选；桌面必须 |
| P3 | `CapabilityDescriptor` + `defaultCapabilities()` | 能力面装配清单 | **必须显式表态** |
| P4 | `ConfigDomainRegistry` | 配置域注册 | 可选（默认注册内建域） |

---

## 3. P1 · `Workspace`

### 3.1 接口

```ts
export const HOST_CONTRACT_VERSION = 1;

/** 键：`/` 分隔的相对路径。见 §3.2 键空间规则。 */
export type WorkspaceKey = string;

export interface WorkspaceNamespace {
  /** 读 JSON 对象。键不存在 → 返回 `{}`（**不抛**）。 */
  readJson(key: WorkspaceKey): Promise<Record<string, unknown>>;

  /**
   * 写 JSON 对象。
   * - `merge` 缺省 `true`：与现有值 deepMerge（保留未知字段）
   * - `merge: false`：整体覆盖（保留删除语义）
   * 必须对**单键**保证原子可见性（§3.4）。
   */
  writeJson(
    key: WorkspaceKey,
    values: Record<string, unknown>,
    opts?: { readonly merge?: boolean },
  ): Promise<void>;

  /** 列出 `prefix` 下的直接子键（不递归）。无匹配 → `[]`。 */
  list(prefix: WorkspaceKey): Promise<readonly WorkspaceKey[]>;

  /** 删除。键不存在 → **幂等成功**，不抛。 */
  delete(key: WorkspaceKey): Promise<void>;

  /** 存在性探测。不读取内容。 */
  exists(key: WorkspaceKey): Promise<boolean>;
}

export interface Workspace {
  readonly contractVersion: 1;
  /** 用户级命名空间。本地对应 `<agentDir>`。 */
  readonly user: WorkspaceNamespace;
  /** 项目级命名空间。本地对应 `<cwd>/.pi`。 */
  readonly project: WorkspaceNamespace;
}
```

### 3.2 键空间规则（**必须**由实现强制）

1. 键是相对路径，段以 `/` 分隔：`settings.json`、`sources/<sourceKey>/settings.json`。
2. **禁止**：绝对路径（前导 `/`）、`.` 或 `..` 段、空段（`//`）、NUL、反斜杠。
3. 违反 → 抛 `WorkspaceKeyError`。**这是安全边界，不是便利检查**——本地实现落到真实路径，键即路径。
4. 键**大小写敏感**。实现若落在大小写不敏感的文件系统上，须自行保证不产生别名冲突。
5. 单键值有上限（JSON 序列化后字节数），**默认 1 MiB**，经 env 可配。超限抛 `WorkspaceLimitError`。详见 §3.2.1。

### 3.2.1 单键值上限（可配）

| 项 | 规定 |
|---|---|
| env | `PI_WEB_WORKSPACE_MAX_VALUE_BYTES` |
| 默认 | `1048576`（1 MiB） |
| 取值 | 正整数字节数。非法（非数字 / ≤0 / 非整数）→ **装配期 fail-fast 抛错**，不静默回落默认（沿用 `resolveCloudLoginConfig` 的既有惯例） |
| 计量 | `JSON.stringify(values)` 的 UTF-8 字节数 |

**❗ 只在写时校验，读时不校验。**

这条是强制的，不是实现自由。若 `readJson` 也校验，那么把上限**调小**之后，已存在的超限值会变成读不出来——数据在磁盘上但不可达，且用户无从修复（想改小它必须先读到它）。所以：

- `writeJson` 超限 → 抛 `WorkspaceLimitError`
- `readJson` 无论多大都必须能读回

**⚠️ 可移植性警告**：两端上限不一致时，一端写下的值可能在另一端**写不回去**（读没问题）。桌面与云端若要互通同一份数据，应配相同上限。

> ⚠️ `sourceKey` 必须是 16 位 hex 的校验**留在调用方**（现 `config/source-settings-codec.ts:15-18`），不得随文件系统实现一起消失——端口化后没有 fs，但该校验仍是防越权的必要条件。

### 3.3 两个根不可合并

`user` 与 `project` 语义不同，**接口从一开始就是双命名空间**。per-source settings 的两个 scope 分别落在两根上：

| scope | 命名空间 | 键 |
|---|---|---|
| `source` | `user` | `sources/<sourceKey>/settings.json` |
| `project` | `project` | `source-settings/<sourceKey>.json` |

事后再加第二根会很痛，故 v1 即固定。

### 3.4 语义保证（**实现必须满足**）

| 保证 | 说明 |
|---|---|
| **单键原子可见性** | 并发读者只能看到写前或写后的完整值，不得看到部分写入。本地实现须 write-temp + rename |
| **无跨键事务** | 契约**不提供**。调用方不得依赖多键一致性 |
| **读己之写** | 同一 `Workspace` 实例内，`writeJson` resolve 后的 `readJson` 必须看到新值 |
| **deepMerge 语义** | 与现 `ConfigCodec` 一致：对象递归合并，数组整体替换，`undefined` 值忽略 |
| **`merge:false` 保留删除** | 覆盖写，缺失的键即被删除 |
| **`readJson` 容错** | 键不存在 → `{}`；内容非法 JSON → 抛 `WorkspaceCorruptError`（**不静默返回 `{}`**，否则损坏会被当成空配置而覆盖掉） |

### 3.5 本地实现的额外义务

`LocalWorkspace` 必须是**今天行为的逐字节等价物**：

- 目录 `0700`、文件 `0600`（现 `config-codec.ts:98-107`）
- `user` 根 = `PI_WEB_AGENT_DIR ?? ~/.pi/agent`
- `project` 根 = `<cwd>/.pi`

**若迁移后本地行为有任何可观测变化，即为迁移缺陷，不是契约需要放宽。**

### 3.6 错误类型

```ts
export class WorkspaceKeyError extends Error {}      // 键非法（安全边界）
export class WorkspaceLimitError extends Error {}    // 超限
export class WorkspaceCorruptError extends Error {}  // 现有值非法 JSON
export class WorkspaceIoError extends Error {}       // 后端 I/O 失败（含权限、网络）
```

调用方对 `WorkspaceIoError` 的处置由各 store 自定（多数应降级为空并记日志，不得把 500 透给前端——沿用 `vision-models-routes.ts:11` 的既有惯例）。

### 3.7 建在 Workspace 之上的既有端口

这些端口**保留各自的类型化接口不变**，只是默认实现改建在 `Workspace` 上。**云端实现 1 个 `Workspace`，白拿下表全部七项。**

| 端口 | 命名空间 | 键 |
|---|---|---|
| `ConfigStore`（由 `ConfigCodec` 降级而来） | `user` | `<domain>.json` |
| per-source settings | `user` / `project` | 见 §3.3 |
| `FavoritesStore`（agent source 收藏） | `user` | `agent-source-favorites.json` |
| `SessionFavoritesStore`（会话收藏） | `user` | `session-favorites.json` |
| `AttachmentRegistryPort`（**描述符**） | `user` | `attachments/<id>.att.json` |
| trust store | `user` | `trust-store.json` |
| sources 注册表 | `user` | `sources.json` |

### 3.9 ❌ `SessionEntryStore` **不迁** Workspace（三个后端都不迁）

**理由是语义正交，不是"重复抽象"。** Workspace 给不了它需要的三样能力：

| 它需要 | 证据 | Workspace 为何给不了 |
|---|---|---|
| **事务性幂等追加** | `PRIMARY KEY (session_id, id)` + `ON CONFLICT DO NOTHING`（`sqlite-store.ts:44`）；`appendBatch` 批次在事务内 | 契约**不提供跨键事务**（§3.4）；`writeJson` 是整值写，追加一条要 read-modify-write 整会话，O(n) 且并发不安全 |
| **按值字段索引查询** | `SELECT … FROM sessions WHERE cwd = ? ORDER BY created_at`（`sqlite-store.ts:155`） | `list(prefix)` 只能按**键前缀**列，不能按**值里的字段**过滤排序 |
| **投影读 + 派生列** | `SELECT session_id, cwd, name, …`（不读 `header_json`/entries）；`UPDATE sessions SET name = ?`（`sqlite-store.ts:122`） | `readJson` 读整值；无部分更新 |

**fs 后端同样不迁**——它是 append-only JSONL（`fs-store.ts:85` `appendFile`、`:188` `_<id>.jsonl`），不是 JSON 文档，`readJson`/`writeJson` 根本表达不了。

> 旁证：可选方法 `displayName?()` 存在的唯一原因，就是 fs 后端没有派生列能力、只能扫文件补，而 sqlite/postgres 在 append 时即维护 `name` 列因而不需要它（`types.ts` 该方法注释）。这正是「查询能力」有无的分界。

**云端的正确做法是实现该端口，而非绕开它。** `SessionEntryStore` 本就可插拔（fs/sqlite/postgres 三实现 + `SESSION_STORE` 开关）；pi-clouds 现在整体绕开去用 `app_sessions` + 替换整条 session-list 路由，是「点侧栏旧会话打不开」的根因。补一个 `SupabaseSessionEntryStore` 是**独立工作项**，与 Workspace 无关。

### 3.8 ✅ 一致性测试套件（**契约的可执行部分**）

**没有这个，两端一定会漂。**

pi-web 导出：

```ts
export function runWorkspaceConformance(
  name: string,
  factory: () => Promise<{ workspace: Workspace; cleanup: () => Promise<void> }>,
): void;
```

它注册一整套 vitest 用例，覆盖：键空间规则（含全部非法形态）、`readJson` 缺失/损坏、`writeJson` 两种 merge 语义、`list` 非递归、`delete` 幂等、读己之写、并发写的原子可见性、双根隔离，以及上限三例——**写超限抛错 / env 覆盖生效 / 调小上限后既有超限值仍可读**（§3.2.1）。

**`LocalWorkspace` 与 `TenantWorkspace` 必须都跑这一套且全绿。** 契约冲突在这里暴露，而不是在联调时。

---

## 4. P2 · `CapabilityProvider`

### 4.1 接口

```ts
export interface CapabilitySnapshot {
  readonly tenant?: {
    readonly userId: string;
    readonly companyId: string;
    readonly role: string;
  };
  /** LLM 出口。字段复用既有 `EgressModelSourceInput`。 */
  readonly egress?: EgressModelSourceInput;
  /** agent source registry 访问。 */
  readonly sources?: {
    readonly baseUrl: string;
    readonly token: string;
    readonly expiresAt: number;   // epoch seconds
  };
  /** 附件远端后端。仅当 `load(sessionId)` 传入 sessionId 时可能出现。 */
  readonly attachments?: {
    readonly endpoint: string;
    readonly token: string;
    readonly expiresAt: number;
  };
}

export interface CapabilityProvider {
  readonly contractVersion: 1;
  /**
   * @param sessionId 传入则附带**会话作用域**能力（附件）。
   *                  不传则只返回静态能力（tenant / egress / sources）。
   */
  load(sessionId?: string): Promise<CapabilitySnapshot>;
}
```

### 4.2 语义保证

1. **全字段可选**：任一字段缺失表示该能力不可用，调用方**必须**降级到本地形态，不得报错。
2. **两段式是强制的**：`attachments` 的授予作用域含 `sessionId`。实现**不得**在 `load()` 无 sessionId 时返回公司级附件授权——那会让同租户用户互读会话附件。
3. **失败即拒绝**：`load()` 抛错时，宿主**不得**进入「已登录」态（这是当前「本地不验签」缺陷的修正点，见集成设计 §2.4）。
4. **不落盘**：返回值中的 token 是短期授予，**禁止**写入 `Workspace`、日志或任何持久介质。凭据只存 OS 钥匙串。
5. **调用方负责缓存**：契约不规定缓存策略；实现可以每次真调，宿主按 `expiresAt` 自行缓存。

### 4.3 内建实现

| 实现 | 归属 | 说明 |
|---|---|---|
| `EnvCapabilityProvider` | pi-web | 读 `PI_WEB_CLOUD_LOGIN_*`，**与今天行为完全一致** |
| `HttpCapabilityProvider` | pi-web | 打宿主给定的 URL，`Authorization: Bearer <凭据>`。**它不认识 pi-clouds**，URL 由装配层给 |

> `HttpCapabilityProvider` 放在 pi-web 是合规的——它只是一个通用 HTTP 客户端，端点形状由本契约 §4.1 定义，任何服务端都可实现。

---

## 5. P3 · 能力面清单

### 5.1 接口

```ts
export interface CapabilityDescriptor {
  /** 稳定 id，命名 `<组>.<名>`，如 `config.mcp`、`session.actions`。 */
  readonly id: string;
  readonly factory: (deps: HostDeps) => readonly InjectedRoute[];
  /** 依赖的端口名，装配期校验。 */
  readonly requires?: readonly string[];
}

export type CapabilityDecision =
  | { readonly kind: "use" }
  | { readonly kind: "replace"; readonly factory: (deps: HostDeps) => readonly InjectedRoute[] }
  | { readonly kind: "decline"; readonly reason: string };

export function defaultCapabilities(deps: HostDeps): readonly CapabilityDescriptor[];

export function composeCapabilities(
  all: readonly CapabilityDescriptor[],
  decisions: Readonly<Record<string, CapabilityDecision>>,
): readonly InjectedRoute[];
```

### 5.2 语义保证

1. **必须全表态**：`decisions` 未覆盖某个 id → `composeCapabilities` **抛错**（构建期失败，不是运行期 404）。
2. **`decline` 必须带 reason**，且 reason 进启动日志。这把「漏掉」变成「有据可查的弃用」。
3. **新增能力面必然打断两端**：pi-web 加一个 descriptor，两端因未表态而构建失败——**这正是目的**，不是缺陷。
4. id 一经发布**不得改名**（改名 = 破坏性变更，须升契约版本）。

### 5.3 v1 能力面 id 清单（**已冻结**）

以现有 17 个路由工厂为基线。**下表 id 一经冻结不得改名**——改名是破坏性变更，须升契约版本（§1）。

| id | 现工厂 |
|---|---|
| `config.domains` | `createConfigRoutes` |
| `config.mcp` | `createMcpConfigRoutes` |
| `config.sandboxProject` | `createSandboxProjectRoutes` |
| `config.source` | `createSourceSettingsRoutes` |
| `config.extensions` | `createExtensionsConfigRoutes` |
| `session.list` | `createSessionListRoutes` |
| `session.actions` | `createSessionActionsRoutes` |
| `agentSource.list` | `createAgentSourcesRoutes` |
| `agentSource.favorites` | `createFavoritesRoutes` |
| `gateway.llm` | `createLlmGatewayRoutes` |
| `gateway.ai` | `createAiGatewayRoutes` |
| `auth.session` | `createAuthRoutes` |
| `attachment.routes` | `createAttachmentRoutes` |
| `shell.bash` | `createBashRoutes` |
| `extension.manage` | `createExtensionRoutes` |
| `host.commands` | `hostCommands`（**非路由**，但同样必须表态——它今天正因无表态而在云端静默缺席） |

> `aigc.models` 与 `vision.models` **不入 v1 清单**：它们按集成设计 §5 判定为领域泄漏，将被删除而非表态。若在删除前需过渡，可临时登记为 `deprecated.aigcModels` / `deprecated.visionModels`。

---

## 6. P4 · `ConfigDomainRegistry`

```ts
export interface ConfigDomainDescriptor {
  readonly id: string;                    // 不再是字面量联合
  readonly schema: ZodTypeAny;            // PUT 校验
  readonly formSchema: FormSchema;        // 前端渲染 IR
}

export interface ConfigDomainRegistry {
  register(d: ConfigDomainDescriptor): void;
  get(id: string): ConfigDomainDescriptor | undefined;
  list(): readonly ConfigDomainDescriptor[];
}
```

**语义**：

1. 域 id 重复注册 → 抛错（不静默覆盖）。
2. pi-web 默认注册**宿主关切**域：`auth`、`settings`、`sandbox`、`logging`。
3. **`aigc` 不在默认集**——它是工具领域，由 source 侧注册（集成设计 §5.5）。
4. 宿主可注册宿主特有域（云端配额、桌面偏好）。
5. 落盘键 = `<id>.json`，落 `workspace.user`。id 必须满足 §3.2 键空间规则且不含 `/`。

---

## 7. 宿主必须遵守的不变式

两端实现一律受约束：

1. **凭据不进 Workspace**：capability token、`sk-gw-*`、桌面凭据一律不得写入任一命名空间（§4.2.4）。
2. **`sk-gw-*` 永不出云端进程**（B-pure）。
3. **键空间规则是安全边界**，实现不得放宽（§3.2）。
4. **降级方向**：pi-web 侧能力缺失 → 退回本地形态并保持可用；宿主侧凭据/配置缺失 → fail-closed（503），**绝不回退平台 key**。方向相反是刻意的：本地降级损失功能，云端降级损失隔离。
5. **不得改 `packages/*`**：两端所有差异只出现在装配层。若发现必须改 pi-web 才能实现某端，**说明契约有缺口，回到本文修契约**，而不是在端上打补丁。

---

## 8. 两端起步点

契约冻结后可并行。

### 8.1 云端（pi-clouds）

| 步 | 交付 | 验收 |
|---|---|---|
| C1 | `TenantWorkspace`（Supabase 后端，按 `companyId`/`userId` 隔离） | `runWorkspaceConformance` 全绿 |
| C2 | 对 §5.3 全部 id 显式表态 | `composeCapabilities` 构建通过；`decline` reason 进启动日志 |
| C3 | 挂 `config.*` 五项 | 云端 Settings 可读写持久化 |
| C4 | `POST /api/desktop/capabilities`（§4.1 线格式） | 桌面能拉到 snapshot |
| C5 | `SupabaseSessionEntryStore`（**独立于 Workspace**，见 §3.9） | 云端不再绕开 `SessionEntryStore`；侧栏旧会话可打开 |

⚠️ **C3 前必须先落 `adminPolicy` 真实实现**——当前 `defaultConfigAdminPolicy = () => true` 全放行，多租户下等于暴露未鉴权写面。

### 8.2 桌面（desktop）

| 步 | 交付 | 验收 |
|---|---|---|
| D1 | 沿用 `LocalWorkspace`（**零工作量**，这正是「与本地同一套工作环境」的含义） | 本地行为逐字节不变 |
| D2 | 装配 `HttpCapabilityProvider`，URL 指向 C4 | 登录即验签；失败不进登录态 |
| D3 | 附件：描述符留 `workspace.user`，字节写云端 | 登录态切换不丢历史 |
| D4 | 对 §5.3 全部 id 表态（桌面多数是 `use`） | 构建通过 |

### 8.3 中间（pi-web）—— 两端的前置

| 步 | 交付 |
|---|---|
| M1 | 四个端口的类型定义 + `runWorkspaceConformance` 套件 |
| M2 | `LocalWorkspace` + `ConfigCodec` 改建其上（**行为零变化**，垂直切片验证） |
| M3 | `defaultCapabilities()` + `composeCapabilities()`，pi-web 自身改为经它装配 |
| M4 | 其余五个 store 迁至 Workspace |

**M1 必须先于两端任何工作完成**——它就是「中间的标准」本身。M2 是模型验证：若 config 域这一刀下去本地全绿且云端白拿，模型即成立。

---

## 9. 决议记录（v1 冻结依据）

四项均已拍板（2026-07-21）：

| # | 问题 | 决议 |
|---|---|---|
| 1 | `SessionEntryStore` 是否迁 Workspace？ | **三个后端都不迁**。语义正交（§3.9）——它是追加日志 + 索引，Workspace 是文档存储。云端改为实现该端口（C5），而非绕开 |
| 2 | 单键 1 MiB 上限是否合适？ | **改为可配**：`PI_WEB_WORKSPACE_MAX_VALUE_BYTES`，默认 1 MiB。**只在写时校验**，读不设限（§3.2.1）——否则调小上限会使既有数据不可达 |
| 3 | 是否需要 `watch(key)` 订阅？ | **不入契约**。现有 `control:settings-changed` 广播（`settings-changed.ts:20`）已覆盖需求；加订阅会把 Workspace 从存储端口推向消息端口，违反 §3.7「容器只管状态」的边界（见集成设计） |
| 4 | 能力面 id 是否冻结？ | **冻结**（§5.3）。id 不得改名；改名须升契约版本 |

---

_v1 已冻结，两端可开工。任何变更走版本流程（§1）：仅允许增量演进；改签名/改语义/可选转必填/收紧输入域一律须升 v2。_
