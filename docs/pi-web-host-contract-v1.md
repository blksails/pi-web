# pi-web 宿主契约 v1（中间标准）

> 状态：**v1 已冻结**（2026-07-21，§9 四项决议全部拍板）。后续变更走 §1 版本流程。
> 两端可据此开工。
>
> **勘误（2026-07-21，实现前，无实现者受影响）**：spec `host-contract-ports` 的设计发现阶段，据兄弟仓
> `pi-clouds/packages/registry-client/src/testing/` 的既有结论修正两处——
> ① 错误类型加稳定 `code` 判别式，跨仓一律按 `code` 而非 `instanceof` 判别（§3.6）；
> ② 一致性套件改为**框架无关**，签名增补 `SuiteRunner` 形参（§3.8）；
> ③ 套件工厂增补 `ConformanceTargetOptions`，使上限可由参数指定而非改写进程环境（§3.8）；
> ④ 澄清 `list` 的返回语义、排序规则（码元序）与空前缀非法（§3.1）；
> ⑤ `ConformanceTarget` 增补**必填** `corrupt` 钩子——损坏用例无法经端口自身构造，
>    设为可选会造成静默覆盖空洞（§3.8）；
> ⑥ `ConformanceTarget` 增补**必填** `reopen`——「上限调小后既有值仍可读」需跨配置读
>    同一份数据，而工厂产出的是隔离实例，无 `reopen` 则该验收只能被降格成弱断言（§3.8）。
> ⑦ **键大小写敏感的可承载性**（§3.2 第 4 条改写）——原文要求「实现若落在大小写不敏感的
>    文件系统上，须自行保证不产生别名冲突」，这是**不可实现的要求**：macOS/Windows 默认
>    文件系统上 `a.json` 与 `A.json` 是**物理同一个文件**，参照实现无从"保证"。改为：
>    大小写敏感是**键空间的契约语义**，落在大小写不敏感载体上的实现须在自身文档中**声明**
>    该限制；一致性套件**不得**用仅大小写不同的键对去验证其它维度（排序、列举等），
>    否则该维度的断言在半数宿主上无法成立（§3.2、§3.8）。
> ⑧ **值与分组不可同址**（§3.2 新增第 6 条）——层级载体（文件系统）上，`g/a.json` 一旦是
>    值，其下就再放不下 `g/a.json/x.json`；扁平 KV 载体上两者却能并存。不收口就意味着
>    「同一份配置搬到另一端会炸」是合法状态，而这正是本契约要消灭的东西。故定为**键空间
>    约束**而非实现差异：写入时若键的任一严格前缀已是值键、或该键本身是某个既有值键的严格
>    前缀，写入失败抛 `WorkspaceKeyError`；相应地 `readJson(<分组前缀>)` 必须返回 `{}`
>    （规则保证分组永不是值键，读不存在的键按 §3.4 即空对象），**不得**抛 IO 错误。
>    代价：**两种载体都要主动探测**，写时 O(段数) 次 `exists`（键通常 2–3 段，非热路径）。
>    〔2026-07-21 修正：初稿此处写「层级 FS 免费」，**是错的**——详见 §3.2 第 6 条的代价说明。〕
>    不新增错误码（四码已冻结），冲突说明由 `WorkspaceKeyError.reason` 承载（§3.2、§3.6）。
> ⑨ **上限计量口径钉死 + `LocalWorkspace` 已声明限制**（§3.2.1、§3.5）——
>    (a) §3.2.1 计量行原文 `JSON.stringify(values)` 有歧义：`values` 是**入参**还是**合并后
>    的整值**？必须是**合并后的整值**——只量入参的话，反复用小补丁 merge 可以让实际值
>    无限膨胀而每次都"合规"，上限形同虚设。同时明确：计量用**紧凑**序列化，落盘表示
>    （缩进等）可以更大，这不算超限。
>    (b) §3.5 增列一条 `LocalWorkspace` 的**已声明限制**：进程被强杀留下的原子写临时文件
>    会被 `list` 当作一个键返回、也能被 `readJson` 读到。**刻意不按文件名过滤**——过滤会
>    悄悄隐藏一个同名的合法键，那是更坏的失败模式。此形态在扁平 KV 载体上不存在，
>    与勘误⑦ 的大小写限制同类，故由契约声明而非由实现在注释里自定。
> ⑩ **空白 env 视同未设**（§3.5、§3.2.1）——§3.5 写的是 `PI_WEB_AGENT_DIR ?? ~/.pi/agent`，
>    但 `??` 只挡 `null`/`undefined`：环境变量设成**空串或纯空白**时字面解读会把它**采用**为根，
>    使根塌成相对 cwd 的空路径。这显然不是意图。故明确：本契约涉及的所有环境变量，
>    **值为空或纯空白一律视同未设**（走默认），不视为「设了一个空值」。
>    同一口径适用于 `PI_WEB_WORKSPACE_MAX_VALUE_BYTES`。
> ⑪ **大小写敏感的声明位与 `LocalWorkspace` 的限制声明**（§3.8、§3.5）——勘误⑦ 说了
>    「允许实现声明该用例为平台不适用」，但 §3.8 的 `ConformanceTarget` 类型块**无处承载
>    这个声明**，两处不自洽。补：`ConformanceTarget` 增补 `readonly caseSensitiveKeys?:
>    boolean`（缺省 `true`）。挂在 `ConformanceTarget`（实现**报出**的载体事实）而非
>    `ConformanceTargetOptions`（调用方**传入**的需求）——它取决于运行时载体，须由工厂
>    探测后填写，不能写死在调用处。
>    **❗声明不是豁免**：声明 `false` 后用例并不跳过，而是**反向断言**（两键确实互为别名、
>    后写者胜出、列举只回一条），**谎报同样红**。豁免式的声明等于让实现自证清白。
>    同时 §3.5 补 `LocalWorkspace` 的已声明限制（勘误⑦ 要求「实现须在自身文档中显式声明」，
>    此前漏了这一条）。
> ⑫ **会话作用域授予改由方法签名强制 + 字段名收口**（§4.1）——两处，都由任务 5.1 复核实证。
>    (a) 原 `load(sessionId?: string)` **表达不了** §4.2 那条「附件授予仅在带 sessionId 时出现」
>    的安全边界：返回类型与实参无关，两条路径共用同一个类型，越权签发全靠文档约束。
>    **重载形态挡不住**（复核者写探针实证）：TS 不拿实现签名逐条校验每个重载，只做一次
>    宽松兼容检查，故 `load(): Promise<S & {attachments?: never}>` + 实现体 `return
>    { attachments }` **编译通过**——它惩罚「没照格式写」的人，不惩罚「越权签发」的人，
>    是虚假安全感。改为**两个方法**：`loadStatic(): Promise<StaticCapabilitySnapshot>`
>    与 `loadForSession(sessionId: string): Promise<CapabilitySnapshot>`，各自有被诚实
>    校验的返回类型，实证可挡实现体越权（直接返回与经中间变量返回均被 `TS2322` 拒），
>    绕过只剩显式 `as any`——可 grep、可 lint、复核一眼可见。
>    〔机制澄清（经两轮隔离探针实测定位）：挡住越权的是 `attachments?: never` **本身**。
>    EPC（对象字面量多余属性检查）**只在返回类型显式注解时参与**——
>    `async loadStatic(): Promise<StaticCapabilitySnapshot> { return {…, attachments} }`
>    **会**被 EPC 以 `TS2353` 挡下；而返回类型由**上下文推断**时 EPC 完全缺席——
>    `{ loadStatic: async () => ({…, attachments}) }` 这类对象字面量实现就属此列。
>    故 EPC **覆盖不全**（实测四种写法只挡两种），`never` 才是唯一在**四种写法下都成立**
>    的防线。★ 初稿此处曾写「EPC 在 async 经 `Promise<T>` 包装的位置根本不触发」，
>    **是错的**：分界不在 async 也不在 `Promise<T>`，而在**注解 vs 推断**。〕
>    调用方须在「有无 sessionId」处分叉，而它本来就必须做这个决策：把隐式可选参数
>    变成显式路径选择，正是本条要的。
>    (b) `attachments` 的字段名原文是 `endpoint`，而 design 与实现用的是 `baseUrl`，
>    **此改名从未被记为有意为之**。失败形态很具体：pi-clouds 照 §4.1 发回 `{ endpoint }`，
>    pi-web 读 `baseUrl` 得 `undefined`，跨仓静默不匹配——正是本契约要消灭的东西。
>    统一为 `baseUrl`（与 `sources` 授予同形）。
> ⑬ **`requires` 在 v1 里不校验**（§5.1）——原注释写「依赖的端口名，**装配期校验**」，
>    但 v1 交付物中它**不校验**：`HostDeps` 完全泛型化，没有端口名注册表可比对，任何
>    校验都会恒真。跨仓消费方照原文会以为「填了 `requires` 就有装配期保护」——
>    **一个恒真的校验比没有校验更坏，它让人以为那个方向有人看着**。改为明写「纯声明
>    字段，校验待 `HostDeps` 收敛后启用，在此之前不要依赖它做安全判断」。
> 十三者均在任何实现存在之前完成，故不触发 v2。
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

  /**
   * 列出 `prefix` 下**直接子级中持有值的键**（不递归）。无匹配 → `[]`。
   * - 只返回值键；更深层结构（分组）不返回、也不展开。
   * - 返回顺序必须按键**码元序**升序（JS 的 `<` 比较、SQL 的 `COLLATE "C"`），
   *   **不得**使用区域相关的排序规则——否则同一组键在不同实现下顺序不同，
   *   跨实现的确定性即失效。
   * - `prefix` 与其它方法同受键空间规则约束，故**空前缀非法**：v1 不支持根级列举
   *   （现有消费方均按具名前缀列举）。若将来需要，走增量演进。
   */
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
4. 键**大小写敏感**——这是键空间的**契约语义**（两个仅大小写不同的键是两个键）。
   但**载体可能承载不了**：macOS/Windows 默认文件系统上 `a.json` 与 `A.json` 是物理同一个
   文件，`LocalWorkspace` 在这些平台上**原理上无法**满足该语义。故：
   - 实现落在大小写不敏感载体上时，须在自身文档中**显式声明**该限制（不是"自行保证"——保证不了）；
   - 一致性套件**不得**用仅大小写不同的键对去验证其它维度（排序、列举等），否则该维度的
     断言在半数宿主上无法成立；大小写敏感须单列用例，并允许实现声明其为平台不适用。
   - 同理，宿主 OS 有特殊语义的名字（Windows 设备名 `CON`/`NUL`/`AUX`、NTFS ADS 语法
     `a.json:s:$DATA`）在键空间层面**合法**（它们不构成路径穿越），键校验不拦；能否落盘
     是**载体的可承载性问题**，由各实现声明，**不上提到平台无关的键校验层**。
