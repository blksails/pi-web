# Research & Design Decisions — aigc-key-proxy

## Summary

- **Feature**: `aigc-key-proxy`
- **Discovery Scope**: Extension(轻量发现)——沿既有接缝(统一端点执行器 / 自研 Router / e2b 注入路径)扩展,无新外部依赖。
- **Key Findings**: 全部 aigc 请求已收敛到单一执行接缝且 URL/headers 支持 env 占位展开;Router 无通配段需最小扩展;容器 entrypoint 属 pi-clouds 兄弟仓故 LLM 凭据收口划出边界。

## Research Log

### R1: aigc 工具执行链的单一接缝

- **来源**: `packages/tool-kit/src/engine/endpoint-adapter.ts:73-80`、`packages/tool-kit/src/engine/var-resolver.ts:20`
- **发现**: 所有 aigc 路由(newapi/sufy/dashscope)经 `runEndpoint` 执行;`behavior.url` 与每个 header 值均过 `resolveVars`,支持 `${VAR:-default}` 占位(值源 `process.env`,带默认值的占位永不视为缺失)。dashscope 异步轮询 `statusUrl/responseUrl` 同样过 `resolveVars`(`endpoint-adapter.ts:126-127`),且其 `taskUrl` 由模块常量 `BASE` 拼接(`dashscope.ts:17,26-27`)——改 `BASE` 即自动覆盖轮询。
- **结论**: 工具与执行引擎零改动;仅改三个 provider 声明的 baseUrl 字面量为占位。

### R2: provider 声明现状(改动点字面量)

| Provider | 文件 | 现值 | key env |
|---|---|---|---|
| newapi | `packages/tool-kit/src/aigc/providers/newapi.ts:32` | `https://www.apiservices.top/v1` | `NEWAPI_API_KEY` |
| sufy | `packages/tool-kit/src/aigc/providers/sufy.ts:36` | `https://openai.sufy.com/v1` | `SUFY_API_KEY` |
| dashscope | `packages/tool-kit/src/aigc/providers/dashscope.ts:17` | `https://dashscope.aliyuncs.com/api/v1` | `DASHSCOPE_API_KEY` |

`trimSlash` 只剥尾斜杠不动占位;`checkRequiredVars` 只查 `apiKeyVar` 不受影响。

### R3: HTTP 路由架构(通配能力缺口)

- **来源**: `packages/server/src/http/router.ts:92-110`、`lib/app/api-route.ts`、`lib/app/pi-handler.ts:646-699`
- **发现**: vite-spa 迁移后宿主以 `app.all("/api/*")` 把全部 `/api` 流量交单例 handler → 自研 `Router`。新顶层段只需经 `routes: [...]` 注入,**无需**旧 Next 时代的 catch-all 文件。但 `Router.matchPath` 要求段数相等、仅支持 `:param` 单段捕获——**无尾部通配**,无法表达「任意子路径转发」。
- **决策**: 给 Router 增加**尾段 `*` 通配**(最小扩展):模板尾段为 `*` 时允许实际段数 ≥ 模板段数-1,余段以 `params["*"]` 连接回传。内置路由在前、先匹配先赢,通配注入路由不影响既有精确路由(Req 1.7 语义保持)。
- **备选被拒**: 逐深度注册 `/:a`、`/:a/:b`、`/:a/:b/:c`…——脆弱(dashscope 轮询路径深度不可枚举)、可读性差。

### R4: 流式/multipart 转发的既有范式

- **来源**: `packages/server/src/http/routes/attachment-routes.ts:173-175,227`(Node 流→`Response(stream)`)、`endpoint-adapter.ts:78,307-317`(FormData 时 strip content-type 让 runtime 自设 boundary)、`:190-220`(SSE = OpenAI-chat 流,`accept: text/event-stream`)
- **结论**: 代理端 handler 直接 `fetch(upstream, { body: req.body, duplex: "half" })` 透传请求体、`new Response(upstream.body)` 透传响应体——两个方向都不整体缓冲。请求 headers 透传但剔除 `host`/`authorization`/逐跳头;`content-type`(含 multipart boundary)原样保留。

### R5: 会话凭据机制(build-vs-adopt)

