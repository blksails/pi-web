# Research & Design Decisions

## Summary
- **Feature**: `session-store-adapters`
- **Discovery Scope**: Extension(向既有 `@blksails/server` 增量加入存储模块)
- **Key Findings**:
  - 第三方 `pi-coding-agent` 的 `SessionManager` 把树逻辑(`buildSessionContext` 纯内存)与文件 IO 收口耦合,但收口极干净:写口唯一(`_persist`)、读口为 `loadEntriesFromFile` + 列举 `readdir`、桶编码在 `session-manager.js:223`。可作为格式参照,**无需且不会修改**它。
  - `node:sqlite`(`DatabaseSync`)在本机 Node v22.22.0 内置可用(experimental,带一次性警告),sqlite adapter 因此**零新增运行时依赖**。
  - 项目现无 `pg`/`pg-mem`/`better-sqlite3` 依赖;postgres adapter 需新增运行时依赖 `pg`,测试用 `pg-mem`(纯 JS 内存 PG,免外部服务)做契约测试,真实 PG 经 `TEST_POSTGRES_URL` 可选接入。

## Research Log

### 第三方 SessionManager 的存储收口与格式
- **Context**: 需要在不改第三方包的前提下,产出与 pi 会话布局兼容的 fs 存储。
- **Sources Consulted**: 第三方 `dist/core/session-manager.js`(`_persist:637`、`loadEntriesFromFile:246`、桶编码 `:223`、文件名时间戳 `:579/998/1144`)、`docs/session-format.md`、`docs/sessions.md`、本机 `~/.pi/agent/sessions/` 实样。
- **Findings**:
  - 桶目录名:`--${cwd.replace(/^[/\\]/,"").replace(/[/\\:]/g,"-")}--`。
  - 会话文件名:`<ISO时间戳,: . → ->_<uuidv7>.jsonl`;首行为 `{"type":"session","version":3,"cwd":...}` header。
  - entry 树:每行一对象,`id`(8 位 hex)+ `parentId`;header 不入树。
  - version:v1 线性 / v2 树 / v3 `hookMessage`→`custom`,旧档加载时迁移。
- **Implications**: fs adapter 的桶编码、文件名、JSONL 行格式严格复刻这套规则即满足 R10;codec 层把这些规则做成纯函数,sqlite/pg 复用同一套 entry 序列化。

### SQLite 驱动选型
- **Context**: sqlite adapter 需要一个 Node 可用的 SQLite 驱动。
- **Sources Consulted**: 本机 `node -e` 实测 `node:sqlite`;Node 22 发行说明(`node:sqlite` 自 22.5 起 experimental)。
- **Findings**: `DatabaseSync` 同步 API(`exec`/`prepare`/`run`/`get`/`all`/`iterate`),`:memory:` 与文件库均可;实测插入/查询通过,仅打印一次 `ExperimentalWarning`。
- **Implications**: 选 `node:sqlite`,零依赖;同步调用在 adapter 内用 `Promise.resolve()` 包装为异步接口;测试通过 `--no-warnings` 或忽略该 warning。

### PostgreSQL 驱动与测试
- **Context**: postgres adapter 需真实 PG 协议,且要能在无外部服务的 CI 下测。
- **Sources Consulted**: `pnpm-lock.yaml`(确认无既有 pg);node-postgres(`pg`)与 `pg-mem` 文档常识。
- **Findings**: `pg` 是事实标准;`pg-mem` 提供 `db.adapters.createPg()` 返回与 `pg` 兼容的 `{Pool,Client}`,纯内存、无需服务。
- **Implications**: 运行时依赖 `pg`;devDependency `pg-mem`。adapter 经构造注入 `Pool`,测试注入 pg-mem 的 Pool;`TEST_POSTGRES_URL` 存在时附加跑真实 PG。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Ports & Adapters(选用) | `SessionEntryStore` 端口 + fs/sqlite/pg 适配器,领域树逻辑在外 | 边界清晰、可契约测试、换后端零侵入 | 需建 codec + 适配层 | 契合 steering「传输/隔离用接口隔开」 |
| 直接各后端独立实现 | 每后端各写一套读写 | 短期省一层 | 语义漂移、无法统一契约测试 | 否决 |
| 抽象整个 SessionManager | 连树逻辑一起抽 | 一站式 | 过度、与第三方耦合、违「只抽 IO」 | 否决 |

## Design Decisions

### Decision: 只抽 IO,不抽领域(树运算留在调用方)
- **Context**: R1.2/R1.5 要求接口只承担存取。
- **Selected Approach**: 接口仅 `create/append/appendBatch/read/readHeader/list/listAll/delete`;`buildSessionContext`/分支选择由调用方基于 `read()` 取回的条目在内存完成。
- **Rationale**: 与第三方设计一致(树逻辑本就是纯内存),最小接口面,易测。
- **Trade-offs**: 调用方需自行重建树;但这正是领域层职责。

### Decision: 三后端的幂等与并发分叉
- **Context**: R3.4/R8.2 幂等键 `(sessionId, entry.id)`;R8.1 并发同父=分叉。
- **Selected Approach**: sqlite `PRIMARY KEY(session_id,id)` + `INSERT ... ON CONFLICT DO NOTHING`;pg 同;fs 以「每会话写串行化 + 已见 id 集合」做进程内幂等,跨进程为 best-effort。并发不同 `id` 一律保留为父节点的多个子节点。
- **Rationale**: SQL 后端天然原子幂等;append-only 文件无法无读去重,串行锁 + id 集合是务实折中。
- **Trade-offs**: fs 跨进程并发的重复 id 去重不保证(append-only 文件的固有限制,已在文档标注)。

### Decision: 写入不交错(R3.5/R4.2/R8.3)
- **Selected Approach**: fs 每会话一个 promise 链锁,`append` 整行/`appendBatch` 整缓冲一次 `appendFile` 写;sqlite 单连接语句原子;pg `appendBatch` 包事务。
- **Rationale**: 保证「每条 entry 要么完整可见要么不可见」与批次可见性一致。

### Decision: 版本兼容在读路径归一(R9)
- **Selected Approach**: codec `normalizeOnRead(header, entry)`:v<3 把 `hookMessage`→`custom`;v1 无 `parentId` 时按行序合成链;未知 version → `UnknownSessionVersionError`。不回写存储原始数据。
- **Rationale**: R9.2 要求不改写原始存储即以当前语义呈现。

### Decision: 中间件接缝(R14,仅留口)
- **Selected Approach**: `SessionEntryStore` 为可被装饰的接口;文档给出 `class XxxStore implements SessionEntryStore { constructor(private inner: SessionEntryStore){} }` 装饰器范式;本次不实现任何中间件。

## Risks & Mitigations
- `node:sqlite` 为 experimental,未来 API 可能变 — 收口在单一 adapter 文件,变更面可控;测试以行为断言而非内部 API。
- fs 跨进程并发幂等为 best-effort — 文档明示;SQL 后端提供强幂等供需要强一致的部署选用。
- 新增 `pg` 运行时依赖 — 仅 postgres adapter 引用,采用动态/惰性导入避免未用 PG 的部署被迫加载。

## References
- 第三方 `@earendil-works/pi-coding-agent` `docs/session-format.md`、`dist/core/session-manager.js`(格式与收口参照,**不修改**)
- Node.js `node:sqlite`(DatabaseSync,Node ≥22.5 experimental)
- node-postgres `pg`、`pg-mem`(测试用内存 PG)
