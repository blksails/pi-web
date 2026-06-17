# Research & Design Decisions — app-shell

## Summary
- **Feature**: `app-shell`
- **Discovery Scope**: New Feature(greenfield 整站装配)+ Complex Integration(装配 5 个上游 spec 并承载全链路 e2e)
- **Key Findings**:
  - 本 spec 是**装配层**而非实现层:所有功能能力(handler、组件、hooks、源解析)已由上游交付,本 spec 的价值在于「正确接线 + 配置注入 + 端到端验证」,任何重实现都是越界。
  - `createPiWebHandler` 返回标准 Web Fetch `(Request)=>Promise<Response>`,Next.js App Router 的 catch-all Route Handler(`app/api/sessions/[[...path]]/route.ts`)可把 `GET/POST/DELETE` 直接委托给同一 handler 实例,天然满足「薄转发 + 不改写契约」(Req 2.3)。
  - SSE 长连接 + 子进程驻留要求 `runtime = "nodejs"` 且 handler 单例必须跨请求驻留;Next dev 热重载会丢模块级单例,需挂 `globalThis`(PLAN §3.2 已点明)。
  - e2e 的成本与确定性矛盾用「stub/录制 agent + 低成本模型」化解:示例 agent 设计为可在 fixture 环境下走确定路径(固定文本 + 一次工具调用 + 一次扩展 UI 请求),Playwright 断言据此稳定。

## Research Log

### 上游契约消费面(装配输入)
- **Context**:本 spec 不得重定义上游,需精确锁定装配所依赖的对外契约。
- **Sources Consulted**:`.kiro/specs/http-api/design.md`、`.kiro/specs/ui-components/design.md`、`.kiro/specs/agent-source-resolver/design.md`、`PLAN.md` §2/§5/§6/§8/§13。
- **Findings**:
  - http-api:`createPiWebHandler(opts: { manager, store, authResolver?, authorizeSession?, sse? })` → `(req)=>Promise<Response>`;端点集为 `POST /sessions`、`POST /sessions/:id/{messages,steer,follow_up,abort,model,thinking,ui-response}`、`GET /sessions/:id/{state,stats,messages,commands,stream}`、`DELETE /sessions/:id`;鉴权接缝默认放行。
  - ui-components:`<PiChat session controls extensionUI slots showControls className />`,内部用 `useChat(transport)` + AI Elements;`usePiSession`/`usePiControls`/`useExtensionUI` 来自 `@pi-web/react`。
  - agent-source-resolver:`source: string | undefined`(本地目录 abs/rel 或 git 三形态);双模式 custom/cli 由入口存在性自动判定;`ResolveOptions` 含 `cwd`/`agentDir`/`env`/默认工作区。
  - PLAN §5 目录:`app/{layout,page,globals.css}`、`app/api/sessions/**`、`examples/hello-agent/index.ts`、`.env.local.example`。
- **Implications**:本 spec 文件 = 装配代码 + 配置 + 示例 + 测试;组件 / handler / hooks 全部 import 自上游包,本 spec 不含其源码。

### Next.js App Router 中挂载 Web Fetch handler
- **Context**:如何把框架无关 handler 接到 Next 路由且保持 SSE 流不被缓冲。
- **Sources Consulted**:http-api design「Integration」节(`app/api/[...path]/route.ts` 导出 `GET/POST/DELETE = handler`)、PLAN §3.3(全部 `runtime = "nodejs"`)、§11.5(SSE 反代要点)。
- **Findings**:catch-all 段 `[[...path]]` 用单一 Route Handler 文件即可覆盖所有子路径;Route Handler 返回的 `Response`(含 `ReadableStream` body)被 Next 原样透传,SSE 头(`X-Accel-Buffering: no` 等)由 handler 设置,本 spec 不重设。`export const runtime = "nodejs"` + `export const dynamic = "force-dynamic"` 保证不被静态化 / 缓存。
- **Implications**:API 装配集中在一个 catch-all route 文件 + 一个 handler 单例工厂模块,极薄、可单测(集成测试直接 `fetch` 进 route)。

