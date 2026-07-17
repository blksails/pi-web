# Requirements Document

## Project Description (Input)

为 pi-web agent 提供可插拔的**长期记忆扩展**：以类似 skills 的本地文件（YAML frontmatter + Markdown 正文）为本地开发默认形态；云上可切换到 Supabase；默认跨 agent source 全局共享，并可选按 agent-source 隔离。以 tool-kit `ExtensionFactory` + 示例 agent 交付。

## Introduction

现状 agent 会话之间没有结构化、可跨会话/跨 agent source 复用的记忆能力：用户偏好、项目约定、历史结论只能依赖会话上下文或手工落盘。本特性交付 **Memory 扩展**：agent 可调用工具写入/读取/列举/搜索/删除记忆条目；存储后端可插拔（本地文件 / Supabase），本地开发默认文件存储（skills-like 文档），云上可用 Supabase；默认全局作用域实现跨 agent source 共享，并支持按 agent-source 隔离。

## Boundary Context

- **In scope**: 记忆条目数据模型（skills-like 元数据 + 正文）、`MemoryStore` 端口、file 与 supabase 两种后端、env 配置选择后端、agent 可调用工具表面、进程内 `memoryExtension`、示例 agent、契约测试。
- **Out of scope**: 向量/语义检索、embedding、记忆自动抽取（会话结束静默写入）、前端记忆面板 UI、REST `/api/memory`、配额/TTL 生命周期管理、跨租户鉴权策略、多后端 union 同时写。
- **Adjacent expectations**: 不修改 session-engine / attachment 存储；不强制注入全部会话（agent 显式 `extensions: [memoryExtension]` 装载）；与 skills 资源发现无关（记忆不是 skill，仅文件形态类似）。

## Requirements

### Requirement 1: Skills-like 记忆条目

**Objective:** As an agent operator, I want 每条记忆以「元数据 + 正文」文档形态表达（本地落盘时即 Markdown 文件 + YAML frontmatter）, so that 记忆可人工检视、版本管理，并与 skills 心智模型一致。

#### Acceptance Criteria
1. The Memory Service shall 将每条记忆表达为至少包含 `name`（稳定标识）、可选 `description`、可选 `tags`、`scope`、正文 `content`，以及创建/更新时间戳的文档。
2. Where 使用文件后端, the Memory Service shall 以 YAML frontmatter + Markdown 正文的单一 `.md` 文件持久化每条记忆，frontmatter 字段与条目元数据一一对应。
3. When 写入合法记忆, the Memory Service shall 产出可再读回的完整条目（元数据与正文往返一致，允许时间戳由服务填充）。

### Requirement 2: 可插拔存储后端

**Objective:** As a 宿主运维者, I want 用环境变量在本地文件与 Supabase 之间选择记忆后端, so that 本地开发与云上部署可用同一套 agent 工具表面。

#### Acceptance Criteria
1. While 未配置或配置为文件后端, the Memory Service shall 使用本地文件系统后端（默认目录可由环境变量覆盖）。
2. Where 配置为 Supabase 后端且凭据齐全, the Memory Service shall 将记忆读写落到 Supabase（表/行语义与文件条目模型等价）。
3. If 后端 kind 未知或 Supabase 配置不完整, then the Memory Service shall 在装配期以明确错误失败，不得静默降级到另一后端。
4. The Memory Service shall 保证 file 与 supabase 两后端对同一端口操作（写/读/列/搜/删）行为一致（同一契约测试套件）。

### Requirement 3: 跨 agent source 共享与可选隔离

**Objective:** As an agent author, I want 默认全局共享记忆、并可选择按 agent source 隔离, so that 多 agent 可共享约定，也互不污染。

#### Acceptance Criteria
1. When 写入时未指定隔离作用域, the Memory Service shall 将记忆写入 **global** 作用域，使任意 agent source 可读取。
2. When 写入时指定 agent-source 作用域并提供 agent source 标识, the Memory Service shall 仅在该 agent source 可见范围内存放该记忆。
3. When 读取/列举/搜索时, the Memory Service shall 默认包含 global 记忆；若调用方提供 agent source 标识，则额外包含该 source 的隔离记忆。
4. When 读取 agent-source 隔离记忆时若未提供匹配的 agent source 标识, the Memory Service shall 不返回该隔离条目。

### Requirement 4: 精确 name + 关键词/tags 检索

**Objective:** As an agent, I want 按 name 精确读写，并按关键词与 tags 过滤列举/搜索, so that 可稳定 recall 与浏览记忆库。

#### Acceptance Criteria
1. When 按 `name` 读取且条目存在且作用域可见, the Memory Service shall 返回完整条目（含正文）。
2. When 按 `name` 读取且条目不存在或不可见, the Memory Service shall 返回明确的未找到结果（不抛未捕获异常）。
3. When 列举时带 tags 过滤, the Memory Service shall 仅返回 tags 与过滤条件匹配的条目元数据（可不含完整正文）。
4. When 搜索关键词, the Memory Service shall 在 name、description、tags、content 中做不区分大小写的子串匹配，返回匹配条目的元数据列表。
5. When 写入同名同作用域记忆, the Memory Service shall 覆盖更新正文与可变元数据（upsert），并刷新更新时间戳。

### Requirement 5: Agent 可调用工具表面

**Objective:** As an agent author, I want 通过扩展注册记忆工具, so that 模型可在会话中 remember / recall。

#### Acceptance Criteria
1. The system shall 以进程内 `ExtensionFactory`（`memoryExtension`）注册至少覆盖：写入、按 name 读取、列举、删除、关键词搜索 的工具。
2. Tool parameters shall 经 schema 校验（TypeBox / 等价）。
3. When 工具执行成功或业务失败, the tools shall 返回结构化结果（含成功标志或稳定错误码），不抛未捕获异常。
4. The example agent source shall 通过 `extensions: [memoryExtension]`（或等价）装载记忆能力并在 system prompt 中说明用法。

### Requirement 6: 可测试性与可运维

**Objective:** As a developer, I want 契约测试与明确 env 文档, so that 两后端与工具行为可回归。

#### Acceptance Criteria
1. The system shall 提供与后端无关的契约测试，至少覆盖：upsert 往返、同名覆盖、global 跨读、agent-source 隔离、list tags 过滤、search 关键词、delete 幂等。
2. Where 文件后端在临时目录上运行契约测试, all 验收场景 shall 通过。
3. Where Supabase 后端以 mock/fetch 替身或可选真实实例运行, 契约场景 shall 与文件后端一致（或文档化跳过条件）。
4. The design/docs shall 记录后端选择与相关环境变量名称与默认值。
5. The system shall 提供 e2e：经真实 runner 装载 `memoryExtension`（示例 agent 或等价路径），在 file 后端上完成 write→read，正文一致且本地落盘为 skills-like 文档。