5. 单键值有上限（JSON 序列化后字节数），**默认 1 MiB**，经 env 可配。超限抛 `WorkspaceLimitError`。详见 §3.2.1。
6. **值与分组不可同址**——一个键**不得**是另一个既有值键的严格前缀，反之亦然。
   - 写入时若 `k` 的任一严格前缀已是值键（如已有 `g/a.json`，写 `g/a.json/x.json`），
     或 `k` 本身是某既有值键的严格前缀（如已有 `g/a.json/x.json`，写 `g/a.json`），
     → 写入失败，抛 `WorkspaceKeyError`，`reason` 说明与哪个键冲突。
   - 相应地 `readJson(<分组前缀>)`（如 `readJson("g")`）**必须**返回 `{}`：本规则保证分组
     永不是值键，故它就是一个「不存在的键」，按 §3.4 读为空对象。**不得**抛 IO 错误。
   - **为什么要有这条**：层级载体（文件系统）上 `g/a.json` 一旦是文件，其下就放不下
     `g/a.json/x.json`；扁平 KV 载体上两者能并存。不收口就等于承认「同一份配置搬到
     另一端会炸」是合法状态。
   - **代价**：**两种载体都要主动探测**，写时 O(段数) 次 `exists` 加一次子树查找。
     层级 FS 上**不能**靠 errno 兜底（初稿曾写「层级 FS 免费」，是错的）——原因有二：
     ① 本条要求错误 `reason` **指名**冲突的那个键，errno 给不出；
     ② 空分组必须**写入成功**（见 §3.5），而它与非空分组在 errno 层面都是 `EISDIR`，
     不可区分。errno 只能作为并发窗口的兜底，且兜底后必须**重新探测**再分类，
     否则真实 IO 故障会被误报成键错误。

