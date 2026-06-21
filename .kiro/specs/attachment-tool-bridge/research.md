# Research & Design Decisions — attachment-tool-bridge

## Summary
- **Feature**: `attachment-tool-bridge`
- **Discovery Scope**: Extension(在既有 `agent-runner` / `agent-kit` / `attachment-store` 上扩展;跨进程边界 + pi 协议接缝)。
- **Key Findings**:
  - pi 协议无文件引用原语,且 tool `execute` 在 **runner 子进程**运行;唯一传文件通道是把 `attachmentId` 当 tool JSON 参数,store 必须子进程侧可达。
  - `AgentLoopConfig` 提供 `beforeToolCall`(可 `block`)/`afterToolCall`(可整段替换 `content`/`details`)两 hook,正好承载属主校验与 base64 剥离两个集中闸门。
  - `attachment-store` 已铸造 `BlobStore` / `Attachment` / `att_<nanoid>` / `AttachmentOrigin`(含预留 `tool-output`)/ `PI_WEB_ATTACHMENT_DIR` 目录约定 / `/raw` 分发与 HMAC 签名;本切片严格复用,不重定义。

## Research Log

### pi 协议契约(核对 d.ts)
- **Context**: 设计必须落在 pi `AgentTool` 协议约束内,否则 tool result 无法回模型。
- **Sources Consulted**:
  - `node_modules/.pnpm/@earendil-works+pi-ai@0.79.6_*/node_modules/@earendil-works/pi-ai/dist/types.d.ts`
  - `node_modules/.pnpm/@earendil-works+pi-agent-core@0.79.6_*/node_modules/@earendil-works/pi-agent-core/dist/types.d.ts`
  - `node_modules/.pnpm/@earendil-works+pi-coding-agent@0.79.6_*/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
- **Findings**:
  - `TextContent { type:"text"; text:string }`;`ImageContent { type:"image"; data:string; mimeType:string }` —— `data` 是 **string**,无 Promise 变体,无 url/path/fileId 变体。
  - `Tool { name; description:string; parameters:TSchema }` —— `description` 必填。
  - `AgentTool extends Tool { label:string; execute(toolCallId,params,signal?,onUpdate?):Promise<AgentToolResult>; prepareArguments?; executionMode? }`。
  - `AgentToolResult<T> { content:(TextContent|ImageContent)[]; details:T; terminate? }` —— `content` 仅 text|image;`details` 必填(类型上恒在)。
  - `ToolDefinition`(pi-coding-agent,`defineTool` 的入参)额外有 `label`、`promptSnippet?`、`promptGuidelines?`、`renderCall?`、`renderResult?`,且 `execute(...ctx: ExtensionContext)` 末位带扩展上下文。
  - `AgentLoopConfig.beforeToolCall?(ctx:BeforeToolCallContext, signal?) => Promise<{block?:boolean; reason?:string} | undefined>`;返回 `{block:true}` 阻止执行,loop 改发 error tool result。
  - `AgentLoopConfig.afterToolCall?(ctx:AfterToolCallContext, signal?) => Promise<{content?; details?; isError?; terminate?} | undefined>`;返回字段**整段替换**(无深合并),省略字段保留原值。`AfterToolCallContext` 含 `toolCall`、`args`、`result`、`context:AgentContext`。
- **Implications**:
  - tool 回图必须 `await` 出 string 再塞 `ImageContent.data`(Req 4.3 / 9)。
  - 属主校验放 `beforeToolCall`(读 `args` 取 `attachmentId`,不满足 → `{block:true}`)(Req 5)。
  - base64 剥离放 `afterToolCall`(整段替换 `content`,把 image 换成 text 引用)(Req 6)。

### runner 子进程装配与 spawn env
- **Context**: store 须在子进程实例化,且经 spawn env 拿后端配置。
- **Sources Consulted**:
  - `packages/server/src/runner/runner.ts`(`startRunner` → `loadAgentDefinition` → `createAgentSessionRuntime` → `runRpcMode`;读 `process.env`,有 `AgentContext{cwd,agentDir,env}`)。
  - `packages/server/src/runner/option-mapper.ts`(`mapSessionFields`:`def.customTools` 透传;`buildRuntimeFactory`:`fromServices.customTools = session.customTools`;已有 `process.env["PI_WEB_SANDBOX_ENTRY"]` 读取先例)。
  - `packages/server/src/runner/agent-loader.ts`(jiti 载入 + `@pi-web/agent-kit` 别名指向 workspace `packages/agent-kit/src/index.ts`)。
  - `packages/server/src/agent-source/assemble-spawn.ts`(`buildEnv(opts,fragment)`:`baseEnv + env + fragment.extraEnv`,`PI_CODING_AGENT_DIR` 末写防覆盖)。
  - `lib/app/pi-handler.ts`(`makeRealResolver` 传 `baseEnv=process.env`;`createChannel` 在 `spawnSpec.env` 追加 `config.providerKeys` 与 `PI_WEB_SANDBOX_ENTRY`)。
- **Findings**:
  - runner 已有"读 `process.env` 取配置"先例(`PI_WEB_SANDBOX_ENTRY`、`PI_WEB_TRUST_PROJECT`)。
  - `attachment-store` 的设计已承诺在 `createChannel` spawn env 透传 `PI_WEB_ATTACHMENT_DIR`(仅下发,不在子进程实例化);本切片正是消费该 env 在子进程实例化 store。
  - `customTools` 已有完整注入链路(`def.customTools` → `option-mapper` → `fromServices.customTools`),tool 拿 store 只需在 tool 工厂构造时闭包注入,无需改 option-mapper 契约。
- **Implications**:
  - 子进程侧从 `process.env` 读 `PI_WEB_ATTACHMENT_DIR`(+ 签名 secret env)构造一个**只读+落库**的子进程 store 客户端(复用 attachment-store 的 `LocalFsBlobBackend` + 配置工厂)。env 缺失 → store=undefined,tool 报"附件能力不可用"(Req 3.4)。
  - hook(before/after)在 runner 装配 `AgentLoopConfig` 处接线,不污染 tool 作者代码。

### prompt 文本引用注入接缝
- **Context**: 需把 `[attachment id=… type=… name=…]` 注入用户消息文本。
- **Findings**: 用户消息/prompt 经 RPC 从主进程发往 runner 子进程的 session runtime;附件描述符(id/type/name)在主进程侧已知(上传时落库)。注入点选在**主进程→pi 的消息构造侧**(session-engine prompt 构造),与 `toImageContents()` 同层,vision base64 维持现状(`attachment-store` 现状),引用注入只追加文本不内联字节(Req 8.4 / 9)。
- **Implications**: 引用注入是纯派生的文本拼接,放主进程侧;子进程侧 tool 只读取模型抄进参数的 id。

### attachment-store 实现现状
- **Context**: 确认本切片可复用哪些已成品。
- **Findings**: `attachment-store` 当前为 **spec-only**(`packages/server/src/attachment/` 尚未落地)。但其 design 已冻结契约:`BlobStore`/`LocalFsBlobBackend`/`AttachmentRegistry`/`UrlSigner`/`AttachmentStore` 门面 + `attachmentStoreConfigFromEnv()` + DTO(`Attachment`/`AttachmentOrigin`,后者含 `tool-output`)。
- **Implications**: 本切片**依赖**这些契约,任务编排假设 `attachment-store` 先行落地(roadmap dependency:`attachment-tool-bridge` _Depends on: attachment-store, agent-runner_)。本切片新增的是 L2 `resolve`/`AttachmentHandle`、子进程配置工厂、tool 接入、hook、引用注入;不重复实现 L0/L1。

### 测试与 e2e 约定
- **Findings**: vitest(`packages/server/test/**`,`packages/react`);Playwright e2e 在 `e2e/`,`playwright.config.ts` 支持 `NEXT_DIST_DIR=.next-e2e` 隔离 build + external server + stub(`PI_WEB_STUB_AGENT`)。
- **Implications**: e2e 需真实跑一个示例 tool;stub agent 模式下需提供一个能解析/落库的示例 tool 入口,或以隔离 dev + 真实示例 agent 跑端到端。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| L2 投影 + hook 闸门(选中) | `AttachmentHandle` 派生 resolve;before/after hook 集中校验与剥离;子进程 store 客户端 | 守不变式、tool 作者零省 context 负担、契约面小 | 跨进程配置下发需谨慎(env 缺失降级) | 与 `attachment-store` Ports&Adapters 同构 |
| 主进程代理 resolve(否决) | 子进程经 RPC 回调主进程 resolve | 单点 store 实例 | 违背"不回调主进程"、增 RPC 往返、流式字节难传 | brief 明确否决 |
| 每 tool 自实现省 context(否决) | 各 tool 自己剥 base64 | 无集中层 | 重复、易漏、不可审计、违背"集中闸门" | brief 明确否决 |

## Design Decisions

### Decision: 子进程独立实例化 store 客户端(不回调主进程)
- **Context**: tool `execute` 在 runner 子进程;store 须子进程可达。
- **Alternatives Considered**: 1) 子进程 RPC 回调主进程 resolve;2) 子进程按 env 自建 store 客户端。
- **Selected Approach**: 子进程从 `process.env`(`PI_WEB_ATTACHMENT_DIR` + secret)经一个**子进程配置工厂**构造 store 客户端,复用 attachment-store 的 `LocalFsBlobBackend`/`AttachmentRegistry`/`UrlSigner`,指向与主进程同一目录。
- **Rationale**: 本地后端=共享目录,两进程读写同一落盘即天然一致;避免 RPC 往返与大字节跨进程。
- **Trade-offs**: 两进程各持一份 store 实例(描述符以落盘 JSON 为单一真相,无内存态分裂);env 缺失需降级。
- **Follow-up**: 验证两进程对同一目录的读写一致性(集成测试);env 缺失降级路径(Req 3.4)。

### Decision: 两个 pi hook 承载两个不变式闸门
- **Context**: 属主校验(防越权)与 base64 剥离(省 context)需集中、不靠 tool 自觉。
- **Selected Approach**: `beforeToolCall` 读 `args.attachmentId` 做属主校验失败 `{block:true}`;`afterToolCall` 整段替换 `content`,把 image 换成文本引用(除非 `details` 标记需复看)。
- **Rationale**: hook 是 pi 原生接缝,集中、对 tool 透明、可审计。
- **Trade-offs**: `afterToolCall` 整段替换无深合并,需谨慎保留非 base64 的 text 部分。
- **Follow-up**: "需复看"标记走 `details` 字段约定(本切片定义一个明确标记键)。

### Decision: L2 `AttachmentHandle` 暴露四形态,base64 不入句柄
- **Context**: tool 需 path/url/bytes;base64 须仅具名出口。
- **Selected Approach**: `resolve(id) → AttachmentHandle{meta, bytes(), stream(), localPath(), url()}`;不提供 `base64()` 形态。tool 若要回图,自行从 bytes 编码 + await。
- **Rationale**: 守 Req 9.2(句柄不以 base64 为默认/必经表示)。
- **Trade-offs**: tool 回图多一步编码,但换来不变式可审计。

### Decision: 引用注入放主进程消息构造侧
- **Context**: 注入 `[attachment id=…]` 文本。
- **Selected Approach**: 在主进程 prompt 构造(与 `toImageContents()` 同层)追加文本引用;不内联字节。
- **Rationale**: 描述符在主进程已知;子进程只消费模型抄进参数的 id;避免在子进程重建附件清单。

## Risks & Mitigations
- **env 缺失致子进程 store 不可用** → tool 显式报"附件能力不可用",不崩溃(Req 3.4);集成测试覆盖。
- **S3 懒下载临时文件堆积** → 调用结束 + 会话结束两级回收(Req 2);本切片 LocalFs 无临时文件,接口预留 S3。
- **`afterToolCall` 整段替换误删 text** → 剥离时保留原 content 中的 text 部分,仅替换 image 部分为引用文本。
- **base64 经引用注入路径泄漏** → 注入只拼文本,断言不含 `data:`/base64(Req 8.4 / 9 测试)。
- **跨进程描述符不一致** → 描述符以落盘 JSON 为单一真相,子进程落库后主进程按 id 可读同一文件。

## References
- pi 协议 d.ts:`@earendil-works/pi-ai`、`pi-agent-core`、`pi-coding-agent`(0.79.6,见 Research Log 路径)。
- 上游 spec:`.kiro/specs/attachment-store/design.md`、`requirements.md`(BlobStore/Attachment/att_id/PI_WEB_ATTACHMENT_DIR/HMAC/`/raw`)。
- 既有实现:`packages/server/src/runner/{runner,option-mapper,agent-loader}.ts`、`packages/server/src/agent-source/assemble-spawn.ts`、`lib/app/pi-handler.ts`、`packages/agent-kit/src/index.ts`。
- roadmap:`.kiro/steering/roadmap.md`「附件系统」波次。
