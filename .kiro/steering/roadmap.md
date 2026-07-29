# Roadmap — pi-web

> 权威需求与设计:根目录 `PLAN.md`。本路线图把 PLAN.md 按 **内核 → 外围** 拆成多个 spec,
> 按依赖波次并行生成。**每个 spec 必须包含单元/集成测试 + e2e 验证**,并以新鲜运行证据证明通过。
> 语言:所有 spec 的 `spec.json.language` 设为 `zh`,spec 文档用中文撰写。

## 决策依据(依赖单向收敛)

`protocol-contract` 是所有层的契约根;后端引擎(channel/source/runner/session)在其上;
HTTP 层在引擎上;前端(react/ui)与后端经协议解耦;整站与扩展管理在最外围。
传输/隔离/会话存储均按**接口**实现(`PiRpcChannel` / `agentHostProvider` / `SessionStore`),为 §14 的 e2b/edge/device 预留接缝。

## Specs (dependency order)

<!-- 状态:[x] = spec 已生成 + 已实现 + 测试/e2e 通过。
     实现完成快照:typecheck EXIT 0(5 包 + Next app);测试 protocol 74 / rpc+source+runner+session+http+extensions(server)289(1 skip=LLM-key 门控)/ react 55 / ui 48 / agent-kit 3 / app 集成 6 / 离线 Node e2e 4 / 浏览器 Playwright e2e 2(真实 Chromium:流式文本+工具卡+思考块+权限弹窗+CLI 回退)。
     包布局:packages/{protocol,agent-kit,react,ui,server} + 根 Next.js app(app/、lib/app/、e2e/)。@blksails/pi-web-server 含 rpc-channel/agent-source/runner/session/http/extensions 六模块。 -->
<!-- [x] 同时代表「实现 + 验证」完成,而非仅 spec 生成。 -->
- [x] **protocol-contract** — `@blksails/pi-web-protocol`:RPC 命令/响应/事件/扩展UI 类型(派生自 pi d.ts)、SSE 帧、UIMessage data-part、REST DTO、SpawnSpec、zod 校验、protocolVersion。_Depends on: none_
- [x] **rpc-channel** — 传输无关 `PiRpcChannel` 接口 + `PiRpcProcess`(local:child_process spawn + 严格 JSONL framing + response/event/extension_ui_request 三类消息)。_Depends on: protocol-contract_
- [x] **agent-source-resolver** — agent 源解析(目录|git)+ 入口探测 + 双模式判定(custom/cli)+ 信任策略 → 生成 spawnSpec。_Depends on: protocol-contract_
- [x] **agent-runner** — bootstrap runner(jiti 载入 `index.ts` → 归一化 AgentDefinition → `createAgentSessionRuntime` → `runRpcMode`)+ `@blksails/pi-web-agent-kit` 的 `defineAgent()` 类型。_Depends on: protocol-contract_
- [x] **session-engine** — `PiSession`(事件广播 + 生命周期 + 扩展UI 挂起表)+ `SessionStore`/Registry(内存实现,接口外置)+ 事件→UIMessage 翻译层。_Depends on: rpc-channel, agent-source-resolver_
- [x] **http-api** — REST + SSE Route Handlers + 框架无关 `createPiWebHandler`(Web Fetch `(Request)=>Response`)+ 路由注入接缝。_Depends on: session-engine, protocol-contract_
- [x] **react-client** — `@blksails/pi-web-react`:`PiTransport`(AI SDK v5 `ChatTransport`)+ `usePiSession`/`usePiControls`/`useExtensionUI` + `createPiClient`。_Depends on: protocol-contract, http-api_
- [x] **extension-management** — 扩展安装/列出/卸载 API(`pi install` shell out + 来源白名单 + `--ignore-scripts`)+ 信任策略落地 + 消费 `get_commands` 命令面板。_Depends on: http-api, session-engine_
- [x] **ui-components** — `@blksails/pi-web-ui`:AI Elements 装配(`<PiChat>`/Tool/Reasoning/PromptInput)+ 渲染器注册表 + 模型/思考/stats 控制面板 + 权限弹窗 + shadcn registry。_Depends on: react-client_
- [x] **app-shell** — Next.js 整站闭环:layout/page + 装配 api routes + `<PiChat>` + agent 源选择;**承载全链路 e2e**(选源→prompt→浏览器内流式回复)。_Depends on: ui-components, http-api_

## 附件系统(新增波次 · 2026-06-21 discovery)

