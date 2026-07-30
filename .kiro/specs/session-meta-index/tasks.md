# Implementation Plan

> 前置：worktree 依赖已安装（`pnpm install` 已完成）。改注入路由/装配依赖后需重启 dev（handler 单例 pin 在 `globalThis`）。浏览器 e2e 用隔离 build + external server。
> 索引默认路径 `~/.pi/agent/piweb-session-index.json`（在 `~/.pi/agent/sessions/` **之外**）；测试一律注入临时路径，**不得**写用户真实索引。

- [x] 1. 基础：共享契约与端口
- [x] 1.1 定义交互类 extension-ui method 的单一权威并扩展列表项契约
  - 在协议层导出「需用户回包的交互类 method 集合」（`select` / `confirm` / `input` / `editor`）与其类型，作为前后端唯一权威；推送类（`notify` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text`）不属其中。
  - 会话列表项契约新增可选「活跃态」字段，取值为工作中 / 等待用户交互 / 异常三者之一；缺省表示空闲。既有字段与解析行为不变（旧消费者按未知字段忽略）。
  - 加守卫测试：交互类与推送类两集合的**并集等于**请求联合的 method 全集、**交集为空**。断言须以 schema 推导出的全集做差集比较，**不得**写成「常量 A 等于常量 A」式的重言式。
  - 观察完成：协议包类型检查通过；守卫测试在故意漏登记一个 method 时会失败（先证明它能报红）；列表项契约对含活跃态字段的负载解析保留该字段、对非法取值拒绝。
  - _Requirements: 7.2, 7.6, 9.4_
  - _Boundary: protocol 契约 — `packages/protocol/src/rpc/extension-ui.ts`, `packages/protocol/src/transport/rest-dto.ts`, `packages/protocol/test/rpc/extension-ui-methods.test.ts`_

- [x] 1.2 定义会话展示元数据的端口契约
  - 定义元数据条目类型（标题、所属 agent-source、最近写入时间三个可选字段）与索引端口（全量读、字段级合并写、移除单条、按现存会话集合清理残留）。
  - 类型上**不含**任何会话正文派生字段，也**不含**任何运行时状态字段。
  - 端口契约明确「所有方法绝不抛出，失败即视为无元数据」这一约束，并在类型注释中固定该语义。
  - 观察完成：内核包类型检查通过，端口与条目类型可从内核包子路径导入。
  - _Requirements: 1.4, 7.8_
  - _Boundary: 元数据端口 — `packages/core/src/session-meta/types.ts`, `packages/core/src/session-meta/index.ts`_

- [x] 2. 核心实现
- [x] 2.1 (P) 实现集中 JSON 文件元数据索引
  - 实现端口：读取全量（含版本位判定）、字段级合并写、移除单条、按现存会话集合清理残留并返回清除条数。
  - 写路径：取跨进程互斥 → 读并解析现有内容 → 合并补丁 → 写临时文件 → 原子替换 → 释放。互斥用 Node 内置能力实现（**不得**引入新依赖），带获取超时与陈旧锁清理；超时即放弃本次写入并保持已有内容不变。
  - 读路径降级：文件不存在 / 内容不可解析 / 版本不识 → 返回空结果且不抛；逐条目**逐字段**校验，某字段类型不符只丢弃该字段、保留同条目其余字段与其他条目。
  - 路径解析：默认落在会话目录之外的固定路径，可经环境变量覆盖；测试注入临时路径。
  - 单测须含**真并发**：并行（非串行）对不同会话标识写入后读回包含全部键；写入过程中并发读取只得到旧或新的完整内容。
  - 观察完成：上述单测全绿；删除索引文件后读取返回空结果而非抛错；写乱码后读取同样返回空结果；并发用例在去掉锁的情况下会失败（证明锁真的在起作用）。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.3, 9.1, 9.3_
  - _Depends: 1.2_
  - _Boundary: JsonFileSessionMetaIndex — `packages/core/src/session-meta/json-file-index.ts`, `packages/core/test/session-meta/json-file-index.test.ts`_

- [x] 2.2 (P) 实现活跃态派生纯函数
  - 依据「轮次是否进行中」「会话生命周期」「当前挂起的 extension-ui 请求 method 列表」派生活跃态，优先级为：等待用户交互 > 异常 > 工作中 > 空闲（空闲返回缺省值而非字符串）。
  - **必须**按任务 1.1 的交互类集合过滤挂起 method；推送类不得产生「等待用户交互」。
  - 无 IO、不读时钟，相同输入恒等输出。
  - 单测穷举优先级组合，并含专用用例：挂起表中只有推送类请求时派生结果为空闲（这是本特性最易出错处——服务端挂起表确实会混入推送类）。
  - 观察完成：穷举用例全绿；把过滤逻辑去掉后「只有推送类」那条用例会失败。
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.7_
  - _Depends: 1.1_
  - _Boundary: deriveActivity — `packages/core/src/session/derive-activity.ts`, `packages/core/test/session/derive-activity.test.ts`_

- [x] 2.3 (P) 实现来源色条的确定性派生
  - 由来源标识经稳定哈希取模固定调色板得出颜色；同一来源恒得同色，不读时钟与随机源。
  - 调色板需在明暗两种主题下均可辨（沿用项目既有主题色约定）。
  - 空串与异常输入不抛，返回中性回退色。
  - 观察完成：同输入多次调用结果一致；不同来源覆盖到调色板多个取值；单测全绿。
  - _Requirements: 6.3, 6.4_
  - _Boundary: sourceAccentColor — `packages/ui/src/elements/session-source-color.ts`, `packages/ui/test/elements/session-source-color.test.ts`_

- [x] 3. 集成接线
- [x] 3.1 会话对象暴露活跃态与标题变化通知
  - 会话对象新增只读活跃态投影，内部经任务 2.2 的派生函数计算，输入取自既有权威快照与既有挂起表；**不改**挂起表的登记规则、**不改**快照归约、**不新增**快照字段。
  - 新增可选的「标题已变化」回调，在处理标题设置请求时触发；回调抛错必须被吞掉，不得影响会话流程。
  - 观察完成：单测中构造处于轮次中的会话读到「工作中」；提交一个交互类挂起请求后读到「等待用户交互」；生命周期进入异常后读到「异常」；回调抛错时会话行为不变。
  - _Requirements: 1.2, 7.1, 7.2, 7.3, 7.5_
  - _Depends: 2.2_
  - _Boundary: PiSession — `packages/core/src/session/pi-session.ts`, `packages/core/test/session/pi-session-activity.test.ts`_

- [x] 3.2 列表端点投影元数据与活跃态
  - 端点新增两个**可选**依赖：元数据索引、活跃态查询回调。二者缺省时行为与改造前完全一致（既有测试不得修改）。
  - 标题三级优先级：存储返回的名称非空 → 用它；否则索引中的标题非空 → 用它且**不调用**扫文件派生；否则走既有派生并把结果**回填**索引（回填失败静默）。
  - 来源字段由索引填充；活跃态字段仅在查询回调返回非缺省值时写入，且取状态**不得**加载任何会话。
  - 索引每请求读取一次整份；读失败即空结果并退化到第一、三级。搜索分支按同一优先级解析标题后再做既有子串匹配，匹配语义不变。
  - 分页、排序、游标、系统视图门控语义一律不变；投影发生在分页之后（搜索分支保持既有的先全量解析行为）。
  - 观察完成：集成测试以**调用计数**断言「索引命中时扫文件派生一次都没被调用」；索引缺失/损坏时列表结果与改造前等价；创建过会话后端点响应体真的带来源字段；活跃会话项带活跃态、未加载会话项无该字段。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.6, 6.1, 6.2, 7.5, 7.6, 9.5, 9.7_
  - _Depends: 2.1, 2.2_
  - _Boundary: session-list 投影 — `packages/core/src/session-list/session-list-routes.ts`, `packages/core/test/session-list/session-list-routes.test.ts`, `packages/core/test/session-list/session-list-meta-projection.test.ts`_

- [x] 3.3 元数据写入挂点接线
  - 会话创建成功后写入所属 agent-source（取 resolver 的稳定来源标识）；该标识缺省时**不写**该字段，不得用工作目录冒充来源。
  - 会话改名成功后写入标题；会话删除成功后清除该会话的元数据条目。
  - 三处写入一律 fire-and-forget 且吞错：不改变原链路的响应码、响应体与时序。
  - 观察完成：集成测试证明创建后索引含来源、改名后索引标题更新、删除后索引键消失；把索引换成恒抛错的实现后三条链路的响应码与响应体不变。
  - _Requirements: 1.1, 1.3, 1.5, 1.6, 3.5, 5.1, 5.2_
  - _Depends: 2.1_
  - _Boundary: 元数据写入挂点 — `packages/core/src/http/routes/create-session.ts`, `packages/core/src/session-actions/session-actions-routes.ts`, `packages/core/test/session-actions/session-actions-meta.test.ts`, `packages/core/test/http/create-session-meta.test.ts`_

- [x] 3.4 装配层接线索引单例与活跃态聚合
  - 宿主装配依赖新增「元数据索引」与「活跃态查询」两项可选依赖，透传给会话列表、会话创建、会话操作三处能力工厂。
  - 活跃态查询由装配层用**活跃会话注册表**构造（注意与持久化存储同名不同物）：按标识检索活跃会话读其活跃态投影，不存在即缺省。
  - 应用层构造索引单例一次，并把会话对象的「标题已变化」回调接到索引写入。
  - 观察完成：应用运行后 `GET /sessions` 的**真实响应体**同时出现来源与活跃态字段（不以 stub 喂返回值代替验证）；三处能力任缺一根接线都能被本任务的断言发现。
  - _Requirements: 1.1, 1.2, 5.1, 7.5, 9.2_
  - _Depends: 3.1, 3.2, 3.3_
  - _Boundary: 装配接线 — `packages/server/src/host-assembly/default-capabilities.ts`, `lib/app/pi-handler.ts`, `packages/core/test/integration/session-meta-assembly.test.ts`_

- [x] 4. 前端展示
- [x] 4.1 (P) 列表面板渲染来源色条与状态指示
  - 列表项在有来源时显示来源标识与来源色条（色值取任务 2.3 的派生函数）；无来源时两者都不显示且布局不错位。
  - 列表项在有活跃态时显示对应指示：工作中为转圈、等待用户交互与异常各有可辨的视觉；空闲不显示任何指示。
  - 既有列表项信息（标识、时间、工作目录）与既有交互（整行点击恢复、操作菜单）保持不变。
  - 组件测试先 dump 真实 DOM 再据实断言，**不得**凭猜测的 testid 写断言。
  - 观察完成：给定含来源与活跃态的列表数据，组件渲染出色条与对应状态指示；同来源两项色条色值相同；无来源项不出现色条元素；空闲项不出现状态指示元素。
  - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6, 7.1, 7.2, 7.3, 7.6_
  - _Depends: 1.1, 2.3_
  - _Boundary: SessionListPanel — `packages/ui/src/elements/session-list-panel.tsx`, `packages/ui/test/elements/session-list-panel-activity.test.tsx`_

- [x] 4.2 (P) 活跃态变化时触发列表刷新
  - 聊天组件新增「活跃态已变化」回调，在轮次忙闲的**双向**边沿（开始与结束）以及交互挂起数从零变非零、从非零变零时触发。
  - 既有「轮末」回调的触发条件**不得**改动（另有消费者依赖其语义）；新回调与其并存。
  - 宿主把新回调接到既有的会话列表刷新信号（与既有 bump 合并为同一信号）。
  - 刷新期间列表项保持可见可点击、不闪空、不丢滚动位置（沿用面板既有占位行策略，不新增机制）。
  - 观察完成：组件测试证明忙态由假变真时新回调被调用一次（这是改造前**缺失**的时机）、由真变假时同样被调用，且既有轮末回调的调用次数与改造前一致。
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - _Boundary: 刷新时机 — `packages/ui/src/chat/pi-chat.tsx`, `components/chat-app.tsx`, `packages/ui/test/chat/pi-chat-activity-change.test.tsx`_

- [x] 5. 验证
- [x] 5.1 元数据规模治理与残留清理验证
  - 验证按现存会话集合清理残留：索引含已不存在会话的条目时被清除并返回正确条数；列表始终以实际存在的会话为准，残留条目不出现在响应中。
  - 观察完成：集成测试构造「索引有键但会话文件已不存在」的情形，断言该会话不出现在列表中，且清理后索引不再含该键。
  - _Requirements: 5.2, 5.3_
  - _Depends: 3.2, 3.3_
  - _Boundary: 残留治理验证 — `packages/core/test/session-meta/prune.test.ts`_

- [x] 5.2 性能证据：列一页的历史文件读取次数
  - 在同一批会话上分别以「索引全命中」与「无索引」两种条件列出一页，统计会话历史文件读取次数并对比。
  - 观察完成：索引全命中时该页的历史文件读取次数为 0；无索引时次数与页项数同阶。数值作为实测证据记入实现说明，**不以「更快」这类主张代替数字**。
  - _Requirements: 2.5_
  - _Depends: 3.2_
  - _Boundary: 性能证据 — `packages/core/test/session-list/session-list-read-count.test.ts`_

- [x] 5.3 命令行工具兼容性实测
  - 在存在索引文件的环境下实测 pi 命令行工具对同一批会话的列出、读取、恢复行为无错误、无变化。
  - 同时确认索引文件不在会话目录内，且会话目录内容（文件名、格式）未被本特性改动。
  - 观察完成：给出命令行实测的命令与输出作为证据；会话目录 diff 为空。
  - _Requirements: 9.1, 9.2_
  - _Depends: 3.4_
  - _Boundary: CLI 兼容验证 — `e2e/node/session-meta-cli-compat.test.ts`_

- [x] 5.4 浏览器端到端验证（隔离 build）
  - 覆盖四条关键路径：① 列表项显示标题、来源标识与色条，同来源同色、无来源不错位；② 发起一轮对话后列表项在轮次**开始**即出现工作中指示、结束后消失；③ 触发一个需用户回应的交互后列表项显示等待用户交互指示、回应后消失；④ 刷新期间列表项不闪空、可见可点击。
  - 时序类断言必须以真实浏览器为判据（单测全绿而浏览器全红有前科）。
  - 观察完成：四条路径的 e2e 用例全部通过，并有截图或 DOM 断言佐证。
  - _Requirements: 6.2, 6.3, 6.5, 7.1, 7.2, 8.1, 8.2, 8.3, 8.4_
  - _Depends: 3.4, 4.1, 4.2_
  - _Boundary: 浏览器 e2e — `e2e/browser/session-list-meta-activity.spec.ts`_

- [x] 5.5 已知边界的显式确认
  - 确认「其他会话的活跃态变化在下一次列表刷新时才反映」这一行为符合预期而非缺陷：以测试或实测记录该行为，并在实现说明中标注其为本期已接受的边界。
  - 确认存量会话（本特性启用前创建）无所属来源时按无来源展示、不显示来源标识与色条，且其标题可在首次列出时经既有派生取得。
  - 观察完成：两条行为各有一条断言或实测记录；实现说明中明确二者为已接受边界而非待修缺陷。
  - _Requirements: 8.5, 9.6, 9.7_
  - _Depends: 3.2, 4.2_
  - _Boundary: 边界确认 — `packages/core/test/session-list/session-list-legacy-sessions.test.ts`_

- [x] 6. 增量：会话状态按需轮询
- [x] 6.1 列表面板按需轮询会话状态
  - 周期可配（默认 5 秒，配 0 即关闭）；仅当列表中存在非空闲会话**且**页面可见时运行，
    全空闲或页面转入后台即停止；从后台回到前台立即补查一次。
  - 查询返回后**只**把状态合并进已显示的会话，不增删列表项、不改顺序、不影响已加载的分页。
  - 查询失败静默，不把列表推入错误态。
  - 观察完成：单测证明「有非空闲项则周期查询、全空闲则不查、关闭配置则不查、页面隐藏则不查」；
    并证明轮询返回少量项时**不会截断**已加载的长列表（把实现换成「重拉首页」该用例即变红）。
  - _Requirements: 8.5, 8.6, 8.7, 8.8, 8.9_
  - _Boundary: SessionListPanel 轮询 — `packages/ui/src/elements/session-list-panel.tsx`, `packages/ui/test/elements/session-list-panel-poll.test.tsx`_

- [x] 6.3 标题状态:无标题显示「新对话」
  - 列表项有标题时显示标题（来源为自动标题或用户改名）；无标题时显示「新对话」占位，
    不再回退显示会话标识的 uuid；会话标识移入悬停提示仍可查。
  - 改名输入框在无标题时预填空串（不必先删掉一串 uuid）。
  - 观察完成：单测覆盖「有标题显示标题 / 无标题显示新对话 / 空串按未设置处理 / uuid 仍在 hover 提示」；
    一个既有用例原本断言「未命名回退为 sessionId」，随行为变更同步更新并注明来由。
  - _Requirements: 6.7, 6.8_
  - _Boundary: SessionListPanel 标题 — `packages/ui/src/elements/session-list-panel.tsx`, `packages/ui/src/i18n/messages.ts`, `packages/ui/test/elements/session-list-panel-activity.test.tsx`, `packages/ui/test/elements/session-list-panel.test.tsx`_

- [x] 6.2 异常状态改用图标
  - 三种状态的视觉按用户要求定稿：**生成中**用 shadcn 风格 spinner（`Loader2` + `animate-spin`，
    与 pi-tool-part / attachments 同一写法，不另造自制圆环）；**请求人操作**用闪烁圆点
    （`animate-pulse`，把"需要人动手"与静态装饰区分开）；**异常**用 `AlertCircle` 图标。
  - 观察完成：既有状态指示测试仍全绿（断言依据是 `data-*` 属性而非内部结构）；
    经拦截响应的真机截图确认四态（生成中/请求人操作/异常/空闲）视觉可辨。
  - _Requirements: 7.1, 7.2, 7.3_
  - _Boundary: SessionListPanel — `packages/ui/src/elements/session-list-panel.tsx`_

- [x] 7. 增量：启动时清理索引残留
- [x] 7.1 装配层接入启动时残留清理
  - 应用启动构造索引后，异步清理一次「索引里有键但会话已不存在」的残留；现存会话集合
    取自**存储**（而非索引自身）。fire-and-forget + 吞错，绝不阻塞装配。
  - ★ 存储读取失败时**必须跳过清理**，不得把「读不到会话」当成「没有会话」而清空整份索引。
  - 观察完成：单测覆盖「按存储集合清理 / 重复启动幂等 / 存储不可用时索引不受损」；
    真机以「索引含 3 个孤儿键 + 1 个真实会话」启动，实测孤儿被清、真实会话元数据保留，
    日志出现 `session meta index pruned {removed:3}`。
  - _Requirements: 5.3_
  - _Boundary: 启动清理接线 — `lib/app/pi-handler.ts`, `packages/core/test/session-meta/prune-on-startup.it.test.ts`_

- [x] 8. 增量：元数据持久化经宿主状态端口（云端可实现）
- [x] 8.1 端口读取支持按需取用
  - 读取方法接受可选的会话标识集合：给定时只读这些会话，省略则读全量。
  - **两个实现语义必须一致**（整份存储的实现也要尊重该参数），否则调用方无法依赖。
  - 观察完成：一致性套件中「只返回指定会话」的用例在两个实现上都通过（初版文件实现忽略
    该参数直接返回全量，被套件当场抓到）。
  - _Requirements: 2.1, 2.2_
  - _Boundary: 端口 — `packages/core/src/session-meta/types.ts`, `packages/core/src/session-meta/json-file-index.ts`_

- [x] 8.2 实现建在宿主状态端口上的第二条实现
  - 按**每会话一键**存储（而非整份索引一个键）：契约保证单键原子可见性但不提供跨进程锁，
    整份存储在并发写下会互相覆盖，分键后不同会话写不同键即天然安全。
  - 会话标识用作键的一段前必须校验（键空间是安全边界），不合规静默拒写。
  - 所有方法绝不抛，失败即「无元数据」。
  - 观察完成：一致性套件（同一批断言跑两个实现）全绿；键空间安全用例证明危险标识一个都写不进去。
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.3, 3.5, 4.1, 4.2, 5.1, 5.3_
  - _Boundary: WorkspaceSessionMetaIndex — `packages/core/src/session-meta/workspace-index.ts`, `packages/core/test/session-meta/conformance.it.test.ts`_

- [x] 8.3 列表按页读取元数据 + 装配层选型
  - 列表端点非搜索路径改为**分页之后**按标识精确读取当前页（对分键实现是数量级差别）；
    搜索路径仍需全量。
  - 装配层按宿主形态选实现：本地用带锁的文件实现，云端经宿主依赖注入 Workspace 实现。
  - 观察完成：列表既有测试与投影测试全绿；导出面基准登记新符号后守卫通过。
  - _Requirements: 2.1, 2.4_
  - _Boundary: 装配与读取 — `packages/core/src/session-list/session-list-routes.ts`, `lib/app/pi-handler.ts`, `packages/server/test/compat/main-entry-symbols.txt`_

- [x] 9. 增量：会话列表全局化（移除按项目目录区分）
- [x] 9.1 契约与端点：恒全局
  - 列表请求删除视图范围、目标目录、按会话解析目录三个参数；响应删除视图回显与门控标志。
    端点恒返回本机全部工作目录下的会话；列表项保留所属目录字段。
  - 观察完成：端点不带任何参数即返回跨目录会话；旧的范围参数被忽略而非报错；
    既有分页/排序/搜索/错误码语义不变。
  - _Requirements: 见 sessions-list spec 的行为变更说明_
  - _Boundary: 契约与端点 — `packages/protocol/src/transport/rest-dto.ts`, `packages/core/src/session-list/session-list-routes.ts`, `packages/core/test/session-list/session-list-routes.test.ts`_

- [x] 9.2 装配与前端：移除门控与视图切换
  - 装配层删除系统视图门控依赖与默认目录依赖；应用层删除对应运行时开关与其下发。
  - 面板删除视图状态、双 Tab 切换与相关 props；搜索入口改为全局搜索。
  - 观察完成：前端无任何视图切换控件；类型检查全绿；既有面板测试（含操作菜单、收藏、
    刷新信号、轮询）全部通过。
  - _Boundary: 装配与前端 — `packages/server/src/host-assembly/default-capabilities.ts`, `lib/app/pi-handler.ts`, `lib/app/runtime-features.ts`, `server/bootstrap.ts`, `components/chat-app.tsx`, `packages/ui/src/elements/session-list-panel.tsx`, `packages/ui/src/elements/launcher-rail.tsx`, `packages/react/src/client/pi-client.ts`_

- [x] 9.3 文档与 e2e 随行为更新
  - 产品文档四处（会话列表、配置、部署、HTTP API）改为全局语义，并保留一条显式的行为变更说明。
  - 浏览器 e2e 中验证「视图门控 403」「无『全部』Tab 是因门控关闭」的断言随行为移除，
    改为验证「不存在视图切换」与「不带范围参数即可列出」。
  - 观察完成：三套会话列表 e2e 共 12 例通过；真机以两个不同项目目录各一个会话验证互相可见。
  - _Boundary: 文档与 e2e — `docs/product/{06,14,19,24}-*.md`, `e2e/browser/sessions-list.e2e.ts`_

## Implementation Notes

### 实测数据(Req 2.5 的机械证据)

`packages/core/test/session-list/session-list-read-count.it.test.ts` 统计 `store.displayName`
调用次数(fs 后端每次调用 = 顺读一整份 jsonl),12 项一页:

| 条件 | 历史文件读取次数 |
|---|---|
| 无索引(改造前行为) | **12**(= 页项数) |
| 索引全命中 | **0** |
| 部分命中(5/12) | **7**(= 未命中项数) |
| 首次列出后回填,第二次列出 | **0**(自愈) |

### pi CLI 兼容实测结论(Req 9.2)

`e2e/node/session-meta-cli-compat.e2e.test.ts` 用真实 pi CLI 0.80.7 实测三种布局:
`pi --print --session <id> --session-dir <dir>` 会解析会话并输出
`Session found in different project: <cwd>`(证明读懂了 jsonl),三种布局输出**逐字一致**。

- 结论:把索引放到 sessions 目录**之外**是保守选择,**并非必要** —— 即便放进目录内,
  本版本 CLI 行为也不变。仍维持"放外面"的决定(零风险,且不依赖 CLI 未来的扫描实现)。
- 判据设计两处踩坑并已修:① 无效 key 跑对话会触发长重试(每例 30s 超时)→ 改为不带 prompt
  只做会话加载;② CLI 在 fork 询问处等 stdin(每例 20s)→ 经 `< /dev/null` 喂 EOF,60s → 2.6s。

### 与设计的偏差(已同步回 design.md)

1. **标题优先级改为按后端分流**。design 初稿写「store.name 非空 → 用它」,那会回归 fs 后端:
   fs 的 `name` 是创建时的 header 名,既有代码刻意用 `displayName` 派生的 `session_info` 名
   **覆盖**它。改为:store 不实现 `displayName`(sqlite/postgres)→ 用 `store.name`;
   实现了(fs)→ 索引命中优先、未命中派生并回填。已回写 design.md 并留修正记录。
2. **装配测试落点从 core 移到 server**。`defaultCapabilities` 在 server 包,core 不能反向依赖,
   故 `session-meta-assembly.it.test.ts` 放 `packages/server/test/host-assembly/`。
3. **列表端点对索引读失败额外兜底**。端口契约声明"绝不抛",但端点不信任注入实现 ——
   `read()` 抛错时若不兜底会落到端点 catch → 500,违反 Req 3.5。已加 try/catch(有专用用例)。

### 增量:状态轮询(任务 6,用户在验收演示后追加)

Chrome 真机演示暴露了 Req 8.5 那条边界的实际观感:会话 B 在等用户回应,而 A 的页面上**连 B 都
没出现** —— 因为 A 自打开后没有任何刷新触发点。用户据此要求补轮询。

落法:面板内轮询(默认 5s;全空闲时放宽到 15s),页面不可见则不跑。关键约束是
**只合并状态与追加新项、不移除不重排**(Req 8.8):既有的 `refreshSignal` 走的是「重拉首页」,
每轮末一次尚可忍受,5 秒一次会把用户已「加载更多」的内容反复打回第一页。

★ **初版实现有两个缺陷,都是 Chrome 真机测出来的**(单测全绿):
  1. **鸡生蛋**:启停条件写成「列表中已有非空闲项才轮询」。可 A 的列表全空闲 → 不轮询 →
     永远发现不了 B 变忙,而这正是加轮询的全部目的。改为周期分层(忙 5s / 闲 15s),不停。
  2. **不增项**:合并逻辑只更新已显示项的状态。可 A 的列表里本来就没有后建的 B,
     只更新状态变不出 B 来。改为追加新出现的会话(置顶),同时仍不移除、不重排已有项。
  两个缺陷叠加,表现为真机上「A 等 12 秒毫无动静」。修复后真机复验:A 页面全程不操作,
  B 的等待状态自行出现在列表上。

### 判据判别力验证(先证明能报红,再信它报的绿)

四处关键判据都做了"摘掉实现看是否变红":

- 摘掉索引文件锁 → 3 个并发用例立刻变红(且伴随 tmp/rename 竞态 ENOENT),还原后 15 绿。
- 摘掉 `deriveActivity` 的 method 过滤 → 「只有推送类挂起判为空闲」等 3 例变红。
- 把 `onActivityChange` 退回只在下降边沿 → 「轮次开始也通知」等 2 例变红。
- 把轮询换成图省事的「重拉首页」 → 「不截断已加载列表」那例变红。

### 顺带发现的存量问题(不在本 spec 边界,仅记录)

服务端 `PiSession.handleExtensionUIRequest` 把**所有** extension-ui 请求无条件登记进挂起表,
其中推送类(`notify`/`setStatus`/`setWidget`/`setTitle`/`set_editor_text`)永不回包、在表里
无界累积(内存,随会话生命周期释放)。本 spec 以 method 过滤规避,未改其登记规则 ——
属 `PiSession` 挂起表语义,应另立 spec 或作为直接实现项处理。

### 新增模块须登记的三处守卫(踩到才知道)

新增 `packages/core/src/session-meta/` 顶层模块后,以下守卫按设计报红,逐一登记而非放宽:

1. `test/tiering/module-roster.ts` —— 模块必须显式归层(记为 `core`)。
2. `test/tiering/barrel-guard.test.ts` —— core 主 barrel 的每条 re-export 都要在名册内。
3. `packages/server/test/compat/main-entry-symbols.txt` —— 跨仓可见的导出面基准(新增 3 个符号)。

另:真写盘的测试文件必须按判定档位命名 `*.it.test.ts`,否则 tier-guard 判"声明比实际宽松"。

### ★ 浏览器 e2e 抓到的接线缺口(单测看不见)

`showSource` 门控**存在但宿主从未传过** —— 于是 `SessionListItem.source` 即便有值,真实应用里
也永远不显示来源标识。单测因显式传 `showSource` 而全绿,只有浏览器 e2e 会红。
修法:`components/chat-app.tsx` 装配处开启 `showSource`;并让**来源色条同受该门控**
(二者是「显示来源」一件事的两种表现,门控只管其一会在关闭时漏出来源信息)。

这与本 spec 之前发现的两个同类缺口是一个模式:组件、DTO、门控都就绪,唯独装配层少一根线。

### Workspace 化:为什么不是「整份索引存一个键」

用户问「线上的 pi-cloud 可以实现吗」时,第一直觉是把索引整份塞进 Workspace 的一个键 ——
`writeJson(merge:true)` 是深度合并,看起来正好能避免丢键。查了本地实现才发现:
`writeJson` = `read → deepMergeJson → writeFileAtomic`,**没有跨进程锁**。契约明写
「单键原子可见性 + 无跨键事务」,并不保证 read-modify-write 原子。

所以整份存一个键 = 把文件实现用锁解决的丢键问题原样搬回来,且这次没有锁可用。
改为**每会话一键**后,不同会话写不同键,契约给的单键原子性就够了,也不需要它不提供的
跨键事务。代价(全量读放大)由端口的 `read(sessionIds?)` 化解 —— 列表常态只读当前页。

### 全局化:被删掉的东西比加上的多

用户要求「session-list 总是全局的,不再区分项目目录」,并选了**彻底移除**而非默认值改变。
于是删掉的有:请求的 `scope`/`cwd`/`sessionId` 三个参数、响应的 `scope`/`globalEnabled` 两个
字段、`SessionListRoutesOptions` 的 `globalEnabled`/`defaultCwd`、`HostDeps.sessionsGlobalEnabled`、
运行时开关 `NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL` 及其 bootstrap 下发、面板的 `scope` 状态与
双 Tab 切换 UI、launcher-rail 的按目录搜索。

★ 处理既有测试的原则:**验证「已被移除的行为」的用例应随之删除,而不是改造成通过**。
`session-list-routes.test.ts` 里「默认 scope=cwd」「由 sessionId 解析目标目录」「门控 403」
等 5 例直接删掉并在注释里写明来由;分页用例只改数据集断言(5 → 7,分页逻辑本身没变)。

★ 一处只有 tsc 抓得到的残留:server 与 react 两个包的**测试文件**仍在传旧字段,而 vitest
不做类型检查 —— 两包测试全绿、tsc 却是红的。这类缺口只能靠逐包跑 tsc 发现。

### 一次被我误判的"存量红"(记录以免重蹈)

`test/commands/publish-preview.test.ts` 的 3 个失败,我先按 stash 取基线判定为"与本 spec 无关的
存量红"——基线确实同样红,这步没错。但**真因不是存量缺陷,而是缺 `dist` 构建产物**:
跑完 `pnpm build:dist`(为浏览器 e2e 准备)之后,这 3 个用例自行转绿,根应用最终 1031 全过。

教训:"基线同样红"只能证明"不是本次改动引入",**不能**推出"是存量缺陷"——
还有第三种可能:**测试的运行前置条件没满足**。判定为存量前应先问一句「它依赖什么产物」。