### 3.2.1 单键值上限（可配）

| 项 | 规定 |
|---|---|
| env | `PI_WEB_WORKSPACE_MAX_VALUE_BYTES` |
| 默认 | `1048576`（1 MiB） |
| 取值 | 正整数字节数。非法（非数字 / ≤0 / 非整数）→ **装配期 fail-fast 抛错**，不静默回落默认（沿用 `resolveCloudLoginConfig` 的既有惯例） |
| 计量 | **合并后整值**的**紧凑** `JSON.stringify(...)` 的 UTF-8 字节数（勘误⑨）。<br>❗ 不是入参：只量入参的话，反复用小补丁 `merge` 能让实际值无限膨胀而每次都"合规"。<br>❗ 落盘表示（缩进等）可以大于该值，不算超限。 |

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
- **已声明限制（勘误⑪）**：落在大小写不敏感载体（macOS APFS、Windows NTFS 默认）上时，
  **无法**满足 §3.2 第 4 条的键大小写敏感语义——`a.json` 与 `A.json` 在那里是同一个文件。
  实现须经 `ConformanceTarget.caseSensitiveKeys` **运行时探测**后如实报出（不是按平台假设
  写死），套件据此改走反向断言而非跳过。
- **已声明限制（勘误⑨b）**：进程被强杀留下的原子写临时文件会被 `list` 当作一个键返回、
  也能被 `readJson` 读到。**刻意不按文件名过滤**——过滤会悄悄隐藏一个同名的合法键，
  那是更坏的失败模式。此形态在扁平 KV 载体上不存在，属载体差异，一致性套件**不得**
  对该形态断言。
