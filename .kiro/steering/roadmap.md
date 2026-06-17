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
     包布局:packages/{protocol,agent-kit,react,ui,server} + 根 Next.js app(app/、lib/app/、e2e/)。@pi-web/server 含 rpc-channel/agent-source/runner/session/http/extensions 六模块。 -->
<!-- [x] 同时代表「实现 + 验证」完成,而非仅 spec 生成。 -->
- [x] **protocol-contract** — `@pi-web/protocol`:RPC 命令/响应/事件/扩展UI 类型(派生自 pi d.ts)、SSE 帧、UIMessage data-part、REST DTO、SpawnSpec、zod 校验、protocolVersion。_Depends on: none_
- [x] **rpc-channel** — 传输无关 `PiRpcChannel` 接口 + `PiRpcProcess`(local:child_process spawn + 严格 JSONL framing + response/event/extension_ui_request 三类消息)。_Depends on: protocol-contract_
- [x] **agent-source-resolver** — agent 源解析(目录|git)+ 入口探测 + 双模式判定(custom/cli)+ 信任策略 → 生成 spawnSpec。_Depends on: protocol-contract_
- [x] **agent-runner** — bootstrap runner(jiti 载入 `index.ts` → 归一化 AgentDefinition → `createAgentSessionRuntime` → `runRpcMode`)+ `@pi-web/agent-kit` 的 `defineAgent()` 类型。_Depends on: protocol-contract_
- [x] **session-engine** — `PiSession`(事件广播 + 生命周期 + 扩展UI 挂起表)+ `SessionStore`/Registry(内存实现,接口外置)+ 事件→UIMessage 翻译层。_Depends on: rpc-channel, agent-source-resolver_
- [x] **http-api** — REST + SSE Route Handlers + 框架无关 `createPiWebHandler`(Web Fetch `(Request)=>Response`)+ 路由注入接缝。_Depends on: session-engine, protocol-contract_
- [x] **react-client** — `@pi-web/react`:`PiTransport`(AI SDK v5 `ChatTransport`)+ `usePiSession`/`usePiControls`/`useExtensionUI` + `createPiClient`。_Depends on: protocol-contract, http-api_
- [x] **extension-management** — 扩展安装/列出/卸载 API(`pi install` shell out + 来源白名单 + `--ignore-scripts`)+ 信任策略落地 + 消费 `get_commands` 命令面板。_Depends on: http-api, session-engine_
- [x] **ui-components** — `@pi-web/ui`:AI Elements 装配(`<PiChat>`/Tool/Reasoning/PromptInput)+ 渲染器注册表 + 模型/思考/stats 控制面板 + 权限弹窗 + shadcn registry。_Depends on: react-client_
- [x] **app-shell** — Next.js 整站闭环:layout/page + 装配 api routes + `<PiChat>` + agent 源选择;**承载全链路 e2e**(选源→prompt→浏览器内流式回复)。_Depends on: ui-components, http-api_

## Future / Out of MVP scope(不进入本批次,仅作排序与一致性意识)

- `embed-integrations` — `@pi-web/embed`:Web Component `<pi-web-chat>` + iframe widget(非 React 集成)。
- `host-provider-remote` — `agentHostProvider` 的 `docker`/`e2b`/`ssh`/`device` 远程实现(§14.1①)。
- `session-router-distributed` — 外置 `SessionStore`(Redis/DO)+ 控制面/数据面分离 + edge 网关(§14.1②③)。
- `pi-cloud-orchestration` — `AgentCatalog` 多 agent 管理 + fleet + 计费/纳管(§14.2)。
- 生产硬化(§11):沙箱选型落地、优雅停机、资源限额、可观测/计费、镜像与反代——分散并入相关 spec 的非功能任务,远程部分留作未来。
