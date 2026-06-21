# Brief: attachment-tool-bridge

> 附件系统两切片之二(场景 ②:文件给 server 端 tool 用 + 产出物回流 + context 闸门)。
> 依赖 `attachment-store`(L0 对象存储 + L1 描述符/id)。权威分层/pipeline/不变式见 `.kiro/steering/roadmap.md` 的「附件系统」波次。

## Problem
用户上传的文件(图)需要交给 **server 端 tool** 执行图像编辑/生成,且 tool **产出的新文件要回流**到对话与下一轮;同时 base64 一旦进 pi transcript 会被**逐轮复读**,撑爆 context。pi 协议层帮不上忙:
- `AgentTool.content` 仅 `text | image`(base64),`ImageContent` 只有 `data:string`(裸 base64),**没有** `url/path/fileId` 等文件引用变体 —— 协议无"文件引用"原语。
- 给 tool 传文件的唯一通道,是把 `attachmentId` 当 **tool 的 JSON 参数**(`ToolCall.arguments`),tool 在 `execute` 内**带外**解析。
- **tool `execute` 运行在 runner 子进程**(非 pi-web 主进程,pi 不走 MCP),所以 store 必须在子进程侧可达。

## Current State
- tool 装配:`packages/agent-kit`(`defineAgent`/`defineTool`,re-export 自 `@earendil-works/pi-coding-agent`)+ `packages/server/src/runner`(jiti 载入 index.ts → `createAgentSessionRuntime` → `runRpcMode`)。`customTools` 经 `option-mapper.ts` 注入,**在 runner 子进程内执行**。
- `attachment-store`(前置切片)已提供:对象存储 + `Attachment` 描述符 + `att_<nanoid>` id + 上传/分发端点 + URL 展示。
- pi `AgentLoopConfig` 提供 `beforeToolCall`(可 `block`)/ `afterToolCall`(可改写 `content`/`details`)hook。

## Desired Outcome
- tool 拿到 `attachmentId` 后能 `resolve` 成它需要的形态:**本地路径 / 网络 URL / 原始字节**(三类 tool 需求都覆盖)。
- tool 产出物经 `store.put({origin:"tool-output"})` **先落库**拿新 `att_` id,再以引用回流;该 id 与上传 id **同一空间**,可被下一轮用户消息再次引用(闭合跨轮回环 B)。
- **context 可控**:tool result 默认只回"引用 + 一句话",仅在需模型复看时才物化 base64;base64 只在两个具名出口出现。
- **第一版不做智能意图路由**:给 tool 的文件走显式 `attachmentId` 参数;上传图给 LLM 看维持 `attachment-store` 的现状 base64。

## Approach
补全 L2 投影 + tool 接入 + pi hook,把 store 接到 runner 子进程:
- **L2 `AttachmentHandle`**:`resolve(id)` 返回 `{ meta, bytes(), stream(), localPath(), url() }`。`localPath()` 跨后端语义:LocalFs 直返路径;S3 懒下载临时文件(临时文件需在 execute 结束/会话结束回收)。
- **runner 子进程 store 实例化**:经 spawn env/参数下发后端配置(本地=共享目录路径;S3=凭证),子进程内构造 store 客户端 —— **不回调主进程**。与主进程那份指向**同一后端**。
- **`AgentTool` 接入(协议兼容)**:`name`/`label`/`parameters`(typebox)/**`description` 必填**/`execute(toolCallId, params, signal, onUpdate)`;返回 `{ content, details }`(`details` 必填);若回图,`ImageContent.data` 必须**先 await 成 string**,不能塞 Promise。提供去背景/放大/生成等示例(path / url / bytes 三种 resolve 用法)。
- **`beforeToolCall` 属主校验**:校验该 session 是否拥有 `attachmentId`,否则 `block`,防越权 resolve。
- **`afterToolCall` base64 剥离闸门**:集中实现"除非标记需复看,否则把 tool result 里的 base64 剥成文本引用",tool 自身不各写省 context 逻辑。
- **文本引用注入**:build prompt 时把附件以 `[attachment id=att_… type=… name=…]` 注入用户消息文本,模型据此把 id 抄进 tool 参数。

## Scope
- **In**:
  - `AttachmentHandle` / `store.resolve(id)`(bytes/stream/localPath/url;S3 localPath 懒下载 + 临时文件回收)。
  - runner 子进程 store 实例化(spawn env/参数下发后端配置,指向同一后端)。
  - `AgentTool` 接入范式 + `agent-kit` 暴露 store 给 `defineTool.execute`;至少一个端到端示例 tool。
  - `beforeToolCall` 属主校验 + `afterToolCall` base64 剥离 hook(经 runner/AgentLoopConfig 接入)。
  - tool-output 落库回流(`origin:"tool-output"`,同一 id 空间,闭合回环 B)。
  - 文本引用注入到 prompt 构造;tool result 默认回引用、可选回 base64(await string)。
  - 单元/集成测试 + e2e(上传→tool resolve→执行→产出落库→引用回流→前端 URL 展示)。
- **Out**:
  - 智能意图路由(模型自决 / UI 显式标注)→ future。
  - 改造 vision 侧 base64→LLM(维持现状)。
  - S3 后端真实实现(`resolve` 接口按可切换设计,S3 实现 future)。
  - 对象存储本体 / 上传分发端点 / 前端摄入展示(属 `attachment-store`)。

## Boundary Candidates
- L2 投影/resolve(纯派生逻辑)vs runner 子进程注入(进程边界 + 配置下发)。
- pi hook 接入(before/after)vs tool 自身实现。
- 引用注入(prompt 构造侧)vs tool-output 回流(结果侧)。

## Out of Boundary
- 对象存储后端与 HTTP 端点(`attachment-store` 已交付)。
- 前端上传/展示(`attachment-store`);本切片只确保产出物可经既有 `/raw` URL 展示。
- pi transcript 内 base64 的事后清理(pi 子进程持有,不可逆;闸门只在 build prompt + tool result 出口前移防御)。

## Upstream / Downstream
- **Upstream**:`attachment-store`(store + id + 端点)、`agent-runner`(runner 子进程 + customTools 装配)、`session-engine`(属主/事件)、`rpc-channel`(子进程消息)。
- **Downstream**:具体图像编辑/生成 tool;future 智能意图路由(省 context 升级)。

## Existing Spec Touchpoints
- **Extends**:`agent-runner`(runner 注入 store + hook 接入)、`agent-kit`(`defineTool` 拿到 store)、`session-engine`(prompt 构造侧的引用注入)。
- **Adjacent**:`tool-call-ui-redesign`(tool 结果/产出物在 UI 的呈现)、`stream-error-surfacing`(tool 执行错误回传)。

## Constraints
- pi `AgentTool` 协议:`content` 仅 `text|image`,`ImageContent.data` 必须是已 await 的 string;`description`/`details` 必填。
- tool `execute` 在 runner 子进程 → store 须子进程可达(本地共享目录 / S3 凭证),**不走回调主进程**。
- base64 进 pi transcript **不可逆** → 闸门必须卡在 pi-web→pi 边界(build prompt)与 tool result 出口。
- S3 `localPath()` 临时文件需有回收策略,避免堆积。
- 守三不变式(单一身份 / 先落库后引用 / base64 仅具名出口);测试需新鲜运行证据;中文文档(`language = zh`)。
