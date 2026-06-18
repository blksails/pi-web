# Requirements Document

## Introduction

session-store-adapters 为 pi-web 后端(`@pi-web/server`)引入一个**可插拔的会话事件存储抽象 `SessionEntryStore`**,把 pi 会话的"append-only 事件树"持久化能力从具体存储介质中解耦出来,并交付 **fs / sqlite / postgres** 三种 adapter。

会话以"append-only 事件树"建模:每条 entry 含 `id` 与 `parentId` 构成树,叶子到根的路径即一段对话上下文;entry 类型含 `message`(user/assistant/toolResult/bashExecution)、`model_change`、`thinking_level_change`、`compaction`、`branch_summary`、`label`、`session_info`、`custom`/`custom_message`,并由文件头 `session`(含 `version`、`cwd`)起始。本特性只负责**条目的存取(IO)**;"从叶子回溯重建上下文、分支"等**树运算属领域层,不进存储接口**。

第三方包 `@earendil-works/pi-coding-agent` 内置的 `SessionManager` 仅作为**数据格式与布局的参照与兼容目标**,本特性**不修改其任何代码**;`@pi-web/server` 内实现一套独立、可异步、可换后端的存储。

## Boundary Context

- **In scope**:
  - 统一异步接口 `SessionEntryStore`:`create` / `append` / `appendBatch` / `read` / `readHeader` / `list` / `listAll` / `delete`。
  - 三个 adapter:fs(每会话一个 JSONL 文件、按 cwd 分桶、与 pi 现有 `~/.pi/agent/sessions` 布局兼容)、sqlite、postgres。
  - entry / header 的序列化与解析纯函数(含 `version` 字段识别)。
  - append-only 不可变与并发分叉语义、幂等键。
  - 各 adapter 的单元/集成测试与跨 adapter 行为一致性验证。
- **Out of scope**:
  - 修改第三方 `@earendil-works/pi-coding-agent` 的任何代码。
  - 活跃会话注册表(`session-engine` 的 `SessionStore`,持有活 `PiSession` + 子进程通道,属另一概念,不在本特性)。
  - 树运算本身(`buildSessionContext`/分支算法等领域逻辑)。
  - HTTP 端点、UI、远程/网络 adapter,以及任何**具体中间件实现**(加密/缓冲/缓存/遥测)。
- **Adjacent expectations**:
  - 领域层(会话引擎/上层调用方)期望通过 `SessionEntryStore` 接口存取条目,而不感知底层介质;树运算在领域层基于 `read()` 取回的条目进行。
  - 运维期望:postgres adapter 支持多服务实例共享同一会话数据;fs adapter 产出的文件可被既有 pi 工具按其原有布局识别。

## Requirements

### Requirement 1: 统一会话存储接口契约

**Objective:** 作为后端领域层,我想通过一个与介质无关的异步接口存取会话条目,以便在不改动调用方的前提下替换底层存储(fs/sqlite/postgres)。

#### Acceptance Criteria

1. The SessionEntryStore shall 暴露统一的异步方法集:`create`、`append`、`appendBatch`、`read`、`readHeader`、`list`、`listAll`、`delete`,且所有方法返回 Promise 或异步可迭代。
2. The SessionEntryStore shall 仅承担条目的存取(IO),不暴露任何树运算(从叶子回溯重建上下文、分支选择)能力。
3. When 调用方使用同一组方法调用任意 adapter, the SessionEntryStore shall 在所有 adapter 上呈现相同的方法签名与可观察语义。
4. The SessionEntryStore shall 以 `sessionId` 作为会话的唯一标识,且 entry 以其 `id` 在所在会话内唯一标识。
5. Where 某能力属于领域树运算而非存取, the SessionEntryStore shall 不将其纳入接口。

### Requirement 2: 会话创建与头部元数据

**Objective:** 作为调用方,我想以一个会话头部(含 `version`、`cwd` 等)创建一个新会话,以便后续向其追加条目并按工作目录检索。

#### Acceptance Criteria

1. When 调用方以会话头部请求 `create`, the SessionEntryStore shall 建立一个可被后续 `append`/`read` 识别的会话,并返回其 `sessionId`。
2. When 会话被创建, the SessionEntryStore shall 持久化头部元数据,使 `readHeader` 能读回创建时给定的 `version` 与 `cwd`。
3. If 以一个已存在的 `sessionId` 重复 `create`, then the SessionEntryStore shall 以可识别的错误拒绝,而不覆盖已存在会话的既有条目。
4. The SessionEntryStore shall 将头部视为会话的起始元数据,且头部不参与 `id`/`parentId` 树结构。

### Requirement 3: Append-only 追加与不可变语义

**Objective:** 作为调用方,我想以只追加的方式写入条目,以便历史不被破坏、写入可审计且崩溃安全。

#### Acceptance Criteria

