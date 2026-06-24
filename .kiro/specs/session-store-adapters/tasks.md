# Implementation Plan

> 边界来自 design.md「Architecture Pattern & Boundary Map」:`types` / `codec` 为共享基础;`FsSessionEntryStore` / `SqliteSessionEntryStore` / `PostgresSessionEntryStore` 为互不重叠的三个 adapter 边界。三 adapter 在 Foundation 完成后可并行(`(P)`)。

- [x] 1. Foundation:契约、依赖、纯函数核心与契约测试工厂

- [x] 1.1 定义存储接口、数据类型与错误类型
  - 定义异步接口:`create` / `append` / `appendBatch` / `read`(异步可迭代)/ `readHeader` / `list` / `listAll` / `delete`,只承担存取、不含树运算。
  - 定义会话头部、entry 判别联合(message/model_change/thinking_level_change/compaction/branch_summary/label/session_info/custom/custom_message)、列举元数据;未知负载用 `unknown`,禁 `any`。
  - 定义四个具名错误:会话不存在、会话已存在、未知版本、条目解析错误。
  - 接口以可被装饰(包裹 inner)的形式暴露,为中间件留接缝;本任务不实现任何中间件。
  - 观察完成:`pnpm -C packages/server typecheck` 通过,接口/类型/错误从模块可导入。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 14.1, 14.2_

- [x] 1.2 引入 PostgreSQL 运行时依赖与测试依赖
  - 在 `@blksails/pi-web-server` 增 `pg` 运行时依赖、`pg-mem` 与 `@types/pg` 测试依赖,`pnpm install` 成功。
  - sqlite 使用 Node 内置 `node:sqlite`,本任务不新增其运行时依赖,仅确认本机 Node ≥22 可加载。
  - 观察完成:`pnpm install` 后测试代码可 `import` pg 与 pg-mem;lockfile 更新。
  - _Requirements: 12.1, 15.4_

- [x] 1.3 实现序列化/解析/编码与版本归一的纯函数,并单测
  - 实现头部与 entry 的序列化、单行解析(解析失败抛"条目解析错误"并带定位)。
  - 实现工作目录→桶目录名编码、会话文件名编码,规则与 pi 既有布局一致。
  - 实现读路径版本归一:v<3 将 `hookMessage` 角色归一为 `custom`;v1 线性数据合成父子链;未知版本抛"未知版本错误";不回写存储原始数据。
  - 观察完成:`codec.unit.test.ts` 覆盖桶/文件名/往返序列化/解析失败/各版本归一,全部通过。
  - _Requirements: 2.2, 5.1, 5.5, 9.1, 9.2, 9.3, 10.1, 10.2_
  - _Depends: 1.1_

- [x] 1.4 编写与 adapter 无关的契约测试工厂
  - 提供一个以 "构造 store 的工厂" 为入参的契约用例集合,供三 adapter 复用。
  - 覆盖:创建+读头部、追加后按序读回、批量追加顺序与可见性、对不存在会话操作的未找到语义、重复同 id 幂等、同父并发追加=两个子节点、按 cwd/全局列举与空列举、整会话删除后不再出现且不影响其余会话。
  - 观察完成:工厂可被 adapter 测试 import 并参数化;在临时用例上自检可运行(可先用一个内存桩验证工厂本身)。
  - _Requirements: 13.1, 13.2_
  - _Depends: 1.1_

- [x] 2. Core:文件系统 adapter

- [x] 2.1 (P) 实现 fs adapter 并跑通契约与 pi 布局兼容
  - 每会话一个 JSONL 文件,首行头部、其后逐行 entry;按 cwd 分桶到与 pi `~/.pi/agent/sessions` 一致的目录命名;根目录可由构造参数覆盖(测试用 tmpdir)。
  - `append` 顺序追加不重写既有行;每会话写串行化(整行/整批一次写)保证不交错;进程内已见 id 集合实现幂等;同父不同 id 均保留为分叉。
  - `read` 逐行流式产出;`list`/`listAll` 遍历桶目录,空目录返回空清单;`delete` 删整文件并校验存在性。
  - 观察完成:`fs-store.test.ts` 跑通契约工厂全部用例,且额外断言"读取预置的 pi 布局 JSONL 文件"成功、桶目录命名正确、并发写不交错。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 8.1, 8.2, 8.3, 10.1, 10.2, 10.3, 10.4, 10.5_
  - _Boundary: FsSessionEntryStore, codec_
  - _Depends: 1.3, 1.4_

- [x] 3. Core:SQLite adapter

