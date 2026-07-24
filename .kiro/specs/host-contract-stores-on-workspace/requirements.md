# Requirements Document

## Introduction

本 spec 是 pi-web 宿主契约 v1 的 **M4 里程碑**:把契约 §3.7 表中「其余五个 store」的默认实现改建到 M1 的 `LocalWorkspace` 之上(契约 §8.3 M4;集成设计 W2)。M2 已迁 `ConfigStore` 作垂直切片验证;M3 已让装配经 `composeCapabilities`。M4 把剩余 store 收敛到同一底座 —— 云端实现 1 个 `Workspace` 即白拿这些 store,不再「每个 store 各自的云端实现可漏」(集成设计 §207)。

**M4 的五个 store**(Explore 已证实,排除 ConfigStore=M2、AttachmentRegistryPort=已由 attachment-backend-pluggable 抽象为可插拔后端、SessionEntryStore=§3.9 决议语义正交不迁):
1. per-source settings(`SourceSettingsCodec`,user+project 双命名空间)
2. `FavoritesStore`(agent source 收藏,user,`agent-source-favorites.json`)
3. `SessionFavoritesStore`(会话收藏,user,`session-favorites.json`)
4. trust store(`FsProjectTrustStore`,user,**有三处迁移张力,须设计拍板**)
5. sources 注册表(`RegistrySourceProvider`,user,`sources.json`,当前只读)

**迁移模式**(参照 M2):每个 store **保留各自的类型化接口不变**,只把内部读写改建到 `createLocalWorkspaceNamespace(...)` 的 user(或 project)命名空间之上,键按 §3.7 表,**行为零变化**。Workspace 相对现状新增三处收紧(损坏 JSON 抛 `corrupt`、1 MiB 写入上限、temp+rename 原子写),各 store 须在本层处置以保既有可观测行为(参照 M2 的 `config-codec` catch 降级)。

**★ trust store 的三处张力(M4 最大风险,须设计拍板)**:
- **同步 API**:`FsProjectTrustStore.get/set` 是**同步**(`readFileSync`/`writeFileSync`);`Workspace` 是 async。迁移会改签名(同步→async),牵连 `project-trust-policy.ts` 及其调用链,**非纯内部改建**。
- **与 pi CLI 共享字节格式契约**:现状**刻意**与 pi CLI 共享 `~/.pi/agent/trust.json`(文件头注释),`set` 写 key 排序 + 末尾 `\n`(`trust-store.ts:111`);Workspace `writeJson` 是 2-space stringify **无末尾换行** → 破坏字节一致,可能破坏 pi CLI 读取。
- **损坏语义相反 + 键名不符**:trust 损坏 JSON → **抛错**(`Invalid trust store`),而非其余 store 的静默 `{}`;键名现状 `trust.json` vs 契约 §3.7 表 `trust-store.json`;agentDir 用 `PI_CODING_AGENT_DIR`(pi 的 env)非 `PI_WEB_AGENT_DIR`。

**权威依据**:`docs/pi-web-host-contract-v1.md` §3.7(建在 Workspace 之上的既有端口)、§3.9(SessionEntryStore 不迁)、§8.3(M4);集成设计 `docs/desktop-cloud-integration-design.md` §12 W2。现状事实(文件:行号)见各需求。

## Boundary Context

- **In scope**:
  - 上述**五个** store 的内部实现改建到 `LocalWorkspace` 命名空间之上,键按 §3.7 表,行为零变化。
  - Workspace 三处收紧(损坏抛 corrupt、1 MiB 上限、原子写)在各 store 层的等价处置。
  - per-source settings 的第三份 `deepMerge` 副本收敛到 `deepMergeJson`(M2 已收敛 config 的私有副本,留了 source-settings 这份)。
  - trust store 三处张力的处置决策(设计拍板)。
  - 各 store 现有单测作为行为零变化回归基线。
- **Out of scope**:
  - **AttachmentRegistryPort**(附件描述符)—— 已由 attachment-backend-pluggable spec 抽象为可插拔后端(LocalFs/S3/HTTP 三实现 + env 装配),多文件 + listBySession 查询形态,Workspace 整值语义不合;云端由 S3AttachmentRegistry 覆盖。不在 M4。
  - **SessionEntryStore** —— §3.9 决议三后端都不迁(语义正交:追加日志 + 索引 + 按值查询,Workspace 给不了);云端补 `SupabaseSessionEntryStore` 是独立工作项。
  - **不改** M1 冻结面(`LocalWorkspace` / `deepMergeJson` / 错误类型 / 键校验)。
  - **不改** 任何 store 的对外类型化接口签名 —— **除 trust store 若设计拍板须 async 化**(那是 trust 特有的、经批准的例外)。
  - 不含 M4 之外的契约演进(C/D 期两端工作、领域泄漏清理)。