> 背景:支持两类附件场景 —— ① base64 给 LLM 识别(现状已有,仅图片);② 保存为文件给 server 端 tool 用(图像编辑/生成),且产出物回流。
> 核心设计:分层(L0 Blob Store/VFS · L1 引用 `att_id` · L2 投影 resolve · L3 context 闸门)+ pipeline 两回环(轮内工具回环、跨轮产出物回环)+ 三不变式(单一身份 / 先落库后引用 / base64 仅具名出口物化)。
> 关键约束:pi `AgentTool.content` 仅 `text|image`(base64),**无文件引用原语**;tool `execute` 在 **runner 子进程**(非 pi-web 主进程,且 pi 不走 MCP),故 store 须**双进程实例化、指向同一后端**(本地=共享目录经 spawn env 下发;S3=子进程持凭证)。

### 决策(2026-06-21)
- 分解:两个垂直切片 spec(下方 dependency order)。
- 第一版**不做智能意图路由**:上传图维持 base64→LLM(vision);给 tool 的文件走**显式 `attachmentId` 参数**。智能省 context 留待 future。
- 存储后端**先本地 LocalFs**,接口按 **S3 风格**预留;S3 实现留 future。
- 公开 id = `att_<nanoid>`(URL-safe、不可枚举);存储 key 可后置内容哈希去重(第一版可不做)。

### Specs (dependency order)
- [x] **attachment-store** — L0 对象存储(可插拔后端 + LocalFs)+ L1 描述符&id 生成 + 上传 `POST /attachments`(multipart)+ 分发 `GET /attachments/:id/raw`(签名防越权)+ 前端 `useAttachments` 改"上传拿 id、URL 展示",历史回显由 base64 改 URL 引用。_Depends on: http-api, react-client, ui-components, session-engine_ — 21 任务实现 + 浏览器 e2e 通过(2026-06-22)。
- [x] **attachment-tool-bridge** — L2 `resolve` 句柄(path/url/bytes,S3 localPath 懒下载)+ runner 子进程 store 实例化 + `AgentTool` 接入(description 必填、base64 先 await)+ `beforeToolCall` 属主校验 + `afterToolCall` base64 剥离 + 文本引用注入 + tool-output 落库回流(同一 id 空间,闭合跨轮回环)。_Depends on: attachment-store, agent-runner_ — 14 任务实现 + 浏览器 e2e 通过(2026-06-22)。

## AAS 权威表面 + AIGC Canvas 波次(2026-07-02 discovery · Path E)

> 背景:为 AIGC 场景做 Canvas(图片素材画廊 + 二次创作),讨论中提炼出通用范式
> **Agent 权威表面(AAS)**——富交互 UI surface = agent 某 domain 的瘦投影 + 命令发起端。
> 权威设计:`docs/agent-authoritative-surface-design.md`。

### 方案决策(2026-07-02)
- **Chosen**:路线 A(**零 REST route**)。复用现有 `control:"state"` 桥(下行快照)+ Tier3 `ui-rpc`(上行命令),不新增 protocol 结构、不加宿主服务端端点。
- **Why**:pi 约束(agent→server 仅 event/response/extension_ui_request 三类下行、工具不能 pull、无 `ctx.state`)逼出 CQRS;宿主中立(哑管道、不认领域语义)才能保住 agent source 独立性。
- **Rejected**:① 宿主 REST 端点直连 `runImageTool`(认领 provider/model/key,破坏独立性);② gallery 走完整 AAS 快照+hydrate 被质疑对"持久资源视图"过度——但因坚持零 REST,仍以 SSE 粘性回放实现,而非 REST 拉;③ `pi.appendEntry` 当持久层(0.80.3 为 `private`,扩展无公开持久 API)。

### Boundary Strategy
- **Why this split**:粘性修复是 state 桥既有缺口(通用、零依赖);AAS SDK 是领域无关的通信基础设施;Canvas 是首个 domain 落地。三者依赖单向收敛,可独立交付与 review。
- **Shared seams to watch**:`control:"state"` 通用粘性(宿主 `PiSession.handleRawLine`,领域无关)/ ui-rpc 命令"无 `name` 逃逸 host 拦截"落到 agent 转发路径 / gallery = attachment store 派生视图(血缘存 `.att.json`)/ 图字节走 Bulk(`att_` 签名 URL,永不进帧)/ **attachment 会话枚举 + 不透明 meta seam(领域无关,归上游 `attachment-tool-bridge`,勿被 Canvas 吸收)**。

### Existing Spec Updates
- [ ] **state-injection-bridge** — 给 `control:"state"` 桥补**通用粘性帧**:`PiSession.handleRawLine` 的 `piweb_state` 分支 `sticky.set(\`state:${key}\`, frame)`(照抄 queue 的 pi-session.ts:532,`delete` 帧相应清理),修重连丢 KV。领域无关,惠及所有 state key。_Dependencies: none_
- [ ] **attachment-tool-bridge / attachment-store** — 补**领域无关**的两个 seam(对称于粘性修复,carve 自 Canvas,cross-spec review IMPORTANT-1):① `getAttachmentToolContext()` 暴露 `listBySession`(会话枚举,facade 已有 `listBySession`,仅需透出到子进程工具上下文,供 surface `hydrate` 重建);② 不透明扩展 meta `getMeta/setMeta`(存 `.att.json`,承载 `{derivedFrom,genParams}` 等,attachment 层存 opaque JSON、不解释领域语义)。_Dependencies: none_