- **来源**: `packages/server/src/attachment/url-signer.ts:31-36,51-60`
- **采用**: 复用 url-signer 的 HMAC-SHA256 + `timingSafeEqual` 常量时间比对范式,新写 aigc-proxy 专用 token 模块(签名域前缀区分用途,不与附件签名互换)。secret 解析:`PI_WEB_AIGC_PROXY_SECRET` 优先,回退 `PI_WEB_ATTACHMENT_SECRET`(既有稳定 secret 链,主进程即签即验,无跨进程分发需求)。
- **被拒**: JWT 库(引依赖,HMAC 自研范式已在仓内验证);向 NewAPI 申请子 key(方案 B,留作后续,不属本 spec)。

### R6: e2b 注入路径与透传名单

- **来源**: `lib/app/pi-handler.ts:461-525`、`lib/app/config.ts:52-72`(PROVIDER_KEY_NAMES 10 键)
- **发现**: e2b 分支 `e2bSpec.env` 并入全部 `config.providerKeys`,键名无条件进 `envPassthrough`。aigc 网关键 = `NEWAPI_API_KEY`/`SUFY_API_KEY`/`DASHSCOPE_API_KEY`(3/10);其余(ANTHROPIC/OPENAI/…/APISERVICES)供 pi SDK LLM 用,**不在本 spec 边界**。
- **决策**: 代理模式下,e2b 分支把这 3 键从注入中剔除,改注入 `{NEWAPI,SUFY,DASHSCOPE}_BASE_URL`(指向代理)+ 同名 `*_API_KEY`(值=会话 token)。本地 spawn 分支代码路径不同(直接继承宿主 env),天然不受影响。

### R7: 容器 entrypoint 归属(边界依据)

- **来源**: `.kiro/specs/sandbox-baked-agent-image/design.md:365`;`packages/server/src/sandbox-image/bake-plan.ts`
- **发现**: 容器内 `models.json` 由 pi-clouds 基础镜像 `pi-clouds/agent-runner:pi` 的 entrypoint 按容器 env 生成;本仓只透传 env。把 LLM provider 的 baseURL 指向代理需要 entrypoint 支持 baseURL 注入——跨仓改动。
- **决策**: LLM/视觉凭据(APISERVICES_API_KEY 等)划出本 spec 边界,另立 spec;requirements.md Boundary Context 已声明。

### R8: e2e 可行性(无 e2b 凭据下的端到端)

- **来源**: `e2e/sandbox-browser.local.mjs:111-135`(沙盒 e2e 门控:缺 kubectl/凭据 SKIP)、`package.json:40-45`
- **决策**: 主 e2e 不依赖 e2b 基建——起真实 pi-web server(代理路由启用)+ 本地 stub 上游网关(node:http),在独立子进程(env 只有 token 与代理地址,无真实 key)经真实 `runEndpoint` 走完 工具→代理→上游 全链;断言:产物正确、上游收到真实 key、子进程 env 与响应中不含真实 key。e2b 注入组合以集成测试覆盖(既有 `test/route.integration.test.ts` 风格)。

## Design Decisions(synthesis)

1. **Generalization**: 「网关地址覆盖」以 per-provider env 占位(`X_BASE_URL`)表达而非专用代理开关——同一机制天然支持未来任意 OpenAI 兼容网关接入代理,接口通用、实现只覆盖当前三网关。
2. **Build-vs-adopt**: 转发用平台原生 `fetch` 流式能力(`duplex:"half"` + `Response(body)`),不引 http-proxy 类库;token 复用仓内 HMAC 范式,不引 JWT。
3. **Simplification**: 不做请求改写/响应改写层(dashscope 轮询 URL 由工具侧占位解决,代理只做纯路径映射);不做 token 撤销存储(过期即失效,会话粒度审计靠 token 内嵌 sessionId);Router 只加尾段通配这一种能力。

## Risks

| 风险 | 缓解 |
|---|---|
| Router 通配扩展影响既有匹配 | 通配仅在模板显式声明尾段 `*` 时生效;既有模板语义零变化;补精确/通配共存单测 |
| 流式请求体转发需 `duplex:"half"`(undici 特性) | Node ≥18 undici fetch 支持;集成测试以真实 HTTP 服务器验证 multipart/SSE 两向流式 |
| 未配代理时的兼容透传被误解为安全 | Req 1.2 要求可识别警告日志;文档标注目标态为代理模式 |
| token 过期早于沙盒存活 | TTL = e2b timeoutMs + 安全余量,且可独立配置覆盖(Req 3.2) |
