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
- [x] **core-package-extraction** — 建 `@blksails/pi-web-core`(headless 内核:session / rpc-channel 抽象 /
  框架无关 http handler / workspace / capability / config-domain / host-manifest / host-contract-version /
  session-store 接口 / attachment L0–L1 接口 / completion / commands / runner **契约**),
  `@blksails/pi-web-server` 降为兼容 re-export 层(包名与 6 个子路径导出全部保留)。
  _Dependencies: kernel-boundary-decoupling_
  ✅ 2026-07-29 完成(13/13):core 185 src / 173 test,server 90 src / 110 test;
  主入口 313 符号逐字未变;两包全量连跑两次一致 285 文件 / 2563 用例;四守卫全绿且判别力自证。
  ★ **实施中发现 R1.2 与「adapters 归后续 spec」不可兼得**:6 个文件把 e2b / pg / MCP SDK
  拖进 core,而 core 走**源码直连**分发使「声明成 optional peer」不可用(消费方 tsc 会编译到
  那些文件)。经用户定夺**提前摘出**,建了 5 个 adapters 模块(sandbox-transport /
  session-store-postgres / mcp-probe / model-sources / attachment-example-tool)——
  这部分工作已从 adapters-package-extraction 前移,该 spec 的剩余面相应缩小。
  core 依赖树终态:logger / protocol / zod / tool-kit + agent SDK(optional peer,仅类型引用)。
- [x] **runner-package-extraction** — 建 `@blksails/pi-web-runner`:runner 子进程实现 + jiti 载入,
  pi SDK 列为 peer;core 只保留契约类型。_Dependencies: core-package-extraction_
- [ ] **adapters-package-extraction** — 建 `@blksails/pi-web-adapters`:e2b transport / postgres store /
  s3 blob backend / ai-gateway / llm-gateway / auth / identity / sandbox-image / registry-install
  (≈5k 行)。_Dependencies: core-package-extraction_(与 runner-package-extraction 可并行)
  ⚠ 范围已缩小:core-package-extraction 因 R1.2 提前摘出了 5 个 adapters 模块
  (sandbox-transport / session-store-postgres / mcp-probe / model-sources / attachment-example-tool),
  它们**已在兼容层包内独立成模块**,本 spec 只需把它们连同其余 adapters 搬进新包。

## 宿主内置 panes + 形态化登录 + 会话活跃态波次(2026-07-28 discovery · 2026-07-30 按内核提取后代码基复核 · Path E)

> 背景:五项用户诉求 ——(1) 本地 web 形态彻底旁路登录(仅 pi-clouds 与桌面版强制登录);
> (2) auto-title 对所有 agent 默认生效;(3) session-list 显示会话生成中/工具调用中的转圈状态;
> (4) panes 提层为宿主能力,任何 agent 零改动即可见;(5) 新增 file_explorer / browser /
> code editor 三个内置 pane,并把现有 logging 面板转换为内置 pane。
> 上游地基:`isolated-panes`(Wave 0–4 已完成,含 `panes-kit` 契约、`PanesHost`、Guest SDK、
> agent-route adapter、`PaneAgentModule` 载体、桌面 relay/Tauri adapter)。
>
> ⚠ **2026-07-30 复核**:内核提取波次已合入 main,`packages/server` 拆为
> `packages/{core,runner,adapters}`。本波次一切路径引用以复核后为准:
> identity → `packages/adapters/src/identity/`、session-list → `packages/core/src/session-list/`、
> BUILTIN_EXTENSIONS → `packages/runner/src/runner/builtin-extensions.ts`。

### 方案决策(2026-07-28 定,2026-07-30 复核修订)

