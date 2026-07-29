# Requirements: ai-gateway-providers（ai-gateway 专属 provider 套件）

> 依据：`~/Projects/BlackSail/agents/ai-gateway/docs/pi-web-integration.md`（§0 架构原则、§2 主对话、§3 AIGC、§4 Key 体系）。
> 约束来源：`.ai-rules/tech.md`（两套 LLM 调用面、双入口边界）、`.ai-rules/structure.md`（包依赖方向）。
>
> 一句话目标：为 ai-gateway 新增一套**专属 providers**（主对话转发路由 + AIGC 图像工厂），
> 与现有 llm-gateway 自配机制**分离共存**——不配置则行为与今天逐字节一致。

## Story 1：套件开关与零侵入

作为 pi-web 部署方，我希望通过环境变量决定是否启用 ai-gateway 套件，未启用时一切照旧，
以便安全灰度、随时回退。

验收标准（EARS）：
- 1.1 WHEN 宿主进程存在 `AI_GATEWAY_BASE_URL` 且 KeyResolver 可解析出凭据 THEN 系统 SHALL 注册 ai-gateway 套件（主对话路由 + AIGC 路由组 + 模型目录源）。
- 1.2 WHEN `AI_GATEWAY_BASE_URL` 未配置 THEN 系统 SHALL 不注册套件的任何路由/目录项，且现有 llm-gateway 与 AIGC 直连 provider 的行为 SHALL 与启用前逐字节一致。
- 1.3 系统 SHALL 不修改 `packages/server/src/llm-gateway/` 登记表机制与 `packages/tool-kit/src/aigc/providers/{openrouter,newapi,sufy,dashscope}.ts` 现有工厂的对外行为（自配 provider 能力保留）。
- 1.4 IF 套件配置不合法（如 baseURL 非法 URL） THEN 系统 SHALL 在装配期 fail-fast 抛出含字段名的清晰错误（zod 解析），而非静默降级。

## Story 2：主对话转发路由 `/ai-gateway/*`

作为 Agent 作者/终端用户，我希望主对话可以选用 ai-gateway 目录里的模型，请求经 pi-web
server 换钥转发到网关，以便获得统一计费/配额/故障切换。

验收标准（EARS）：
- 2.1 系统 SHALL 在 Hono host 上新增独立路由模块 `packages/server/src/ai-gateway/`（与 `/llm-gateway/:provider/*` 平行），挂载 `/ai-gateway/*`。
- 2.2 WHEN 请求路径不在白名单（`/v1/chat/completions`、`/v1/messages`、`/v1/models`、`/v1/images/*`、`/dashscope/api/v1/tasks/*`）内 THEN 系统 SHALL 返回 404 且不发出任何上游请求。
- 2.3 WHEN 请求缺少 Bearer token 或 scoped token 校验失败（scope=`ai-gateway`） THEN 系统 SHALL 分别按 401/403 短路（与 llm-gateway 同样的防探测文案约定），零上游请求。
- 2.4 WHEN 门控通过 THEN 系统 SHALL 剔除入站 Authorization 后以 KeyResolver 解析出的 `sk-gw-*` key 重签 Authorization 并转发，响应体 SHALL 非缓冲流式直通（SSE 逐帧边到边）。
- 2.5 WHEN 上游返回 429 或 402 THEN 系统 SHALL 读取 `X-RateLimit-Scope`/`X-RateLimit-Period` 响应头并在转发响应中附加归一化的限额/欠费错误标记（供 UI 显示可读提示），原始状态码与响应体 SHALL 保持透传。
- 2.6 WHEN 客户端中断连接 THEN 系统 SHALL 取消对上游的请求（AbortSignal 联动）。
- 2.7 系统 SHALL 每请求记录 `{sessionId, status, durationMs, model}` 服务端日志，且日志与响应 SHALL 不含 `sk-gw-*` 明文。

## Story 3：Key 解析（KeyResolver）

作为运营方，我希望网关凭据的来源可演进（先平台单 key，后每用户一把），且浏览器永远
拿不到真实 key。