1. When 调用方对某会话 `append` 一条 entry, the SessionEntryStore shall 将该 entry 追加到该会话条目序列的末尾,并保留其 `id` 与 `parentId`。
2. The SessionEntryStore shall 不提供修改或删除单条已写入 entry 的能力(删除仅以整会话为粒度,见 Requirement 7)。
3. If 对一个不存在的 `sessionId` 执行 `append`, then the SessionEntryStore shall 以可识别的"会话不存在"错误拒绝,而不隐式创建会话。
4. When 同一条 entry(相同 `sessionId` 与 entry `id`)被重复 `append`, the SessionEntryStore shall 以幂等方式处理,不产生重复条目。
5. While 一次 `append` 未完成, the SessionEntryStore shall 不使该会话进入条目被部分写入即对读取可见的损坏状态。

### Requirement 4: 批量追加

**Objective:** 作为调用方,我想一次性追加多条有序条目,以便在首次落盘或同步场景下减少往返与写入开销。

#### Acceptance Criteria

1. When 调用方对某会话 `appendBatch` 一组有序 entry, the SessionEntryStore shall 按给定顺序将它们追加到条目序列末尾。
2. If `appendBatch` 中途因任一条目失败, then the SessionEntryStore shall 不让该批次中后续条目以乱序或部分可见的方式残留(批次整体可见性一致)。
3. When `appendBatch` 完成, the SessionEntryStore shall 使后续 `read` 读回的顺序与给定批次顺序一致。

### Requirement 5: 读取条目与头部

**Objective:** 作为领域层,我想按写入顺序读回某会话的全部条目与头部,以便在内存中重建树并执行上下文运算。

#### Acceptance Criteria

1. When 调用方对某会话 `read`, the SessionEntryStore shall 以条目被追加的相同顺序产出该会话的全部 entry。
2. The SessionEntryStore shall 以异步可迭代(流式)方式产出条目,使调用方无需一次性将整会话载入即可处理大会话。
3. When 调用方对某会话 `readHeader`, the SessionEntryStore shall 返回该会话创建时的头部元数据。
4. If 对一个不存在的 `sessionId` 执行 `read` 或 `readHeader`, then the SessionEntryStore shall 返回可识别的"未找到"结果,而不抛出无法区分的通用错误。
5. Where 已写入条目无法被解析为已知 entry 形态, the SessionEntryStore shall 以可识别错误报告该条目位置,而不静默丢弃。

### Requirement 6: 列举会话

**Objective:** 作为调用方,我想按工作目录或全局列出已有会话,以便实现"继续最近会话""按项目浏览会话"等检索。

#### Acceptance Criteria

1. When 调用方以某 `cwd` 调用 `list`, the SessionEntryStore shall 返回归属该工作目录的会话清单(含可用于排序的标识与时间信息)。
2. When 调用方调用 `listAll`, the SessionEntryStore shall 返回跨所有工作目录的会话清单。
3. While 某工作目录下无任何会话, the SessionEntryStore shall 返回空清单而不报错。
4. The SessionEntryStore shall 使列举结果中的每个条目可据以定位到对应会话以执行 `read`/`delete`。

### Requirement 7: 删除会话与未找到语义

**Objective:** 作为调用方,我想以整会话为粒度删除会话数据,以便清理或回收,同时对不存在的目标有明确反馈。

#### Acceptance Criteria

1. When 调用方对某会话 `delete`, the SessionEntryStore shall 移除该会话的全部条目与头部,使其后续不再出现在 `list`/`listAll` 中。
2. If 对一个不存在的 `sessionId` 执行 `delete`, then the SessionEntryStore shall 以可识别的"未找到"结果反馈,而不静默成功为另一会话造成误删。
3. When 删除完成, the SessionEntryStore shall 不影响其余会话的条目与可读性。

### Requirement 8: 并发写入表现为树分叉而非冲突

**Objective:** 作为调用方,我想让针对同一会话、同一父节点的并发写入安全共存,以便多端/多分支探索不丢数据。

#### Acceptance Criteria

1. When 两次 `append` 以相同 `parentId` 并发写入同一会话, the SessionEntryStore shall 保留两条 entry 为该父节点的两个子节点,而不丢弃或互相覆盖。
2. The SessionEntryStore shall 以 `(sessionId, entry.id)` 作为幂等与去重依据,使重复写入不产生重复条目而并发不同 `id` 的写入均被保留。
3. While 存在对同一会话的并发追加, the SessionEntryStore shall 不产生条目交错损坏(每条 entry 要么完整可见、要么不可见)。

### Requirement 9: 会话版本识别与旧数据兼容

**Objective:** 作为调用方,我想在读取既有会话时自动识别其版本,以便兼容历史数据而无需手工迁移。

#### Acceptance Criteria

1. When 读取一个带 `version` 字段的会话头部, the SessionEntryStore shall 识别其版本(v1 线性 / v2 树 / v3 `custom` 改名)并据此正确解析条目。
2. Where 一个会话以历史版本(v1/v2)存储, the SessionEntryStore shall 在读取时将其条目以当前版本语义对调用方呈现,而不要求事先改写存储中的原始数据。
3. If 会话版本为未知或不受支持的取值, then the SessionEntryStore shall 以可识别错误报告,而不按错误版本静默解析。