- **登录门控**:引入**显式部署形态**(`local-web` / `desktop` / `cloud`)。今天 `IdentityGate`
  (`components/chat-app.tsx:378`)只有「云端探测失败/未配置就放行」这种**隐式**逻辑,本地 web
  一旦配了云端 env 就被门住。改为形态权威判定:本地 web 形态下 gate 直接旁路且 identity/auth
  路由不挂载。**复核补充**:`packages/adapters/src/auth/desktop-marker.ts` 的 `DESKTOP_MARKER_ENV`
  已是「只有壳知道自己是壳」的单一事实源 —— 形态判定须**建在它之上**,不得另造第二个真相源。
  **Rejected**:仅去掉强制跳转(治症不治因,隐式判定仍会在别的 env 组合下复发);
  登录改「可选」(用户明确要求本地彻底不登录,保留入口即保留复发面)。
- **panes 提层**:**宿主内置 pane 集合 + agent 追加合并**。宿主默认给每个会话装载一组内置
  pane 定义,agent 若声明 `PaneAgentModule` 则在其之上追加。
  **Rejected**:在 runner 装配期给每个 agent 强注一份默认 panes 模块(把宿主能力伪装成 agent
  声明,内置 pane 的宿主侧能力无处安放);只让内置 agent 默认带(第三方/示例 agent 仍看不到)。
- **内置 pane 车道**:**统一走 iframe guest**,与第三方 pane 同构、同一 MessageChannel + 五种
  operation。**Rejected**:宿主原生 React 特权面板(实现快但与第三方 pane 双轨,隔离性弱,
  且会让「宿主能力面」这条安全边界不必要地消失)。
- **文件能力边界**:**限会话 cwd 子树,可读可写**。realpath 校验,拒符号链接逃逸。
  **Rejected**:只读(code editor 名不副实);全盘可读写(本地 web 形态下等于把宿主文件系统
  暴露给 pane)。
- **browser pane**:**桌面 Tauri 原生 webview + web 形态降级为同源预览器**。
  **Rejected**:宿主加转发代理剥 `frame-ancestors`(把宿主变成开放代理,引入 SSRF 面)。
- **auto-title**:不立 spec,走**直接实现**。**复核已定位真因**(见下方 Direct Implementation)。

### 复核发现(2026-07-30,改变了三项原判断)

1. **auto-title 不是幻影缺口,真因已确定**:`assemble-spawn.ts` 的 **cli 模式**直接 spawn
   pi CLI `--mode rpc`,**不经 runner-bootstrap**,而三个内置扩展入口是由 runner 的
   `option-mapper.ts:85 collectExtensionPaths(process.env)` 装进 `forcedExtensionPaths` 的 ——
   故 cli 模式下 **auto-title / extension-tools / mcp 三者全部静默不生效**。
   `packages/core/src/builtin-agents/default-agent/index.ts:5` 的注释已供认此事
   (「退回 cli 模式…缺少 runner 期特性如自动标题」)。**可行解**:pi CLI 存在
   `--extension` / `--extensions` flag(已在 0.80.3 产物中确证),cli 分支可经 `extraArgs`
   注入同一批入口路径。波及面比「auto-title」这一项大。
2. **桌面 pane 原生 webview 车道已建成、但未接线**:`packages/panes-kit/src/host-ports.ts`
   (`PanePort`/`PaneViewAdapter`)、`adapters/{relay,tauri,tauri-bootstrap}.ts`、Rust
   `desktop/src-tauri/src/pane_relay.rs` 均已存在(isolated-panes 任务 5.x)。
   但 `createTauriPaneViewAdapter` **只在 `test/conformance/transport-conformance.test.ts`
   被使用**,生产装配未接入。且 `desktop/src-tauri/capabilities/panes.json` 明写
   pane webview「**不授予导航、shell、opener**」,adapter 另有 `allowedProtocols` 守卫。
   → browser pane 需要的正是导航能力,与既有 pane webview 的安全前提**直接冲突**,
   这是 `builtin-pane-browser` 的核心张力,不是「补个功能」。
3. **`isolated-panes` Wave 5(6.1/6.2/6.3 AIGC 迁移)仍未勾**,且有 in-flight 分支
   `feat/aigc-canvas-panes-migration` 正在做(该分支也是本波次 discovery 产物的原始落点)。
   → `host-builtin-panes` 改装载点会与之在同一批文件上相撞,须先对齐分支状态。