- **Adjacent expectations**:
  - pi-clouds(C1)实现 1 个 `TenantWorkspace` 即白拿这五个 store(Supabase 后端,按 companyId/userId 隔离)。M4 是该白拿的前提。
  - 迁移即定契约:trust `trust.json`→`trust-store.json`、attachment 键等 §3.7 表与现状不符处,须在设计中确认或回契约修订(§7.5)。
  - 不改 `packages/*` 对外签名(trust async 化例外须显式记录)。

## Requirements

### Requirement 1: 五个 store 统一迁到 LocalWorkspace 之上

**Objective:** As a 宿主契约维护者, I want 五个 store 的落盘统一经 `LocalWorkspace` 命名空间, so that 云端实现 1 个 `Workspace` 即白拿全部,不再有「每个 store 各自云端实现可漏」。

#### Acceptance Criteria
1. The 每个 store shall 通过 `createLocalWorkspaceNamespace(...)` 的 user(或 project)命名空间完成读写,不再直接调用 `node:fs`(trust store 的同步例外见 Req 6)。
2. When 读写某 store, the store shall 使用契约 §3.7 表规定的命名空间与键。
3. The 每个 store shall 保持既有磁盘落盘路径与权限位(0700/0600)与迁移前一致(除 trust 的键名变更须设计拍板,见 Req 6)。
4. The 每个 store shall 保留其既有类型化公开接口(方法签名不变),消费方无需改调用方式(trust async 化例外见 Req 6)。

### Requirement 2: FavoritesStore 迁移(agent source 收藏)

**Objective:** As a agent source 收藏的读写方, I want FavoritesStore 迁到 workspace.user 后行为逐字节不变, so that 收藏功能对用户零感知。

#### Acceptance Criteria
1. The `FavoritesStore` shall 经 workspace.user 键 `agent-source-favorites.json` 读写。
2. When `list()` 读到缺文件或损坏 JSON, then the store shall 返回 `[]`(保持既有静默降级;catch `corrupt`→`[]`)。
3. When `set(favorites)`, the store shall 全量替换写入(无 merge),逐条 zod 校验保持不变。
4. While 运行既有 `favorites-store.test.ts` / `favorites-routes.test.ts`, the store shall 使其全绿(不放宽断言)。

### Requirement 3: SessionFavoritesStore 迁移(会话收藏)

**Objective:** As a 会话收藏的读写方, I want SessionFavoritesStore 迁移后行为不变, so that 会话收藏对用户零感知。

#### Acceptance Criteria
1. The `SessionFavoritesStore` shall 经 workspace.user 键 `session-favorites.json` 读写。
2. When `list()` 读到缺文件或损坏 JSON, then the store shall 返回 `[]`(catch `corrupt`→`[]`)。
3. When `set(sessionIds)`, the store shall 全量替换、去重、丢空串,保持不变。
4. While 运行既有 `session-favorites-store.test.ts` 等, the store shall 使其全绿。

### Requirement 4: per-source settings 迁移(双命名空间 + merge 收敛)

**Objective:** As a per-source settings 的读写方, I want SourceSettingsCodec 迁移后双作用域行为不变、且合并语义收敛到单一权威, so that source 级配置对用户零感知且不再有第三份 deepMerge 漂移。

#### Acceptance Criteria
1. The `SourceSettingsCodec` shall 经 workspace.user(scope="source",键 `sources/<sourceKey>/settings.json`)与 workspace.project(scope="project",键 `source-settings/<sourceKey>.json`)读写,双作用域映射到 Workspace 的 user/project 双命名空间。
2. The `SourceSettingsCodec` shall 复用 `deepMergeJson` 作为合并语义,删除其内部第三份私有 `deepMerge` 副本;合并结果与迁移前逐项等价。
3. When `load` 读到损坏 JSON, then the store shall 返回 `{}`(保持既有静默降级,catch `corrupt`)。
4. The `sourceKey` 校验(`isSourceKey`)shall 保持不变(路径安全)。
5. While 运行既有 `source-settings-codec.test.ts` / `source-settings-routes.test.ts` 与 `e2e/node/source-settings-endpoint.e2e.test.ts`, the store shall 使其全绿。