### Requirement 10: 文件系统(fs)adapter 与 pi 布局兼容

**Objective:** 作为运维/既有工具使用者,我想 fs adapter 产出的文件与 pi 现有会话布局兼容,以便既有 pi 工具仍能识别这些会话。

#### Acceptance Criteria

1. Where 选用 fs adapter, the fs adapter shall 将每个会话存为一个独立的 JSONL 文件,每行一条 entry,首行为会话头部。
2. Where 选用 fs adapter, the fs adapter shall 按工作目录将会话文件分桶到与 pi `~/.pi/agent/sessions` 一致的目录命名规则下(cwd 路径分隔符按 pi 规则编码为桶目录名)。
3. When fs adapter 执行 `append`, the fs adapter shall 以顺序追加写入文件末尾,而不重写既有行。
4. When fs adapter 读取由 pi 既有布局产生的会话文件, the fs adapter shall 正确读回其头部与条目顺序。
5. The fs adapter shall 不要求修改第三方 pi-coding-agent 即可与其文件布局互通。

### Requirement 11: SQLite adapter

**Objective:** 作为单机部署者,我想用 SQLite 后端存储会话,以便在零运维的前提下获得结构化检索能力。

#### Acceptance Criteria

1. Where 选用 SQLite adapter, the SQLite adapter shall 将会话头部与条目持久化为结构化记录,使 `create`/`append`/`read`/`list`/`listAll`/`delete` 的可观察语义与 fs adapter 一致。
2. When SQLite adapter 执行 `read`, the SQLite adapter shall 以条目被追加的相同顺序产出全部 entry。
3. While 进程重启后重新打开同一 SQLite 存储, the SQLite adapter shall 读回此前持久化的会话与条目而不丢失。

### Requirement 12: PostgreSQL adapter 与多实例共享

**Objective:** 作为横向扩容部署者,我想用 PostgreSQL 后端存储会话,以便多个服务实例共享并检索同一份会话数据。

#### Acceptance Criteria

1. Where 选用 PostgreSQL adapter, the PostgreSQL adapter shall 使 `create`/`append`/`read`/`list`/`listAll`/`delete` 的可观察语义与 fs、SQLite adapter 一致。
2. When 多个服务实例连接到同一 PostgreSQL 存储, the PostgreSQL adapter shall 使一个实例写入的条目可被其他实例经 `read`/`list` 读到。
3. When 多个实例并发对同一会话、同一父节点 `append`, the PostgreSQL adapter shall 保留两条 entry 为分叉子节点并以 `(sessionId, entry.id)` 保证幂等(满足 Requirement 8)。

### Requirement 13: 跨 adapter 行为一致性

**Objective:** 作为接口的消费者,我想三种 adapter 对同一组操作产生相同的可观察结果,以便切换后端不改变上层行为。

#### Acceptance Criteria

1. When 对 fs、SQLite、PostgreSQL 三种 adapter 执行同一组 `create`→`append`/`appendBatch`→`read`→`list`→`delete` 操作, the SessionEntryStore shall 在三者上产出一致的条目顺序、头部内容与未找到/幂等/分叉语义。
2. The SessionEntryStore shall 提供一套与具体 adapter 无关的契约测试,使任一 adapter 可据其验证一致性。

### Requirement 14: 中间件可扩展接缝(本次不实现)

**Objective:** 作为未来的扩展者,我想存储抽象预留可叠加的中间件接缝(加密/写缓冲/缓存/遥测),以便后续无需改动 adapter 即可增强。

#### Acceptance Criteria

1. The SessionEntryStore shall 以可被包装/装饰的形式暴露接口,使未来可在不修改既有 adapter 的前提下叠加中间件。
2. The session-store-adapters 特性 shall 不在本次交付任何具体中间件实现(加密/缓冲/缓存/遥测均仅留接缝)。

### Requirement 15: 不修改第三方与质量约束

**Objective:** 作为维护者,我想本特性在不触碰第三方代码的前提下,以项目既定质量标准交付,以便安全集成且可被测试证明。

#### Acceptance Criteria

1. The session-store-adapters 特性 shall 不修改 `@earendil-works/pi-coding-agent` 的任何源码。
2. The session-store-adapters 特性 shall 落在 `@pi-web/server` 包内,且其代码满足 TypeScript strict、不使用 `any`。
3. The session-store-adapters 特性 shall 为每个 adapter 提供单元/集成测试,覆盖 create/append/read/list/delete、未找到语义、幂等与并发分叉,并以实际运行的测试输出作为通过证据。
4. Where adapter 需要外部依赖(SQLite/PostgreSQL 运行环境), the session-store-adapters 特性 shall 使其测试可在本项目既有测试运行方式下执行(具体驱动与测试夹具选型在设计阶段确定)。
