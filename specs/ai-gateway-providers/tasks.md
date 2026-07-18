# Plan: ai-gateway-providers

> 依赖顺序：1→2→3 可并行度低的服务端地基先行，4 装配接线在 1-3 之后，
> 5 tool-kit 独立可穿插，6 e2e 收尾。每个任务完成即勾选。

## Tasks

- [x] 1. 服务端地基：config 与 key-resolver（`packages/server/src/ai-gateway/`）
  - [x] 1.1 `config.ts`：`resolveAiGatewayConfig(env)`（未配置→undefined；非法→AiGatewayConfigError fail-fast；含 catalogTtlMs/modelPrecedence 解析）+ vitest 单测（缺省/合法/非法 URL/优先级枚举）
  - [x] 1.2 `key-resolver.ts`：`KeyResolver` 接口 + `EnvKeyResolver`（请求期即时读 `AI_GATEWAY_API_KEY`）+ `PerUserKeyResolver` 占位（NotImplemented）+ 单测（即时生效/缺失返回 undefined）
- [x] 2. 主对话转发路由 `routes.ts`
  - [x] 2.1 `createAiGatewayRoutes(deps)`：`/ai-gateway/*` InjectedRoute（GET/POST），子路径白名单表，门控顺序 白名单→Bearer→verifyScopedToken(scope="ai-gateway")→KeyResolver，失败路径零上游请求
  - [x] 2.2 换钥转发：剔除 host/authorization/content-length+逐跳头，body arrayBuffer 缓冲，响应非缓冲流式直通，AbortSignal.any(客户端断开+timeoutMs)
  - [x] 2.3 429/402 限额标注（读 X-RateLimit-Scope/Period → 附 `x-pi-gateway-limit` 响应头，状态与 body 透传）+ `server:ai-gateway` 日志（sessionId/path/model/status/durationMs，脱敏）
  - [x] 2.4 routes 单测矩阵：白名单外 404 / 缺 token 401 / scope 不符 403 / 无凭据 502 / Authorization 换钥断言 / SSE 逐帧转发（ReadableStream mock）/ 429 头标注 / abort 联动
- [x] 3. 模型目录与聚合
  - [x] 3.1 `model-catalog.ts`：`GatewayModelCatalog`（GET /v1/models，TTL stale-while-revalidate，fail-soft 快照）+ 单测（过期刷新/失败沿用/从未成功空集）
  - [x] 3.2 目录 merge 纯函数（self ∪ gateway，条目带 source，同名按 modelPrecedence 取舍）+ 接入现有 model-options 下发链路 + 单测（三种冲突场景）
- [x] 4. 装配与前端路由决策
  - [x] 4.1 server 装配：`server/index.ts` 注入点按 `resolveAiGatewayConfig` 结果条件注册 routes 与 catalog（未配置零注册）；scope="ai-gateway" 的 token 签发接线（沿用现有 scoped-token 机制）
  - [x] 4.2 前端/agent 请求构造：按选中模型条目 `source` 分流——"ai-gateway"→`/ai-gateway/v1/chat/completions`（owned_by=anthropic→`/v1/messages`），"self"→现状 llm-gateway 路径；UI 模型选择器 source 徽章
- [x] 5. tool-kit AIGC 工厂
  - [x] 5.1 `types.ts` ImageProviderId 联合追加 "ai-gateway"；`providers/ai-gateway.ts` 薄封装工厂（占位符 base/key，零 quirks）+ 工厂单测（route 形态断言）
  - [x] 5.2 `AI_GATEWAY_IMAGE_ROUTES` 静态路由组（gpt-image-1/gpt-image-2/qwen-image）；`extension.ts` 聚合处按 env 存在条件并入（runtime 层读 env，不破双入口边界）；确认 disabledModels 过滤对新路由生效（补一条 filterRoutes 用例）
- [x] 6. e2e 冒烟（Req 6.4）
  - [x] 6.1 对照组：未配置 `AI_GATEWAY_*` 时，模型目录与图像工具路由与主干一致（快照对比断言，防回归 Req 1.2/5.3）
  - [x] 6.2 启用组：对接本地 ai-gateway（`make seed` 环境，http://127.0.0.1:8080）——一次流式主对话（走 /ai-gateway/*，断言逐帧与完成帧）+ 一次图像生成（走网关 /v1/images/generations）+ 429 限额头标注断言（用网关侧低 RPM key 触发）

## Rules & Tips