### Specs (dependency order)
- [ ] **agent-authoritative-surface** — 通用 AAS SDK:agent 侧 `createSurface({domain,initialState,commands,hydrate})` + UI 侧 `useSurface(domain)→{state,run,available}` + `SurfaceCommandPayload/Result`(细化 ui-rpc payload,走 agent 转发)+ 能力探针 `surface:<domain>` + 退化契约;宿主零领域语义。_Dependencies: state-injection-bridge_
- [ ] **aigc-canvas** — AIGC Canvas:画廊(attachment 派生视图,9宫格/密度可切换/分页)+ 工作台(格子展开/关闭)+ 二次创作(A 档 image_edit 指令/inpaint mask/参考图/变体、B 档客户端裁剪拼贴、C 档血缘树/参数复用/对比)+ image_edit 集成(ui-rpc 转发调 runImageTool)+ 非 AIGC source 优雅退化;门控 `NEXT_PUBLIC_PI_WEB_CANVAS`。_Dependencies: agent-authoritative-surface_

## 内核提取波次(2026-07-29 discovery · Path D)

> 背景:`packages/server` 已膨胀到 ≈33k 行 / 35 个模块目录,把 headless 内核与外部接线
> (e2b/postgres/s3/网关/凭据/registry)、runner 子进程实现混装在一个包里。宿主契约 v1
> (`docs/pi-web-host-contract-v1.md`,P1–P5 端口)与 host-contract M1–M4 已落地,端口抽象
> 就位,但**物理包边界仍未切开** —— 契约有了,包还是一坨。本波次把它切成
> core(headless 内核)/ runner(子进程实现)/ adapters(外部接线)三包。
>
> 工作分支:`refactor/core-extraction`,worktree `.claude/worktrees/core-extraction`,基于 main `6b638622`。

### 方案决策(2026-07-29)

- **Chosen**:四层切分 —— `protocol ← core ← {runner, adapters} ← 宿主(lib/app · server/ · desktop · pi-clouds)`。
  `@blksails/pi-web-server` **保留为兼容 re-export 层**,包名与现有 exports 全部不变。
- **Why**:
  ① 三条外围边界实测比预期干净 —— `hono` 全仓只在 `server/index.ts` 一处(`packages/server/src/http`
     已是框架无关的 `Request/Response` handler);`registry-client` 只有 4 处真实 import,全在
     `server/cli`;UI 包对 `pi-web-server` 零依赖。切包的阻力主要在**包内**,不在包间。
  ② 保留兼容层使 `lib/app`(1161 行 pi-handler)、`examples/`(40 个)、`e2e/`、跨仓消费方
     **零改动**,把回归面压到 `packages/` 内部。
- **Rejected alternatives**:
  ① 直接拆解不留兼容层 —— diff 更干净,但要同时改 lib/app、server/cli、examples、e2e、desktop
     与跨仓引用,回归面成倍放大,且该包已发 npm(0.6.1)。
  ② 只切 core、adapters 暂留 server —— 回归面更小,但 `rpc-channel→sandbox-image` 这类越界边
     会以「core 反向依赖遗留 server」的形态留存,等于把问题推迟。
  ③ 命名用 `pi-web-kernel` —— 与仓内既有 `@blksails/pi-web-kit`(web-kit)两个名字易混。

### Scope

- **In**:`packages/server` 的包内切分(core / runner / adapters 三个新包 + server 兼容层);
  三条越界边原地解耦;测试面三档重建(fast / it / e2e)。
- **Out**:宿主装配层(`lib/app/pi-handler.ts`)重排;`server/cli` 的 pi-clouds 接线独立成包;
  desktop 与 UI 包的任何改动。以上均为后续波次候选,本波次**不动**。

### Constraints

- 内核判据可机械校验:`pi-web-core` 的 package.json **不得**出现 `hono` / `e2b` / `pg` /
  `@modelcontextprotocol/sdk` / `registry-client`;`@earendil-works/pi-*` 只能是 peer 且仅 `import type`。
- 基线(main `6b638622` 实测):server unit 档 267 文件 / 2420 用例,墙钟 ~86-116s。
  ★ 该基线**本身不稳定** —— 同一提交两次全量运行,一次 4 文件/5 用例红、一次全绿。
  故「不低于基线」须以**稳定绿**为准,不能拿单次绿当证据。
