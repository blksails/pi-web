# Requirements Document

## Introduction
为 pi-web 引入一个 LSP 式的「触发符补全」框架:用户在会话输入框键入触发符(如 `@`、`/`、`$`)时,系统弹出可选候选并支持选中插入,候选由可插拔的服务端 `CompletionProvider` 提供。首个内置 provider 为 `file`(`@` 引用工作目录文件),框架须保证新增资源类型/触发符时端点与协议零改动。本特性是 pi-web 平台能力(跨 agent 通用),区别于 agent 专属的 webext `contributions.mention`(经 ui-rpc 回 agent)。

## Boundary Context
- **In scope**:`CompletionProvider` 抽象与服务端注册表;触发符并集与归一化;通用补全端点;多 provider 合并/优先级/排序/去重/超时降级;`file` provider(glob 会话 cwd + 安全边界 + 缓存);前端 core 挂载的分区补全浮层与 token 插入;提交期 `resolve`(v1 文本直传);node + 浏览器 e2e 验收。
- **Out of scope(v1)**:跨 cwd/远程文件、目录递归预览、`user`/`$env` provider 的真实生产后端(仅留 mock 证明可扩展性)、扩展 `PromptRequest` 协议加 `references` 字段的 3b-attach、把现有 slash 命令强行从 `get_commands` 拆成 provider。
- **Adjacent expectations**:复用既有会话 `header.cwd`、REST+SSE handler、鉴权与 project-trust 边界;复用现有输入浮层 UI 基础设施;不破坏现有 slash(`get_commands`)、webext `contributions.*` 与 prompt 流回归。

## Requirements

### Requirement 1: CompletionProvider 抽象与注册表
**Objective:** 作为 pi-web 平台开发者,我想要一个统一的服务端补全 provider 抽象与注册表,以便不同资源类型以一致契约接入补全。

#### Acceptance Criteria
1. The CompletionProvider Framework shall 定义 provider 契约,包含 `id`、单一 `trigger` 字符、可选 `kind`、可选 `priority`、`complete({query, ctx})` 方法与可选 `resolve(ref, ctx)` 方法。
2. The CompletionProvider Framework shall 提供注册接口,使一个 provider 注册后即纳入补全分发。
3. When 两个 provider 注册了相同 `id`,the CompletionProvider Framework shall 以确定性策略拒绝或覆盖并记录,避免静默歧义。
4. The CompletionProvider Framework shall 向 `complete`/`resolve` 注入 `CompletionCtx`(含 `sessionId`、`cwd`、`userId`),provider 不得自行从前端取这些值。
5. Where provider 未实现 `resolve`,the CompletionProvider Framework shall 在提交期对该 provider 的 token 保留原文本而不报错。

### Requirement 2: 触发符并集与归一化
**Objective:** 作为前端,我想要从宿主获知当前活跃触发符并对等价字符归一,以便正确判断何时进入补全且不被全角/别名干扰。

#### Acceptance Criteria
1. The CompletionProvider Framework shall 将「活跃触发符集」计算为所有已注册 provider `trigger` 的并集。
2. When 新增一个带此前未出现触发符的 provider,the CompletionProvider Framework shall 使该触发符自动进入活跃集,无需改动前端或端点代码。
3. When 输入中出现某触发符的等价形态(如全角 `＠`、`￥`),the CompletionProvider Framework shall 先归一化为规范触发符再分发,provider 仅接收规范符。
4. The CompletionProvider Framework shall 为每个触发符提供 token 提取规则(`extract(text, cursor)`),以从输入中得出查询串与替换区间;`/` 默认仅行首生效,`@`/`$` 默认在词尾非空白处生效。

### Requirement 3: 通用补全端点
**Objective:** 作为前端,我想要一个与资源类型无关的补全端点,以便新增资源/触发符时无需新增端点。

#### Acceptance Criteria
1. When 前端以会话 id、归一化 `trigger` 与查询 `q` 请求补全,the Completion Endpoint shall 选出 `trigger` 匹配的 provider、并发调用其 `complete`、合并后返回候选与分组信息。
2. The Completion Endpoint shall 在每个返回候选上携带 `kind`,以供前端分组渲染。
3. If 请求的会话 id 不存在或调用方无权访问,then the Completion Endpoint shall 拒绝请求并返回鉴权/未找到类错误而不泄露文件信息。
4. If 没有任何 provider 匹配该 `trigger`,then the Completion Endpoint shall 返回空候选集且不报错。
5. The Completion Endpoint shall 复用既有会话鉴权与 project-trust 边界,仅服务受信任会话。

### Requirement 4: 多 Provider 合并、优先级与降级
**Objective:** 作为用户,我想要同一触发符下多个 provider 的候选被有序、稳定地合并,以便结果可预期且不被慢 provider 阻塞。

#### Acceptance Criteria
1. When 多个 provider 匹配同一触发符,the Completion Endpoint shall 按统一排序键 `(priority 降序, score 降序, label 升序)` 对合并结果排序,并按 `kind`/provider 提供可分区的分组。
2. When 两条候选具有相同 `kind` 且相同 `id`,the Completion Endpoint shall 去重并保留 `priority` 较高者。
3. If 某 provider 的 `complete` 超过设定超时或抛错,then the Completion Endpoint shall 跳过该 provider 并返回其余已就绪候选,不使整体失败。
4. The Completion Endpoint shall 对返回候选数量设上限,超出部分截断。