- [x] 3.1 (P) 实现 sqlite adapter 并跑通契约与重启持久化
  - 经构造注入数据库句柄/路径(基于 Node 内置 sqlite);首次执行幂等建表(sessions、entries 表 + 顺序与父子索引)。
  - `append` 用冲突即忽略实现 `(sessionId, id)` 幂等;`appendBatch` 包事务保证批次可见性;`read` 按追加序流式产出。
  - 不存在会话的 `append`/`read`/`readHeader`/`delete` 抛会话不存在;`delete` 级联清除条目。
  - 观察完成:`sqlite-store.test.ts` 跑通契约工厂全部用例,且额外断言"重开同一库文件后此前数据仍可读回"。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 8.1, 8.2, 8.3, 11.1, 11.2, 11.3_
  - _Boundary: SqliteSessionEntryStore, codec_
  - _Depends: 1.3, 1.4_

- [x] 4. Core:PostgreSQL adapter

- [x] 4.1 (P) 实现 postgres adapter 并用内存 PG 跑通契约与多实例可见性
  - 经构造注入连接池;`pg` 用惰性 import,未用 PG 的部署不加载;首次连接幂等建表(同 sqlite schema)。
  - `append` 用冲突即忽略实现幂等;`appendBatch` 包事务;`read` 流式产出;同父并发不同 id 均保留为分叉。
  - 观察完成:`postgres-store.test.ts` 用内存 PG(pg-mem)跑通契约工厂全部用例,断言"两个连接池共享同库时一方写入可被另一方读到";存在 `TEST_POSTGRES_URL` 时附加对真实 PG 运行同套用例。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 8.1, 8.2, 8.3, 12.1, 12.2, 12.3_
  - _Boundary: PostgresSessionEntryStore, codec_
  - _Depends: 1.2, 1.3, 1.4_

- [x] 5. Integration:模块导出与包集成

- [x] 5.1 导出存储模块并接入 @blksails/pi-web-server 公共入口
  - 模块内统一导出接口、错误类型、三个 adapter 与 codec 公共纯函数。
  - 在 `@blksails/pi-web-server` 包入口再导出,使外部可从包名导入。
  - 观察完成:新增一个集成用断言/示例,从 `@blksails/pi-web-server` 导入 `SessionEntryStore` 与三个 adapter 并 typecheck 通过。
  - _Requirements: 1.1, 1.3_
  - _Depends: 2.1, 3.1, 4.1_

- [x] 6. Validation:跨 adapter 一致性与全量证据

- [x] 6.1 验证三 adapter 行为一致并产出新鲜测试证据
  - 确认 fs/sqlite/postgres 三者跑同一契约工厂套件均全绿(条目顺序、头部、未找到、幂等、分叉语义一致)。
  - 运行 `@blksails/pi-web-server` 全量单元/集成测试与 `typecheck`,确认 strict 无 `any`、未触碰第三方 `pi-coding-agent` 任何文件。
  - 观察完成:贴出 `pnpm -C packages/server test` 与 `typecheck` 的实际通过输出作为证据(参考 kiro-verify-completion);git 变更仅限本 spec 范围内文件。
  - _Requirements: 13.1, 13.2, 15.1, 15.2, 15.3_
  - _Depends: 5.1_

## Implementation Notes
- 错误类型以 `SessionStore*` 前缀命名(`SessionStoreNotFoundError`/`SessionStoreConflictError`),避免与 session-engine 已导出的 `SessionNotFoundError`(活跃会话注册表概念)在包级 barrel `export *` 中冲突。
- `node:sqlite` 经 `createRequire(import.meta.url)` 惰性加载,类型用 `import type`——否则 vite/vitest 静态解析这个较新内置模块会报 "Failed to load url sqlite"。
- `pg` 仅 `import type`(Pool/QueryResult),运行时由调用方注入 Pool;adapter 文件运行时不加载 pg,未用 PG 的部署不受影响。
- v1 历史兼容:真实 v1 entry **无 id 字段**(id 是第三方 migrateV1ToV2 才生成)。codec 用 `parseEntryLoose` + 版本感知 `makeReadNormalizer` 按文件行号(header=0)合成 `id=v1-<n>`/`parentId` 链,并转换 compaction 的 `firstKeptEntryIndex`→`firstKeptEntryId`;不回写存储。sqlite/pg 只存自写的带 id v3 数据,用 `makeStoredEntryNormalizer`(不合成 id)。
- pg-mem 测试需 `newDb({ noAstCoverageCheck: true })` 绕过其对 CREATE TABLE 约束的严格 AST 覆盖检查(真实 PG 无此限制)。
- 已知边界(Minor):真实 PostgreSQL 高并发下,两事务可能取到相同 `MAX(seq)` 基线致 seq 重复,届时同 seq 节点顺序由 `ORDER BY seq, id` 的 id 兜底(确定性保留);强一致排序需 advisory lock/sequence,本次未做。
