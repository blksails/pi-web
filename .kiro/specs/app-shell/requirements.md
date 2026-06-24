# Requirements Document

## Introduction

`app-shell` 是 pi-web 的**整站闭环装配层**:把已就绪的各层(`@blksails/pi-web-protocol` 协议、后端引擎、`http-api` 的 `createPiWebHandler`、`@blksails/pi-web-react` 的 hooks/transport、`@blksails/pi-web-ui` 的 `<PiChat>`)装配成一个**可直接运行、可部署、可作参考实现**的 Next.js 整站。它交付:主页面(agent 源选择 + 流式聊天)、把 `createPiWebHandler` 挂到 `app/api/sessions/**` 的 REST + SSE 路由、配置样例(`.env.local.example`)、一个供端到端验证用的示例 agent(`examples/hello-agent/index.ts` + `.pi/` 资源样例),并**承载本项目最高价值验收点——全链路 e2e 闭环**:启动应用 → 选含 `index.ts` 的 agent 源 → 输入 prompt → 浏览器内看到逐字流式回复(Markdown),工具调用显示为卡片、思考为折叠块,abort / 切模型 / stats 可用,危险操作触发权限弹窗、选择后 agent 继续;并另跑一遍通用 CLI 模式(无入口目录)e2e 验证回退路径同样流式。

本 spec **消费而非重定义**上游:`createPiWebHandler`(http-api)、`<PiChat>` 及其 hooks(ui-components / react-client)、agent 源输入形状(agent-source-resolver)、协议契约(protocol-contract)。权威设计见 `PLAN.md` §2(架构)、§5(目录结构)、§6(里程碑 M0/M2)、§8(验收标准 = MVP)。

面向使用者:想直接部署 pi-web、或想要一份分层装配参考实现的人。当前现状是各层就绪但缺把它们装配成可运行整站并验证端到端闭环;本 spec 完成这一装配与验证。

## Boundary Context

- **In scope**(本 spec 拥有):
  - Next.js 应用骨架:`app/layout.tsx`(根布局,引入主题/字体/全局样式)、`app/page.tsx`(agent 源选择器 + 聊天主页面)、`app/globals.css`(Tailwind + shadcn CSS 变量 tokens)。
  - API 装配:`app/api/sessions/**` 的 Route Handler——把 `createPiWebHandler` 实例挂到 REST + SSE 路径,声明 Node runtime,转发请求并回传响应/流。
  - 后端依赖装配:在应用进程内组装 `createPiWebHandler` 所需的会话依赖(经 http-api / session-engine 暴露的工厂),注入默认配置(provider / model / agent 源 / 工作区 / env),形成单例长驻装配。
  - 前端装配:在 `app/page.tsx` 内用 `@blksails/pi-web-react` 的 hooks(`usePiSession`/`usePiControls`/`useExtensionUI`)建立指向本站 API 的连接,渲染 `<PiChat>`;agent 源选择器把用户输入的源(目录 / git)按 agent-source-resolver 的输入形状传给建会话请求。
  - 配置:`.env.local.example` 列出 `ANTHROPIC_API_KEY` 等 provider key、默认 provider / model、默认 agent 源 / 工作区;应用启动时读取并注入装配。
  - 示例 agent:`examples/hello-agent/index.ts`(用 `defineAgent`)+ 一个 `.pi/` 资源样例(如 `.pi/extensions` 或 `.pi/prompts` 触发权限弹窗与工具/命令),作为 e2e fixture。
  - 测试:API 路由集成测试(正确转发到 handler、页面渲染)+ Playwright e2e(自定义 agent 全链路 + 通用 CLI 回退两条路径)。
- **Out of scope**(本 spec 不拥有,留给其他 spec / 未来):
  - 不重新实现引擎 / `createPiWebHandler` / `<PiChat>` 组件 / hooks / transport / 协议(全部消费上游)。
  - 不实现 SSE 编码、会话进程驻留、事件→UIMessage 翻译、子进程 spawn、JSONL framing、agent 源解析逻辑本身。
  - 不实现鉴权 / 多租户 / 密钥管理落地(http-api 仅留接缝,本 spec 默认放行装配)。
  - 不实现扩展安装管理 UI / 后端(归 `extension-management`)。
  - 多 agent 管理 / 切换、embed(Web Component / iframe)、远程 host(docker/e2b/ssh/device)均为未来,明确排除。
- **Adjacent expectations**:
  - 仅在 **Node runtime** 长驻服务运行(子进程驻留 + SSE 长连接),不支持 Serverless/Edge。
  - 需配置可用的 provider API key(e2e 可用低成本模型或录制 / stub agent 以规避 API 费用与不确定性)。
  - 依赖上游 `createPiWebHandler(opts)` 的注入面、`<PiChat>` 的 props 契约、`usePiSession` 等 hooks 的签名、agent-source-resolver 接受的 `source` 输入形状(本地目录 / git);这些契约变更触发本 spec 重校验。
  - e2e fixture(含 `index.ts` 的目录 / 不含入口的目录)经真实装配链路解析与 spawn,验证两种模式都流式。