### Requirement 5: sources 注册表迁移(只读)

**Objective:** As a agent source 注册表的读取方, I want RegistrySourceProvider 迁到 workspace.user 键 `sources.json`, so that 云端经同一 Workspace 键读注册表。

#### Acceptance Criteria
1. The `RegistrySourceProvider` shall 经 workspace.user 键 `sources.json` 读取(当前只读,`list()` 一个方法)。
2. When 读到缺文件或损坏 JSON, then the provider shall 返回 `[]`(保持既有静默降级);坏条目逐条跳过不变。
3. Where 当前 `registryPath` 是装配注入的任意路径, the 迁移 shall 在设计中确认「固定为 workspace user 键 `sources.json`」这一路径来源变化是否被装配层接受(装配层现从 `PI_WEB_SOURCES_REGISTRY ?? <agentDir>/sources.json` 注入,须保持等价)。
4. While 运行既有 `registry-provider.test.ts`, the provider shall 使其全绿。

### Requirement 6: trust store 迁移的关键决策(三处张力)

**Objective:** As a M4 执行者, I want trust store 的迁移方案先经设计拍板, so that 不因同步 API / pi CLI 字节契约 / 损坏语义而破坏「行为零变化」或跨进程兼容。

#### Acceptance Criteria
1. The 设计 shall 就 **trust store 是否照 M2 模式迁移**给出明确决策,并处置以下三处张力(每处给出方案或「本期不迁 + 理由」):
   - **同步→async**:若迁移,`get/set` 须 async 化,牵连 `project-trust-policy.ts` 调用链;设计须列出受影响调用点与改法。
   - **pi CLI 字节格式契约**:现状与 pi CLI 共享 `~/.pi/agent/trust.json`,写 key 排序 + 末尾 `\n`;若经 Workspace(2-space 无末尾换行)须评估是否破坏 pi CLI 读取,并给出保字节方案或接受变化的理由。
   - **损坏抛错 + 键名**:trust 损坏→抛(非静默),须保留;键名 `trust.json`(现)vs `trust-store.json`(契约 §3.7),须拍板并在必要时回契约修订。
2. If 设计判定 trust store 迁移会破坏 pi CLI 共享字节契约且无法保字节, then the 决策 shall 是「本期不迁 trust,记录为契约张力回 §7.5」或「显式接受字节变化并拍板」,不得默默套 M2 模板破坏跨进程契约。
3. While 运行既有 `trust-store.test.ts` / `project-trust-policy.test.ts` / `trust-pi-loading.e2e.test.ts`, the 最终实现 shall 使其全绿(或按拍板的语义变化相应更新,不放宽安全断言)。

### Requirement 7: 范围隔离

**Objective:** As a M4 执行者, I want 明确排除三个非 M4 端口, so that 不误迁语义不合的 store。

#### Acceptance Criteria
1. The 本 spec shall 不修改 `AttachmentRegistryPort` 及其三实现(LocalFs/S3/HTTP)—— 已由 attachment-backend-pluggable 抽象,多文件形态不合 Workspace 整值语义。
2. The 本 spec shall 不修改 `SessionEntryStore` 三后端 —— §3.9 决议语义正交不迁。
3. The 本 spec shall 不修改 M1 冻结面(`LocalWorkspace` / `deepMergeJson` / 错误类型 / 键校验)。
4. If 迁移某 store 时发现必须改 M1 冻结面或破坏跨进程契约才能达成, then the 执行者 shall 停止并回报边界冲突(可能是契约缺口,回 §7.5 修订)。

### Requirement 8: 垂直验证(回归 + fresh-evidence)

**Objective:** As a 契约模型验证者, I want 可复现的「本地全绿」证据, so that M4 结论(五个 store 白拿模型成立)有新鲜凭据。

#### Acceptance Criteria
1. While 每个 store 迁移完成, the 验证 shall 运行 `packages/server` 全量单测并全绿(真实计数;防 vitest 假绿:`no tests` 或 `Errors N error` 不算过)。
2. While 迁移完成, the 验证 shall 运行 `packages/server` typecheck 零错误。
3. While 迁移完成, the 验证 shall 运行受影响的 e2e(至少 `source-settings-endpoint`、trust 相关)并全绿,或对既有失败做基线对照证明与本 spec 无关。
4. The 验证 shall 以 fresh-evidence(命令 + 真实计数 + 时间戳)记录于 spec 的验证目录,不得以「应当通过」替代实际运行。