- 语言:`spec.json.language = zh`。

### Boundary Strategy

- **Why this split**:测试面先行,给后面三次大搬迁提供 <10s 的回归闸门(否则每轮等 85s);
  越界边先**原地**解耦再搬文件,使「解耦」与「移动」两类 diff 可分别复核 ——
  混在一起时,一个搬错位置的文件和一条被悄悄改掉的依赖在 diff 里长得一样。
- **Shared seams to watch**:`rpc-channel → sandbox-image`(不先断则 core 抽出即反向依赖 adapters)/
  `runner → auth`(egress 凭据须改注入)/ `config → http`(配置域与路由 co-locate)/
  `MemoryWorkspace`(现为 test fixture,须升为内核包正式 test double 导出,fast 档才有得依赖)/
  `pi-web-server` 兼容层的 exports 表面(6 个子路径导出,一个都不能丢)。

### Specs (dependency order)

- [x] **test-tiering-fast-lane** — 测试面切三档(fast:无子进程/无 pi SDK/无网络/无真实 fs,目标 <10s;
  it:spawn 子进程与真实 fs,独占串行;e2e:手动或 CI 触发)+ 把 25 个错档文件(挂 `.integration`/`.e2e`
  后缀却跑在 unit 档、真实 spawn 子进程)重命名归位 + 依赖守卫测试(fast 档 import 命中
  `node:child_process`/pi SDK/`e2b`/`pg`/`registry-client` 即红)+ 新增 `pnpm test:fast` 入口。
  _Dependencies: none_ — 14 任务完成(2026-07-29)。fast 档 **6.25s**(188+1 文件/1821 用例);
  连续两次全量计数一致(基线做不到);与基线对账零缺口。★ 实测推翻两条设计假设:
  vitest project 级 `isolate` 被忽略(同 `fileParallelism`)、`-c` 配置的 `setupFiles` 被忽略。
- [x] **kernel-boundary-decoupling** — **原地**解三条越界边:`rpc-channel → sandbox-image`(传输抽象
  剥离 e2b 烘焙计划)、`runner → auth`(egress 模型源改注入)、`config → http`(配置域与路由分离);
  并把 `MemoryWorkspace` 从 test fixture 提升为 `src/testing` 正式导出。**不移动任何文件到新包**。
  _Dependencies: test-tiering-fast-lane_ — 12 任务完成(2026-07-29)。依赖方向守卫由红转绿(39/39);
  主入口符号 313→313 diff 空;全量连跑两次一致(283 文件/2547 用例)。
  ★ 守卫揪出 design 未预见的两件事:① `host-assembly` 与 `index` 是**装配层**不是 core,
  **不应进 core 包**(core-package-extraction 的 brief 需据此修订);② `model-catalog → ai-gateway`
  是第四条边,已登记为 KNOWN_DEBT 移交 core-package-extraction。
- [ ] **core-package-extraction** — 建 `@blksails/pi-web-core`(headless 内核:session / rpc-channel 抽象 /
  框架无关 http handler / workspace / capability / config-domain / host-manifest / host-contract-version /
  session-store 接口 / attachment L0–L1 接口 / completion / commands / runner **契约**),
  `@blksails/pi-web-server` 降为兼容 re-export 层(包名与 6 个子路径导出全部保留)。
  _Dependencies: kernel-boundary-decoupling_
- [ ] **runner-package-extraction** — 建 `@blksails/pi-web-runner`:runner 子进程实现 + jiti 载入,
  pi SDK 列为 peer;core 只保留契约类型。_Dependencies: core-package-extraction_
- [ ] **adapters-package-extraction** — 建 `@blksails/pi-web-adapters`:e2b transport / postgres store /
  s3 blob backend / ai-gateway / llm-gateway / auth / identity / sandbox-image / registry-install
  (≈5k 行)。_Dependencies: core-package-extraction_(与 runner-package-extraction 可并行)

## Future / Out of MVP scope(不进入本批次,仅作排序与一致性意识)

- `embed-integrations` — `@pi-web/embed`:Web Component `<pi-web-chat>` + iframe widget(非 React 集成)。
- `host-provider-remote` — `agentHostProvider` 的 `docker`/`e2b`/`ssh`/`device` 远程实现(§14.1①)。
- `session-router-distributed` — 外置 `SessionStore`(Redis/DO)+ 控制面/数据面分离 + edge 网关(§14.1②③)。
- `pi-cloud-orchestration` — `AgentCatalog` 多 agent 管理 + fleet + 计费/纳管(§14.2)。
- 生产硬化(§11):沙箱选型落地、优雅停机、资源限额、可观测/计费、镜像与反代——分散并入相关 spec 的非功能任务,远程部分留作未来。