## Requirements

### Requirement 1: Next.js 应用骨架与全局样式

**Objective:** 作为使用者,我想要一个可直接 `dev`/`build`/`start` 运行的 Next.js 应用骨架,以便启动后即可访问聊天主页面并获得一致的主题样式。

#### Acceptance Criteria

1. The app-shell shall 提供根布局,在其中引入全局样式与主题容器,并渲染主页面内容。
2. The app-shell shall 提供全局样式表,定义 shadcn CSS 变量主题 tokens,使 `<PiChat>` 及其子组件继承统一主题。
3. When 使用者以开发或生产方式启动应用并访问根路径,the app-shell shall 渲染包含 agent 源选择器与聊天区域的主页面。
4. The app-shell shall 以长驻 Node 服务形态运行,且不假定 Serverless/Edge 运行环境。
5. Where 主页面尚未建立会话,the app-shell shall 展示 agent 源选择入口而非空白或报错页面。

### Requirement 2: API 路由装配(转发到 createPiWebHandler)

**Objective:** 作为前端与第三方客户端,我想要本站在 `/api/sessions/**` 暴露完整的 REST + SSE 接口,以便创建会话、发送命令、查询状态并接收流式事件。

#### Acceptance Criteria

1. The app-shell shall 在 `app/api/sessions/**` 路由中装配单例 `createPiWebHandler` 并把收到的请求转发给它、把其返回的响应回传给客户端。
2. The app-shell shall 为所有会话 API 路由声明 Node runtime(非 Edge),以满足子进程驻留与 SSE 长连接前提。
3. When 客户端对会话 API 发起 `POST`/`GET`/`DELETE` 请求,the app-shell shall 将请求(方法、路径、头、体)无损转交 `createPiWebHandler` 并原样回传其 `Response`,不改写其状态码与契约语义。
4. When 客户端请求 `GET /api/sessions/:id/stream`,the app-shell shall 回传 `createPiWebHandler` 产生的 `text/event-stream` 长连接流且不缓冲整段响应。
5. The app-shell shall 在同一进程内维持装配后的会话依赖跨请求驻留(同一 handler 实例服务所有会话请求),不在每次请求重新构造会话状态。

### Requirement 3: 后端依赖装配与配置注入

**Objective:** 作为部署者,我想要应用从环境配置组装后端会话依赖并把默认 provider/model/agent 源/工作区/密钥注入会话创建,以便无需改代码即可配置运行参数。

#### Acceptance Criteria

1. The app-shell shall 在应用进程内组装 `createPiWebHandler` 所需的会话依赖,并以单例形式在请求间复用。
2. The app-shell shall 提供配置样例文件,列出 provider API key(含 `ANTHROPIC_API_KEY`)、默认 provider、默认 model、默认 agent 源与默认工作区项。
3. When 应用启动,the app-shell shall 从环境配置读取上述项并注入会话装配(provider key 经 env 透传给会话、默认 provider/model/agent 源/工作区作为会话创建默认值)。
4. If 必需的 provider API key 缺失,then the app-shell shall 以可辨识的配置错误提示(启动日志或会话创建错误)而非静默失败或泄露密钥值。
5. The app-shell shall 不在日志、错误响应或前端回显中输出 provider key 等敏感配置的明文值。

### Requirement 4: Agent 源选择与会话创建

**Objective:** 作为使用者,我想要在页面上选择一个 agent 源(含 `index.ts` 的目录 / git,或不含入口的目录)并据此创建会话,以便对该 agent 开始聊天。

#### Acceptance Criteria

1. The app-shell shall 在主页面提供 agent 源输入,接受 agent-source-resolver 所支持的源形状(本地目录或 git)。
2. When 使用者提交一个 agent 源,the app-shell shall 以该源(及默认工作区 / model / env)经会话创建 API 建立会话并取得会话标识。
3. When 未显式提供 agent 源而使用者选择以默认源开始,the app-shell shall 使用配置的默认 agent 源 / 工作区创建会话。
4. While 会话创建进行中,the app-shell shall 展示进行中指示,完成后切换到聊天界面。
5. If 会话创建失败(源不可解析、依赖错误等),then the app-shell shall 展示可辨识的错误提示并允许重新选择源,而非崩溃或停留在加载态。

### Requirement 5: 流式聊天主链路(MVP 验收核心)

**Objective:** 作为使用者,我想要输入 prompt 后在浏览器内看到 assistant 的逐字流式回复(Markdown),以便像普通聊天产品一样使用该 agent。

#### Acceptance Criteria

1. The app-shell shall 在会话建立后渲染 `<PiChat>` 并以指向本站 API 的连接驱动其消息流。
2. When 使用者输入 prompt 并提交,the app-shell shall 经会话连接发送该 prompt 并把用户消息追加到对话。
3. While assistant 正在回复,the app-shell shall 在浏览器内以逐字增量方式渲染流式文本(Markdown)。
4. When assistant 回复包含工具调用,the app-shell shall 把工具调用渲染为工具卡片(start/update/end 三态)。
5. When assistant 回复包含思考过程,the app-shell shall 把思考过程渲染为可折叠块。
6. When 一轮回复结束,the app-shell shall 结束流式指示并保留完整对话内容。