- **空分组不是冲突**：`delete` 只删值、不删其父目录，故层级载体上会残留空目录。
  空目录**不含任何值键**，据 §3.2 第 6 条它不构成同址冲突——实现**必须**允许在该位置
  写入值键（按需清理残留空目录）。若实现在此拒绝，扁平 KV 后端上同一序列却能成功，
  即是本契约要消灭的那类分歧。
- `user` 根 = `PI_WEB_AGENT_DIR ?? ~/.pi/agent`（该 env **为空或纯空白时视同未设**，见勘误⑩）
- `project` 根 = `<cwd>/.pi`

**若迁移后本地行为有任何可观测变化，即为迁移缺陷，不是契约需要放宽。**

### 3.6 错误类型

```ts
export type WorkspaceErrorCode = "key" | "limit" | "corrupt" | "io";

/** 所有 Workspace 错误的共同基类，携带稳定的 `code` 判别式。 */
export declare abstract class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
}

export class WorkspaceKeyError extends WorkspaceError {}     // code: "key"     键非法（安全边界）
export class WorkspaceLimitError extends WorkspaceError {}   // code: "limit"   超限
export class WorkspaceCorruptError extends WorkspaceError {} // code: "corrupt" 现有值非法 JSON
export class WorkspaceIoError extends WorkspaceError {}      // code: "io"      后端 I/O 失败（含权限、网络）
```

**❗ 判别一律用 `code`，不用 `instanceof`。**

一致性套件要跨仓运行（pi-clouds 引用 pi-web 导出的套件）。跨包/跨仓时同名类可能来自不同模块实例，`instanceof` 会假阴性。故套件与两端实现都必须按 `err.code` 判别。这与兄弟仓 `pi-clouds/packages/registry-client/src/testing/contract-suite.ts` 的既有结论一致（其原文：「跨包 `instanceof` 在同进程内有效……但为稳妥，错误判定按 `RegistryError.code` 而非构造函数」）。

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

> **⚠ 勘误⑭（2026-07-22，M4 实现中发现）：trust store 本期不迁**。`FsProjectTrustStore` 有三处使 `Workspace` 迁移会破坏「行为零变化」或跨进程兼容：① **同步 API**（`get/set` 用 `readFileSync/writeFileSync`），`Workspace` 是 async，迁移牵连 `project-trust-policy` 调用链；② 与 pi CLI **刻意共享** `~/.pi/agent/trust.json` 的字节格式契约（key 排序 + 末尾 `\n`），而 `writeJson` 固定 2-space stringify、无末尾换行、**无法定制序列化**（改 `Workspace` 违反 §3 冻结面），会破坏 pi CLI 读取；③ 损坏 JSON → **抛错**（非静默，安全语义）+ 键名现状 `trust.json` vs 本表 `trust-store.json` + 用 `PI_CODING_AGENT_DIR`。故 **M4 只迁其余四个 store**（agent-source favorites / session favorites / per-source settings / sources 注册表）；trust store 待契约层面重新决策（云端是否需要 trust、是否值得为它引入可定制序列化的 `Workspace` 变体），届时再定 `trust.json`↔`trust-store.json` 键名。§8.3 的「M4 = 其余五个」据此收敛为**四个 + trust 悬置**。spec：`host-contract-stores-on-workspace`。

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
/** 最小测试框架契约。套件本身不 import 任何测试框架。 */
export interface SuiteRunner {
  describe(name: string, fn: () => void): void;
  it(name: string, fn: () => void | Promise<void>): void;
}

export interface ConformanceTarget {
  readonly workspace: Workspace;
  cleanup(): Promise<void>;
  /**
   * 把指定键的既有值破坏为非法 JSON，供「读取遇损坏必须抛错」用例使用（§3.4）。
   * 本地实现写坏文件；远端实现写坏行。**必填**——见下方说明。
   */
  corrupt(namespace: "user" | "project", key: WorkspaceKey): Promise<void>;
  /**
   * 以新选项重新打开**同一份既有数据**，返回新的 `Workspace`。
   * 用于「上限调小后既有超限值仍可读」这类**跨配置**场景（§3.2.1）。
   */
  reopen(opts?: ConformanceTargetOptions): Promise<Workspace>;
}