### Requirement 5: file Provider 与文件枚举
**Objective:** 作为用户,我想要用 `@` 补全并引用工作目录内的文件,以便把文件带入对话,等同 pi CLI 的 `@` 体验。

#### Acceptance Criteria
1. The file Provider shall 以 `trigger` 为 `@`、`kind` 为 `file` 注册。
2. When 收到查询串,the file Provider shall 枚举会话 `cwd` 下文件并按查询做模糊匹配后返回相对路径候选。
3. The file Provider shall 在枚举时尊重 `.gitignore` 并跳过 `node_modules`、`.git` 等目录。
4. While 同一会话短时间内重复查询,the file Provider shall 复用带 TTL 的内存文件清单缓存以避免每次重新遍历整棵目录树。
5. When 仓库文件数超过设定遍历上限,the file Provider shall 截断结果并标示已截断。

### Requirement 6: 安全边界
**Objective:** 作为运维/安全负责人,我想要文件补全与读取严格限制在受信任工作目录内,以便不发生路径穿越或越权读取。

#### Acceptance Criteria
1. If 解析后的目标路径(经 realpath)不在会话 `cwd` 的 realpath 前缀之内,then the file Provider shall 拒绝该路径并将其排除出候选与读取结果。
2. The file Provider shall 阻止经 `../` 或符号链接逃逸出 `cwd` 的访问。
3. Where 提交期需读取被引用文件内容,the file Provider shall 对单文件读取设大小上限,超限则不内联并给出可观察标示。
4. The Completion Endpoint shall 仅向通过鉴权且拥有该会话的调用方提供文件信息。

### Requirement 7: 前端补全浮层与 token 插入
**Objective:** 作为用户,我想要在输入框内对任意活跃触发符看到分区候选浮层并可选中插入,以便用键盘高效引用资源。

#### Acceptance Criteria
1. The pi-web 输入界面 shall 默认(core 内置)对活跃触发符启用补全浮层,而不依赖某个 agent 声明 `contributions.mention`。
2. When 用户在输入中键入活跃触发符并继续输入查询,the pi-web 输入界面 shall 调用通用补全端点并在输入框附近渲染候选浮层。
3. The pi-web 输入界面 shall 按候选的 `kind` 分区渲染并标示来源。
4. When 用户选中一条候选,the pi-web 输入界面 shall 用带类型回环的 token(如 `@file:<相对路径>`)替换触发符起始的查询区间并补一个尾随分隔。
5. While slash(`/`)、mention(`@`)与其他触发符浮层条件同时可能成立,the pi-web 输入界面 shall 保证浮层互斥让位,不同时叠加冲突。
6. If 补全请求失败或返回空,then the pi-web 输入界面 shall 安全收敛(不弹空框、不抛错、不阻塞输入)。

### Requirement 8: 提交期引用解析
**Objective:** 作为用户,我想要提交含 `@file:...` 等 token 的消息后 agent 真能看到被引用资源,以便引用产生实际效果。

#### Acceptance Criteria
1. When 用户提交含补全 token 的消息,the CompletionProvider Framework shall 扫描出各 token 并按其 `kind` 分发给对应 provider 的 `resolve`。
2. Where 当前为 v1 文本直传模式,the CompletionProvider Framework shall 将含 `@file:<路径>` 的消息原样传给 agent,使具备读文件能力的真实 agent 可据路径读取。
3. If 某 token 无法解析(provider 缺失或 `resolve` 失败),then the CompletionProvider Framework shall 保留原始 token 文本且不阻断消息发送。
4. The CompletionProvider Framework shall 不改变既有不含 token 的消息发送行为(回归保持)。

### Requirement 9: 可扩展性验证
**Objective:** 作为平台开发者,我想要框架以「加 provider」而非「加端点/改协议」的方式扩展,以便未来接入用户名、变量等资源。

#### Acceptance Criteria
1. When 新增一个针对新资源(如 `user`)的 provider,the CompletionProvider Framework shall 仅经注册即可在通用端点与前端浮层生效,无需修改端点或前端分发代码。
2. Where 提供示例性 `user`(`@`)或 `env`(`$`)provider 用于演示,the CompletionProvider Framework shall 允许其与 `file` provider 在同/异触发符下共存且按优先级排序。
3. The CompletionProvider Framework shall 不要求单个 provider 声明多个触发符;多触发符能力须经注册多个 provider 达成。

### Requirement 10: 验收测试
**Objective:** 作为维护者,我想要离线与浏览器双层 e2e 覆盖关键路径,以便在不依赖付费 LLM 的前提下守住回归。

#### Acceptance Criteria
1. The 验收测试 shall 包含 node 端 e2e:经真实 handler 验证通用补全端点对 `@` 返回 cwd 文件候选,且包含路径穿越被拒用例。
2. The 验收测试 shall 包含浏览器 e2e:在真实会话输入框键入 `@` 后弹出文件候选浮层、选中后输入框被插入 `@file:<路径>` token。
3. The 验收测试 shall 与既有套路一致(node e2e 仿 `e2e/node/webext-uirpc.e2e.test.ts`,浏览器 e2e 仿 `e2e/browser/webext-full.e2e.ts`,隔离 build 用 `NEXT_DIST_DIR=.next-e2e`)。
4. The 验收测试 shall 验证不破坏既有 slash、webext 贡献与 prompt 流回归。