验收标准（EARS）：
- 3.1 系统 SHALL 定义 `KeyResolver` 接口并提供 P0 实现：从宿主 env `AI_GATEWAY_API_KEY` 读取单一平台 key（请求期即时读取，不缓存，换 key 即时生效）。
- 3.2 系统 SHALL 预留 P1 实现位（按会话用户查 per-user key），接口签名 SHALL 携带用户标识入参；本期不实现查表逻辑。
- 3.3 WHEN KeyResolver 无法解析出凭据 THEN 系统 SHALL 返回 502 且错误文案不含 env 变量名以外的敏感信息。
- 3.4 真实 key SHALL 仅存在于 server 进程内存；任何下发给浏览器的配置/状态 SHALL 不包含它（双入口边界：浏览器 bundle 顶层不得读 `process.env`）。

## Story 4：模型目录（动态，双目录聚合）

作为终端用户，我希望模型选择器同时看到 ai-gateway 托管模型与自配 provider 模型，
且来源可辨识。

验收标准（EARS）：
- 4.1 WHEN 套件启用 THEN 系统 SHALL 周期性（TTL 缓存，默认 5min）从网关 `GET /v1/models` 拉取模型清单，条目含 `id` 与 `owned_by`。
- 4.2 系统 SHALL 把网关目录与现有自配目录聚合下发，每条目带来源标记 `source: "ai-gateway" | "self"`；UI 选择器 SHALL 以徽章区分来源。
- 4.3 WHEN 同名模型同时存在于两个目录 THEN 系统 SHALL 默认取 ai-gateway 条目，且 SHALL 支持 `PI_WEB_AI_GATEWAY_MODEL_PRECEDENCE=self` 反转。
- 4.4 WHEN 网关模型目录拉取失败 THEN 系统 SHALL 沿用上次成功快照（fail-soft）；WHEN 从未成功过 THEN ai-gateway 目录 SHALL 为空集且不影响自配目录展示。
- 4.5 WHILE 会话使用 ai-gateway 目录条目 THE 请求 SHALL 路由到 `/ai-gateway/*`（scope=`ai-gateway`）；WHILE 使用自配条目 THE 请求 SHALL 照旧路由到 `/llm-gateway/:provider/*`——两套互不串路。

## Story 5：AIGC 图像 provider 工厂

作为终端用户，我希望图像生成/编辑工具可以选用网关托管的图像模型，异步轮询等复杂度
由网关承担。

验收标准（EARS）：
- 5.1 系统 SHALL 新增 `packages/tool-kit/src/aigc/providers/ai-gateway.ts`，以 openai-compat 通用工厂薄封装实现 `createAiGatewayImage` / `createAiGatewayImageEdit`（baseUrl 用 `${AI_GATEWAY_BASE_URL:-…}/v1` 占位符、apiKeyVar=`AI_GATEWAY_API_KEY`），且 SHALL 不携带任何 quirks 特判（已下沉网关）。
- 5.2 系统 SHALL 在 `ImageProviderId` 联合类型追加 `"ai-gateway"`，路由表增补一组网关图像模型路由项（第一期静态声明）。
- 5.3 WHEN 部署未配置 `AI_GATEWAY_*` THEN ai-gateway 路由组 SHALL 整体不注册，图像工具的模型枚举与行为 SHALL 与今天一致。
- 5.4 `disabledModels` 持久设置 SHALL 对两套 provider 的路由统一生效（filterRoutes 不区分来源）。
- 5.5 WHEN 网关图像调用失败 THEN 工具结果 SHALL 呈现可读错误并提示可改选自配 provider 模型；系统 SHALL NOT 跨套件自动重试（避免双重计费）。

## Story 6：工程约束

- 6.1 新增代码 SHALL 遵循包依赖方向铁律（server 不依赖 UI；tool-kit 不引 server）。
- 6.2 tool-kit 新增模块 SHALL 守双入口边界：模块顶层不读 `process.env`，base/key 一律经 `${VAR}` 占位符由 var-resolver 运行时展开。
- 6.3 主对话路由与 AIGC 工厂 SHALL 各自带单测（门控矩阵、流式透传、目录聚合优先级、工厂产出形态），并入现有 vitest 套件。
- 6.4 系统 SHALL 提供 e2e 冒烟（Playwright 或 server 级集成测试）：本地 ai-gateway（`make seed` 环境）+ 套件启用，跑通一次流式主对话与一次图像生成。