/** 套件向工厂索取被测实例；`maxValueBytes` 缺省时由实现自定。 */
export interface ConformanceTargetOptions {
  readonly maxValueBytes?: number;
}

export function runWorkspaceConformance(
  runner: SuiteRunner,
  name: string,
  factory: (opts?: ConformanceTargetOptions) => Promise<ConformanceTarget>,
): void;
```

**❗ `corrupt` 是必填而非可选。**

「读取遇损坏必须抛错」（§3.4）无法经 `Workspace` API 自身构造——损坏发生在端口之下（坏文件 / 坏行）。若把该钩子设为可选，未提供它的实现会**静默跳过**这条用例：套件报绿，而该实现在遇到损坏数据时的行为从未被验证过。这正是本契约要消灭的「缺失与弃用不可区分」，故设为必填。

**❗ `reopen` 是必填：工厂产出隔离实例，无法表达「同一份数据、不同配置」。**

契约要求工厂**每次调用产出相互隔离的实例**（否则用例间串数据）。但「上限调小后既有超限值仍可读」本质是**跨配置读同一份数据**——用两个隔离实例根本无法构造：新实例看不到旧实例写的东西。缺了 `reopen`，这条验收只能被降格成两个互不相干的弱断言（「大上限实例能读自己写的」+「小上限实例拒绝大写入」），看似通过，实则从未验证 Req 3.5 所保护的行为。

**❗ 上限须可由工厂参数指定，套件不得改写进程环境。**

套件验证的是**上限行为**而非上限来源。上限经 `PI_WEB_WORKSPACE_MAX_VALUE_BYTES` 配置是各实现的装配细节——云端实现未必读同名变量。若套件为构造「上限调小」场景而改写 `process.env`，既违反 env 装配期 fail-fast 纪律，也对不读该变量的实现无意义。

工厂**每次调用须产出相互隔离的实例**（不同临时根），否则用例间会串数据。

**❗ 套件必须框架无关**：不得 import `vitest`/`jest`/`node:test`，由调用方传入 `describe`/`it`，断言用 `node:assert`。

理由有二：① 套件要跨仓运行，两端的测试框架与配置（是否开启 globals）不受 pi-web 控制；② 兄弟仓 `pi-clouds/packages/registry-client/src/testing/` 已按此模式落地并验证（`SuiteRunner` 同形）。

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
  /** 附件远端后端。**只可能**出现在 `loadForSession()` 的返回里（勘误⑫）。 */
  readonly attachments?: {
    /** 勘误⑫b：原文写作 `endpoint`，与实现不一致，统一为 `baseUrl`（同 `sources`）。 */
    readonly baseUrl: string;
    readonly token: string;
    readonly expiresAt: number;
  };
}

/** 静态快照：`attachments` 被类型**禁止**，不是「碰巧没有」（勘误⑫a）。 */
export type StaticCapabilitySnapshot =
  Omit<CapabilitySnapshot, "attachments"> & { readonly attachments?: never };

export interface CapabilityProvider {
  readonly contractVersion: 1;
  /** 只返回静态能力（tenant / egress / sources）。签发附件授予会**编译不过**。 */
  loadStatic(): Promise<StaticCapabilitySnapshot>;
  /** 附带**会话作用域**能力（附件）。 */
  loadForSession(sessionId: string): Promise<CapabilitySnapshot>;
}
```

### 4.2 语义保证

1. **全字段可选**：任一字段缺失表示该能力不可用，调用方**必须**降级到本地形态，不得报错。
2. **两段式是强制的，且已由类型机械强制**（勘误⑫a）：`attachments` 的授予作用域含 `sessionId`。
   `loadStatic()` 的返回类型 `StaticCapabilitySnapshot` **禁止** `attachments`（`?: never`），
   越权签发**编译不过**——那会让同租户用户互读会话附件。这条从前是纯文档义务，现在不是了。
3. **失败即拒绝**：任一 `load*` 方法抛错时，宿主**不得**进入「已登录」态（这是当前「本地不验签」缺陷的修正点，见集成设计 §2.4）。
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
  /**
   * 依赖的端口名。**v1 交付物中这是纯声明字段，装配期不校验**（勘误⑬）。
   * 原因：`HostDeps` 完全泛型化，没有端口名注册表可比对，任何校验都会恒真——
   * 而一个恒真的校验比没有校验更坏，它让填了 `requires` 的宿主以为有保护。
   * 校验待 `HostDeps` 收敛后再启用。**在此之前不要依赖它做安全判断。**
   */
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
