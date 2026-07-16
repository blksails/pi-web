# Research & Discovery Log — sandbox-credentials-v2

> Discovery 类型:Extension(集成向)。主体调研在 pre-spec 阶段完成
> (`docs/sandbox-credentials-v2-design.md`,四路并行盘点),本文件记录
> 结论与 design 阶段增量核实,供追溯;design.md 自包含。

## 调研范围

1. pi-web main(9776eb5)凭据下发链路(LLM 主对话 / AIGC 工具 / 附件)
2. 附件 cloud-http 后端与宿主 attachment API 现状
3. pi-clouds 平台侧能力(env 注入 / settings UI / 网关 / token 基建)
4. pi SDK(@earendil-works/pi-coding-agent@0.80.3)provider 配置机制

## 关键发现(事实)

### F1 LLM 主对话是泄露面主体
`lib/app/config.ts` `PROVIDER_KEY_NAMES`(10 个 env 键)从宿主 env 抓真实值,
pi-handler e2b 分支把这些键**无条件并入透传白名单**进沙箱(容器 env + configure
帧双通道);沙箱基座镜像 entrypoint 按容器 env 生成 models.json。pi-clouds 生产
同构(configure 帧注真实 key),**且无 LLM 网关端点**。

### F2 pi SDK「网关认 token」零改动可行
models.json provider 支持 `baseUrl` 指任意网关 + `apiKey: "$ENV"` 插值 +
`authHeader: true` 自动注入 `Authorization: Bearer <apiKey>`
(dist/core/model-registry.js:532-565);另有 `headers` 自定义与运行时
`pi.registerProvider`。key 解析发生在 agent 进程 env——token 以 env 注入即可。

### F3 附件面 token 代理认证已成型(不需要本 spec 改代码)
main 已含 cloud-http 后端(`packages/server/src/attachment/http/`,
`X-Pi-Attachment-Token`,decl 只放 `tokenEnv` 变量名);pi-clouds 有对应
scoped attachment token(scope:"attachment",独立 secret)。s3 直连后端的
凭据透传(`computePassthroughEnv`)是自部署下的既有显式选项。

### F4 aigc-proxy 现状(main 上活跃,本 spec 摘除)
- 实现:`packages/server/src/aigc-proxy/{index,provider-registry,proxy-routes,session-token}.ts`
- 装配:`lib/app/aigc-proxy-config.ts`;`lib/app/config.ts:48,122,136`
  (aigcProxyPublicBase);pi-handler `:63-100`(import)、`:348-351`(logger)、
  `:482-524` 附近(判定+签发+六键注入+真三键剔除);
  `packages/server/src/index.ts:52-54`(barrel 导出)
- 测试:`packages/server/test/aigc-proxy/`(4 文件)+ `test/http/router.test.ts` 引用
- e2e:`e2e/aigc-proxy/{proxy-chain.local.mjs,server-entry.ts,sandbox-child.ts}`
  ——三进程编排,**是 LLM 网关 e2e 的直接改造母本**

### F5 pi-clouds 侧(边界外,契约对齐用)
- env 注入双通道:容器级白名单 secret(`packages/sandbox/src/security/env-injection.ts`)
  + configure 帧(`agent-runner.ts:48-53`;envVars 不进 Pod env,configure 帧全生效)
- settings UI 已有:`apps/cloud/app/settings/provider-keys/`(org 级、掩码、信封加密)
- 既有 scoped token 两种:consume(registry)/ attachment(cloud),均
  HMAC-SHA256 + timingSafeEqual + 独立 secret——v2 token 是同模式的统一推广

## 设计决策记录

| # | 决策 | 依据/取舍 |
|---|------|-----------|
| D1 | token v2 放 `packages/server/src/tokens/`,scope 显式作为 verify 入参逐字匹配 | 与被摘除的 aigc-proxy token(无 scope)区分;为 store/后续 scope 预留 |
| D2 | 注入沙箱的 env 用 `PI_LLM_*` 前缀(无 PI_WEB) | 跨仓契约(镜像 entrypoint、pi-clouds 同读),中性命名 |
| D3 | 宿主配置沿 pi-web 惯例 `PI_WEB_LLM_GATEWAY_*` | 与 aigc-proxy 的 PUBLIC_BASE/SECRET/TTL 解析先例同构 |
| D4 | dev 网关登记表 = 内置常用 provider 表 + `PI_WEB_LLM_GATEWAY_PROVIDERS` JSON 覆盖/追加 | 固定表会锁死自定义网关用户;纯配置无默认则 dev 开箱不可用 |
| D5 | 请求 body 缓冲转发,绝不手动 set content-length | fetch-bridge 前车之鉴:undici 混搭下手动 CL 与自动追加重复 → UND_ERR_INVALID_ARG 502 |
| D6 | 配网关后 PROVIDER_KEY_NAMES **全量**剔除(含 AIGC 复用的三键) | 基础面策略统一;AIGC 扩展面依平台注入或 operator 显式 `PI_WEB_E2B_ENV_PASSTHROUGH`,见 design Migration |
| D7 | e2e 改造 `e2e/aigc-proxy` 三进程编排为 `e2e/llm-gateway`,原 aigc-proxy e2e 随摘除删 | 复用成熟编排骨架(spawn/stub/断言),最小新建面 |
| D8 | 附件面零代码改动,仅部署文档 | cloud-http+token 已在 main;避免边界蔓延 |

## 风险

- **R-1(高)** 配网关后 AIGC 三键被剔,若无平台注入且 operator 未显式透传,
  沙箱内 image_generation 等工具将缺 key 失败 → Migration 文档显式警示 +
  装配期可识别日志。
- **R-2(中)** 镜像 entrypoint 的 models.json 网关分支在镜像仓(边界外),
  契约 env 名一旦定稿不可轻改 → design 固化 env 名并在 e2e 中以子进程模拟
  entrypoint 语义验证。
- **R-3(低)** SSE 长流经 dev 网关的 abort 传播依赖运行时 signal 联动 →
  e2e 加中断断言(可选任务)。