- **Router 通配路径**:`Router.matchPath` 对模板尾段字面量 `*` 天然支持通配(`segments.length >= route.segments.length - 1`，`params["*"]` 收集剩余段)，新增单段通配路由（如 `/ai-gateway/*`）直接照抄 `/llm-gateway/:provider/*` 的路径解析惯例（在 `pathname` 里定位锚点字面段、`decodeURIComponent` 逐段），无需改动 Router 本体。
- **子路径白名单 vs provider 查表**:llm-gateway 用 provider 登记表做门控第一步（未登记→404）；ai-gateway 没有 provider 概念，第一步改为**前缀白名单表**——两者都要求「未命中→404 且零上游请求」，实现手法（先查表/判断，短路 return）完全同构，可直接复用 `filterRequestHeaders`/`filterResponseHeaders`/`isHopByHopOrProxyHeader` 等纯函数。
- **scoped-token 的 secret 族要独立**:每新增一个服务面（ai-gateway）都应有自己的 `resolve<Face>Secret`（回退到 `PI_WEB_ATTACHMENT_SECRET`），签名域前缀 `pi-token.v2.<scope>.` 已保证跨面不可互换——不需要额外加盐，但**每个面都必须有独立的 primary env**（如 `PI_WEB_AI_GATEWAY_SECRET`），否则运维无法单独轮换某一面的 secret。
- **`GatewayModelCatalog` 类的 `get()` 必须同步返回**：设计要求 stale-while-revalidate（`get()` 不 await 网络），实现时用一个 `refreshing: Promise<void> | undefined` 作为进行中刷新的互斥锁，避免每次 `get()` 都重复发起后台请求；单测里若要断言"过期后台刷新已生效"，必须显式 `await` 那个刷新 promise（例如显式调用 `refresh()` 或 `await new Promise(r => setTimeout(r, 0))` 排一次微任务），否则断言会在刷新完成前跑，产生 flaky。
- **`server/` 包与 `lib/app/` 装配层的边界**：新协议面（config/key-resolver/routes/model-catalog）一律先在 `packages/server/src/<face>/` 里做成与外部环境解耦的纯工厂（`env`/`fetchImpl`/`nowFn` 全部可注入），再在 `lib/app/pi-handler.ts` 里一次性用 `process.env` 具体化装配——这样 90% 的分支覆盖可以在 `packages/server/test/` 跑纯单元测试，只有"确实接上 globalThis 单例 + 真实 env"这类装配级行为才需要写 `test/*.integration.test.ts`（用 `PI_WEB_STUB_AGENT=1` + 动态 `await import` 触发全新模块图，因为 handler 单例 pin 在 `globalThis`，两种 env 形态必须分文件跑）。
- **e2b 与本地(non-e2b) spawn 分支的凭据注入是两条不同的路径**：`llm-gateway`/`ai-gateway` 这类"发短期 token 给 agent 子进程去打 pi-web 自己的转发路由"的能力，目前的既有实现（`computeE2bProviderEnv`）只发生在 e2b 分支；本地分支的 agent 子进程与 pi-web server 同机运行，走的是直接注入真实 provider key（`config.providerKeys`），没有对应的"本地 agent 也走 pi-web 转发路由"的既有实现可参照。新增服务面若要在本地分支也生效，需要额外设计（当前 spec 范围内 ai-gateway 的 e2b 会话 token 注入抽成了独立纯函数 `computeAiGatewaySessionEnv`，只接在 e2b 分支，与 `computeE2bProviderEnv` 并列增量注入、不覆盖任何既有 key）。
- **前端没有"主对话直连 provider"的浏览器侧代码**：`.ai-rules/product.md`/`tech.md` 提到的"自定义 Provider 经 `~/.pi/agent/models.json` 接入"是 agent 子进程（pi SDK ModelRegistry）侧的机制，不是浏览器 fetch。设计文档里画的"浏览器 agent → pi-web server"箭头，实际落地时应理解为"会话所在的 agent 子进程"，而非 React 组件里的 `fetch`——排查/新增这类"主对话请求路由到哪个 provider"的功能时，先确认涉及的到底是 agent 子进程的 spawn env / models.json，还是浏览器侧组件，两者排查路径完全不同。
- **tool-kit AIGC 路由的"条件注册"只能发生在 runtime 层**（`extension.ts`），因为它是唯一允许读 `process.env` 的文件；`tools/image-generation.ts`/`image-edit.ts` 里的静态 `ROUTES` 常量必须保持无条件（不能塞 `if (env)` 分支），新 provider 若要做到"未配置就不出现"，做法是导出一个平行的 `AI_GATEWAY_IMAGE_ROUTES` 常量 + 给 `registerImageGeneration`/`registerImageEdit` 加一个 `opts.extraRoutes` 入参，由 `extension.ts` 按 env 决定要不要把这批路由喂进去——`deriveActiveModels`（下发给 UI 选择器的清单）也要同步接收这份 `extraRoutes`，否则会出现"工具真的能跑但 UI 选择器里看不到"的偏差。
- **本地 ai-gateway 网关二进制可能已经在别的会话里常驻**：先 `lsof -i :8080` 探测，若已有实例在跑，直接复用（新启动一份会 bind 失败但不影响原实例），测试跑完只需确认端口最终被释放，不要盲目 kill 掉不确定是谁启动的进程之外的其它东西。