4. **诉求 1(本地不登录)已在工作区被止血大半 —— 未提交**:
   `lib/app/auth-egress-assembly.ts` 新增 `readDesktopScopedCloudEgressBase`,
   把 `<agentDir>/cloud.json` 的**隐式回落**限定到桌面壳(`DESKTOP_MARKER_ENV === "1"`),
   `pi-handler.ts:513` 已接线,`test/auth/cloud-config-fallback.test.ts` 5 例(含
   「判别力自证:同一份 cloud.json 在桌面壳下必须回落成功」)。
   真因写在代码注释里:`~/.pi/agent/` 被桌面壳与 `pnpm dev`/npm CLI **共用**,桌面版登录一次
   写下的 `cloud.json` 使此后每次 dev 都被拦成登录页。
   → **剩余问题只有两个**,`desktop-account-login` 的更新范围应据此收窄:
   ① 显式 `PI_WEB_CLOUD_LOGIN_EGRESS_BASE` 对**所有**宿主仍生效 —— 若本地 web 环境里留了这个
   变量,仍会被门住。这与用户诉求「本地 web 不要登录」有张力:该继续尊重显式表态,
   还是让 `local-web` 形态**无条件**旁路?须明确定夺。
   ② `cloud` 形态(pi-clouds)靠什么判定?今天只有二值 `DESKTOP_MARKER_ENV`,
   没有三形态的显式表示;`IdentityGate` 仍是「能登录就拦」的隐式逻辑,只是上游输入被收窄了。

### Boundary Strategy

- **Why this split**:① 提层机制(宿主装载 + 合并语义)与 ② 宿主能力面(文件/日志 route +
  授权)与 ③ 具体 pane UI 是三条独立收敛的责任线 —— 能力面是**安全边界**,值得独立 review,
  不能被 pane UI 的实现进度裹挟;browser pane 跨桌面壳、技术栈与取证方式(需打包态)与另外
  三个完全不同,混在一起会拖住可交付部分。
- **Shared seams to watch**:
  - **宿主 pane 定义与 agent 定义的合并与冲突语义**(ID 撞车、agent 是否可覆盖内置)——
    归 `host-builtin-panes`,勿被 `builtin-pane-suite` 各自实现。
  - **grant 只源于已装载定义**(`isolated-panes` Req 4.1/4.2 的默认拒绝)对内置 pane 同样
    成立 —— 内置身份**不产生**额外权限,能力仍须逐项 grant。
  - **会话 cwd 的权威来源**是 agent 会话装配态,不是 pane 自报 —— 归 `pane-host-capabilities`。
  - **部署形态判定**须单一权威函数,建在 `desktop-marker.ts` 之上,禁止调用方各写
    `if (isDesktop)`(`packages/adapters/src/identity/types.ts:16` 已立此纪律)——
    归 `desktop-account-login` 扩展。
  - **会话活跃态**(生成中/工具调用中)是 `PiSession` 生命周期的派生投影,列表项只消费 ——
    归 `sessions-list` 扩展,勿在前端靠 SSE 文本猜测。
  - **cli 模式 vs custom 模式的能力差**(复核发现 1)是**跨 spec 的横切事实**:任何「宿主对
    所有会话都成立」的承诺都要先问「cli 模式下成立吗」。
  - ★ **pane 时序问题必须以 browser e2e 为判据**(`isolated-panes` Wave 5 教训:panes-kit
    单测全绿而真实浏览器 4 套 e2e 全红)。
  - ★ **pane 四条通道回来的都是未校验数据**,`guest.query<T>()` 泛型是断言不是校验 ——
    内置 pane 必须在 guest 侧做运行期校验,否则 404 错误体被当结果解构即崩。

### Existing Spec Updates