### e2e 低成本 / stub 策略
- **Context**:Req 10.7 要求 e2e 不烧真实 API 费用且稳定。
- **Sources Consulted**:brief「e2e 可用录制 / stub 或低成本模型」、ui-components e2e(mock transport)、http-api e2e(rpc-channel stub agent)。
- **Findings**:两种可行路径——(a)示例 agent 在 e2e env 下选低成本 / 本地可控模型;(b)注入 stub agent host(经环境开关让装配走录制 / stub 通道,不真正打 LLM)。本 spec 采用「环境开关 + stub agent fixture」:`examples/hello-agent` 在 `PI_WEB_E2E_STUB` 等开关下产出确定的文本 / 工具 / 扩展 UI 序列。
- **Implications**:e2e fixture 与示例 agent 同源;Playwright 断言基于确定输出,不依赖外部网络。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 薄装配 + catch-all 委托(选定) | 单一 catch-all Route Handler 委托给单例 `createPiWebHandler`;page 用 hooks + `<PiChat>` | 零重实现、契约不漂移、测试面小 | 依赖上游契约稳定;单例驻留需处理热重载 | 与 PLAN §14.1③「网关只转发」一致 |
| 逐端点 Route Handler 文件 | 为每个端点写独立 `route.ts` 转发 | 与 PLAN §5 文件树逐条对应 | 大量重复样板、易与 handler 内部路由重复定义、维护成本高 | handler 已自带路由,逐文件属重复 |
| 在 page 内自建 fetch/SSE | 不用 `@pi-web/react`,页面直接消费 SSE | 控制力强 | 重实现 transport/hooks,严重越界 | 明确排除 |

**选定**:薄装配 + catch-all 委托。保留 PLAN §5 的 `app/api/sessions/**` 目录语义,但用 catch-all 段实现以避免与 handler 内部路由重复。

## Design Decisions

### Decision: catch-all Route Handler 委托单例 handler
- **Context**:Req 2.1/2.3/2.5 要求薄转发、不改写契约、跨请求驻留。
- **Alternatives Considered**:1) catch-all 委托;2) 逐端点 route 文件。
- **Selected Approach**:`app/api/sessions/[[...path]]/route.ts` 导出 `GET/POST/DELETE`,均委托 `getHandler()(req)`;`getHandler()` 是挂在 `globalThis` 的单例工厂,组装会话依赖一次。
- **Rationale**:handler 内部已做方法 + 路径路由,逐文件转发会重复其职责;catch-all 最薄、最不易漂移。
- **Trade-offs**:与 PLAN §5 的逐文件树略有出入,但目录语义(`app/api/sessions`)保留且更契合 handler 的「单点入口」设计。
- **Follow-up**:集成测试需覆盖 stream 端点经 catch-all 的流式透传。

### Decision: 配置注入与默认值
- **Context**:Req 3 要求从环境注入 provider/model/源/工作区/key 且不泄露密钥。
- **Selected Approach**:集中一个 `config` 模块从 `process.env` 读取并校验,产出注入 `createPiWebHandler` 装配与会话创建默认值的 typed 配置;`.env.local.example` 为样例;缺 key 时在装配 / 会话创建处给可辨识错误,日志 / 错误 / 前端永不回显明文。
- **Rationale**:单点配置便于测试与审计;符合 PLAN §3.4(env 注入子进程)与 §11.4(密钥不外泄)。
- **Trade-offs**:启动时校验 vs 会话创建时校验——采用「启动告警 + 会话创建错误」双保险。

### Decision: 示例 agent 兼作 e2e fixture(确定 / 低成本)
- **Context**:Req 8 / 10.7 要求确定且低成本的端到端驱动。
- **Selected Approach**:`examples/hello-agent/index.ts` 用 `defineAgent` 定义 model + 一个工具 + 思考 / Markdown 输出;附 `.pi/` 资源样例触发扩展 UI;在 e2e 环境开关下走确定输出(低成本模型或 stub),供两类 e2e 与权限弹窗闭环复用。无入口的 fixture 目录用于通用 CLI 回退 e2e。
- **Rationale**:fixture 与示例同源、维护一处;确定输出让 Playwright 断言稳定。
- **Trade-offs**:stub 路径与真实 LLM 行为有差异,但 MVP 验收关注「闭环可用」,差异可接受。

## Risks & Mitigations
- **单例热重载丢失**(Next dev)→ handler / 会话依赖单例挂 `globalThis`(PLAN §3.2)。
- **SSE 被反代 / 框架缓冲** → handler 设 `X-Accel-Buffering: no` + 禁压缩(上游负责),route 用 `dynamic = "force-dynamic"`、不包裹 / 不读取整段 body;部署文档提示反代关闭缓冲。
- **e2e 成本 / 不稳定** → 低成本模型 + stub 开关 + 确定 fixture 输出。
- **上游契约漂移** → 仅经 typed import 消费,契约变更触发 Revalidation;集成测试在装配边界尽早暴露不匹配。
- **越界重实现风险** → 边界节明确「消费不重定义」,File Structure Plan 中所有功能文件均为 import / 装配而非算法实现。

## References
- `PLAN.md` §2(架构)、§3.3(端点)、§3.4(配置)、§5(目录)、§6(M0/M2)、§8(MVP 验收)、§11.5(SSE 反代)、§13(分层包)、§14.1③(网关只转发)。
- `.kiro/specs/http-api/design.md` — `createPiWebHandler` 注入面与端点集。
- `.kiro/specs/ui-components/design.md` — `<PiChat>` props 与 hooks。
- `.kiro/specs/agent-source-resolver/design.md` — `source` 输入形状与双模式。
