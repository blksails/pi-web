// @blksails/pi-web-server — 聚合导出(各模块实现后在此 re-export)。
//
// 注意:不再从此主入口 re-export `./runner/index.js`。runner 模块在加载时即
// 静态导入完整 pi SDK(@earendil-works/pi-coding-agent / pi-ai)与 jiti——一旦
// 经此 barrel 进入 Next 服务端 bundle,会触发 webpack "Critical dependency" 告警
// 并把整套 SDK 打进路由。runner 仅由 cwd-无关的引导脚本(runner-bootstrap.mjs)
// 经 jiti 直接加载 `./runner/runner.ts` 在子进程中运行,App / Handler 从不直接
// 导入 runner。需要 runner 符号的(测试)请从 `./runner/index.js` 子路径导入。
export {};
export * from "./rpc-channel/index.js";
export * from "./agent-source/index.js";
// 内置 default-agent 入口解析(纯 node builtins,无 pi SDK 值导入,可安全 barrel 重导出)。
export * from "./builtin-agents/entry-path.js";
// trust 策略仍经子路径 `@blksails/pi-web-server/trust` 导出(消费方 pi-handler 据此导入)。
// 历史原因是 `project-trust-policy` 曾值导入 `@earendil-works/pi-coding-agent`(其 dist 拉入
// pi-ai 的 `node:fs/os/path` + 表达式 require),经 barrel `export *` 会令 Next external 失效、
// 把整套 pi SDK 打进路由 bundle。**该耦合已解除**:trust 现由本地 `FsProjectTrustStore`
// (node:fs only,见 `./trust/trust-store.ts`)直接读写 `<agentDir>/trust.json`,零 pi SDK 依赖。
// 子路径导出予以保留(稳定的显式信任面),但不再是 external 正确性的必要条件。
export * from "./session/index.js";
export * from "./session-store/index.js";
export * from "./http/index.js";
// attachment-store(L0+L1):门面 / 配置工厂 / 受认可的复用面(BlobStore / LocalFsBlobBackend /
// AttachmentRegistry / UrlSigner / BlobMeta / PutInput),供下游 attachment-tool-bridge 在子进程内
// 组合实例化。纯 node builtins(无 pi SDK 值导入),可安全经 barrel `export *` 重导出。
export * from "./attachment/index.js";
// attachment-tool-bridge(L2 投影 + 子进程 store + 闸门 + 回流 + 注入):本切片(task 1.1)
// 导出子进程 store 客户端工厂 createChildAttachmentStore + ChildAttachmentStore(上游门面别名)。
// 纯 node builtins + attachment-store 复用面(无 pi SDK 值导入),可安全经 barrel `export *` 重导出。
export * from "./attachment-bridge/index.js";
export * from "./completion/index.js";
export * from "./commands/host-command-registry.js";
export * from "./extensions/index.js";
export { runnerBootstrapPath } from "./runner-bootstrap-path.js";
export * from "./config/index.js";
// session-list(sessions-list):GET /sessions 只读列表端点的注入路由工厂。
// 仅 node builtins + session-store/http 复用面(无 pi SDK 值导入),可安全经 barrel 重导出。
export * from "./session-list/index.js";
// agent-source-list(agent-sources-list):GET /agent-sources 只读源枚举端点的注入路由工厂。
// 仅 node builtins + agent-source 只读探测(probeEntry/identify),无 pi SDK 值导入,可安全经 barrel 重导出。
export * from "./agent-source-list/index.js";
// aigc-settings(aigc-tool-settings):GET/PUT /aigc/settings —— AIGC 图像工具「被禁模型」持久设置读写。
export * from "./aigc-settings/index.js";
// vision-settings(canvas-vision-readout):GET /vision/models —— 可用视觉模型只读清单。
// ⚠ 仅重导出薄路由与类型;取数(引 pi SDK)走子路径 `@blksails/pi-web-server/vision-model-options`。
export * from "./vision-settings/index.js";
// session-actions(session-list-item-actions):删除/重命名/收藏 写端点的注入路由工厂 + 会话收藏存储。
// 仅 node builtins + session-store 复用面(无 pi SDK 值导入),可安全经 barrel 重导出。
export * from "./session-actions/index.js";
// sandbox 强制注入入口解析(仅 node builtins,无 pi SDK 值导入,可安全经 barrel 重导出)。
export { resolveSandboxEntry } from "./sandbox/entry.js";
// tokens(sandbox-credentials-v2):分面 scoped token 签发/校验原语(mintScopedToken /
// verifyScopedToken)。仅 node builtins(node:crypto),无 pi SDK 值导入,可安全经 barrel 重导出。
export * from "./tokens/index.js";
// auth(desktop-cloud-login):桌面凭据解析 + 进程内登录态 + 鉴权注入路由(createAuthRoutes)。
// 仅 node builtins + 既有 http-api InjectedRoute 契约,无 pi SDK 值导入,可安全经 barrel 重导出。
// ⚠ egress-model-source(引 pi SDK 值)不在此,由 runner 装配层子路径直接引入。
export * from "./auth/index.js";
// llm-gateway(sandbox-credentials-v2):provider 登记表 + dev/自部署 LLM 网关路由
// (createLlmGatewayRoutes)。仅 node builtins + 既有 http-api InjectedRoute 契约,无 pi SDK
// 值导入,可安全经 barrel 重导出。
export * from "./llm-gateway/index.js";
// ai-gateway(ai-gateway-providers):config 解析 + KeyResolver + 主对话转发路由
// (createAiGatewayRoutes),与 llm-gateway 同层平行、分离共存。仅 node builtins + 既有
// http-api InjectedRoute 契约,无 pi SDK 值导入,可安全经 barrel 重导出。
export * from "./ai-gateway/index.js";
// model-catalog(model-catalog spec):chat/image 双命名空间目录组装服务
// (createModelCatalogService)。纯组装零 env 零 IO,依赖仅 ai-gateway 纯函数 +
// config 纯过滤器 + tool-kit 主入口纯类型,无 pi SDK 值导入,可安全经 barrel 重导出。
// ⚠ 取数闭包(config/model-options.ts,含 pi SDK)不在此导出,由装配层注入。
export * from "./model-catalog/index.js";