- [ ] **desktop-account-login** — ⚠ **范围已被工作区改动收窄**(复核发现 4):隐式回落止血已完成
  (未提交)。剩余:① 定夺 `local-web` 形态下显式 `PI_WEB_CLOUD_LOGIN_EGRESS_BASE` 是否仍应门住;
  ② 是否引入显式三形态(`local-web`/`desktop`/`cloud`)取代二值 `DESKTOP_MARKER_ENV`,
  以及 `cloud` 形态如何判定;③ 若引入,本地 web 形态下 `IdentityGate` 旁路、identity/auth
  路由不挂载、前端不出现登录页。**先把工作区那笔改动提交并观察**,再定 ②③ 是否还必要 ——
  可能已无需完整三形态。_Dependencies: none_
- [ ] **sessions-list** — 会话活跃态显示:server 侧从 `PiSession` 聚合「生成中 / 工具调用中 /
  空闲」并经实时通道下推,列表 DTO 增活跃态字段(现
  `packages/core/src/session-list/session-list-routes.ts` **无任何**活跃态字段),
  `packages/ui/src/elements/session-list-panel.tsx` 的列表项在非空闲时显示转圈 loading。
  _Dependencies: none_

### Direct Implementation Candidates

- [ ] **cli 模式内置扩展缺失修补(原「auto-title 默认集成」)** — 真因已定位(复核发现 1):
  cli 模式绕过 runner,`forcedExtensionPaths` 从未装配,auto-title / extension-tools / mcp
  三者静默失效。方向:`assemble-spawn.ts` 的 cli 分支经 pi CLI `--extension` flag 注入同一批
  入口路径,并补「两模式内置扩展等价」的判据测试。★ 判据不能只看 custom 模式跑绿 ——
  必须有一个**在 cli 模式下会报红**的用例,否则等于没测(参见既有教训:先证明判据能报红)。

### Specs (dependency order)

- [ ] **host-builtin-panes** — panes 提层:宿主侧内置 pane 定义集合 + 装载点 + 与 agent
  `PaneAgentModule` 的追加合并与冲突语义;任何 agent(含无 web extension 的、含 cli 模式的)
  零改动即可见 panes;内置身份不产生额外权限。★ 须先与 `feat/aigc-canvas-panes-migration`
  分支对齐(复核发现 3)。_Dependencies: none_
- [ ] **pane-host-capabilities** — 内置 pane 的宿主能力面:会话 cwd 子树的文件树枚举 / 读文件 /
  写回 route + 授权(realpath 越界与符号链接逃逸拒绝、大小上限)+ 日志流能力;
  能力面与 pane UI 解耦,可独立安全 review。_Dependencies: host-builtin-panes_
- [ ] **builtin-pane-suite** — 三个内置 pane 的 guest 实现:`file_explorer`(文件树浏览)、
  `code_editor`(编辑 + 写回)、`logging`(由现有 logs 面板转换为 pane);guest 侧对四条通道
  返回值做运行期校验。_Dependencies: pane-host-capabilities_
- [ ] **builtin-pane-browser** — `browser` 内置 pane:桌面(Tauri)用原生 webview 开任意站点,
  纯 web 形态降级为同源/可控来源预览器;形态判定复用 `desktop-account-login` 扩展落地的
  单一权威。★ 核心张力 = 既有 pane webview 刻意**不授予导航**(复核发现 2),本 spec 必须
  正面处理「可导航 webview 是第二类 view,还是放宽既有 capability」这个安全抉择。
  _Dependencies: host-builtin-panes, desktop-account-login(形态判定)_

## Future / Out of MVP scope(不进入本批次,仅作排序与一致性意识)

- `embed-integrations` — `@pi-web/embed`:Web Component `<pi-web-chat>` + iframe widget(非 React 集成)。
- `host-provider-remote` — `agentHostProvider` 的 `docker`/`e2b`/`ssh`/`device` 远程实现(§14.1①)。
- `session-router-distributed` — 外置 `SessionStore`(Redis/DO)+ 控制面/数据面分离 + edge 网关(§14.1②③)。
- `pi-cloud-orchestration` — `AgentCatalog` 多 agent 管理 + fleet + 计费/纳管(§14.2)。
- 生产硬化(§11):沙箱选型落地、优雅停机、资源限额、可观测/计费、镜像与反代——分散并入相关 spec 的非功能任务,远程部分留作未来。