### Requirement 6: 会话控制(中止 / 切模型 / 统计)

**Objective:** 作为使用者,我想要中止生成、切换模型、查看 token/成本统计,以便在对话过程中控制 agent 行为与开销。

#### Acceptance Criteria

1. While assistant 正在回复,the app-shell shall 提供中止入口;当使用者触发中止,the app-shell shall 经会话连接发出中止并使流式收束。
2. When 使用者通过控制面切换模型,the app-shell shall 经会话连接提交模型切换并在界面反映当前模型与切换的进行 / 失败态。
3. The app-shell shall 展示当前会话的 token / 成本统计,并在统计更新时刷新显示。
4. The app-shell shall 经 hooks 旁路完成控制操作(中止 / 切模型 / 统计),不把控制操作写入聊天消息流。

### Requirement 7: 权限弹窗(扩展 UI)闭环

**Objective:** 作为使用者,当 agent 发起危险操作或需要确认时,我想要看到权限弹窗并作答后让 agent 继续,以便安全地授权敏感操作。

#### Acceptance Criteria

1. When 会话产生扩展 UI 请求(select/confirm/input/editor),the app-shell shall 弹出对应类型的权限弹窗呈现该请求。
2. When 使用者在权限弹窗作答并提交,the app-shell shall 经会话连接回传与该请求匹配的响应。
3. When 权限响应被会话接受,the app-shell shall 关闭弹窗并使 agent 继续后续生成 / 流式输出。
4. If 权限响应回传失败,then the app-shell shall 保留弹窗并提示错误,允许使用者重试。

### Requirement 8: 示例 Agent 与 fixture 资源

**Objective:** 作为本项目的验证者,我想要一个用 `defineAgent` 写的示例 agent 与一个 `.pi/` 资源样例,以便端到端 e2e 能以确定、低成本的方式驱动完整闭环。

#### Acceptance Criteria

1. The app-shell shall 提供示例 agent 入口(`examples/hello-agent/index.ts`),用 `defineAgent` 定义,可被自定义 agent 模式装配链路解析为含入口的源。
2. The app-shell shall 在示例 agent 中包含至少一个工具调用与可触发的思考 / Markdown 文本输出路径,使 e2e 能验证工具卡片与折叠思考块的渲染。
3. The app-shell shall 提供一个 `.pi/` 资源样例(扩展 / prompt 等),使 e2e 能触发权限弹窗(扩展 UI)闭环。
4. The app-shell shall 使示例 agent 在 e2e 下可用低成本模型或录制 / stub 方式运行,以避免真实 API 费用与不确定性。

### Requirement 9: 通用 CLI 模式(无入口目录)回退闭环

**Objective:** 作为使用者,当我提供一个不含入口文件的普通目录作为源时,我想要应用仍以通用 pi CLI 模式起会话并流式回复,以便把任意项目目录当作 agent 工作区使用。

#### Acceptance Criteria

1. When 使用者提供一个不含入口文件的目录作为 agent 源,the app-shell shall 经装配链路以通用 CLI 模式创建会话(回退路径)。
2. When 在通用 CLI 模式会话中输入 prompt,the app-shell shall 在浏览器内以逐字增量方式渲染流式回复,与自定义 agent 模式表现一致。
3. The app-shell shall 使通用 CLI 模式与自定义 agent 模式复用同一前端与 API 装配,不要求使用者区分两种模式的操作方式。

### Requirement 10: 测试与端到端验证(硬性)

**Objective:** 作为本项目的质量负责人,我想要集成测试与 Playwright e2e 以新鲜运行证据证明整站闭环可用,以便把 MVP 验收建立在可复现的实测之上。

#### Acceptance Criteria

1. The app-shell shall 提供 API 路由集成测试,验证会话 API 路由把请求正确转发到 `createPiWebHandler` 并回传其响应(含 SSE 流端点),且主页面可渲染。
2. The app-shell shall 提供 Playwright e2e:启动应用 → 选择含 `index.ts` 的 fixture agent 源 → 输入 prompt → 在浏览器内断言看到逐字流式回复(Markdown)。
3. The app-shell shall 在该 e2e 中断言工具调用渲染为卡片、思考渲染为可折叠块。
4. The app-shell shall 在该 e2e 中断言中止、切模型、统计三项控制可用并产生可观察效果。
5. The app-shell shall 在该 e2e 中断言权限弹窗触发 → 作答选择 → 弹窗关闭且 agent 继续的完整闭环。
6. The app-shell shall 提供第二条 Playwright e2e:以一个无入口目录作为源,验证通用 CLI 模式回退路径同样在浏览器内流式回复。
7. The app-shell shall 使 e2e 以低成本模型或录制 / stub agent 运行,以规避真实 API 费用与不稳定。
8. The app-shell shall 使集成测试与 e2e 可经各自单一命令运行并产出可验证的通过 / 失败结果。
