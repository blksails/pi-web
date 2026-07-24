/**
 * host-assembly — 默认能力面清单(spec: host-contract-capability-composition,M3;设计 D2/D3/D4)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §5.1 / §5.3。
 *
 * `defaultCapabilities(deps)` 把 §5.3 的 16 个冻结 id 绑定到 pi-web 现有的路由/命令工厂,产出
 * `CapabilityDescriptor<HostDeps, HostContribution>[]`,供 `composeCapabilities` 强制表态后装配。
 *
 * ⚠ **D0 铁律**:本模块 import 真实工厂(含 pi SDK 传递依赖),经
 * `@blksails/pi-web-server/host-assembly` 子路径出口,**绝不**经 server 主 barrel `src/index.ts`
 * 导出——否则拖垮 routes bundle 的 `node:fs`。
 *
 * HostDeps 与 defaultCapabilities 同置一文件:二者紧密耦合,合并可免去跨文件重复借用工厂 opts
 * 类型(design 的分文件是建议,此处微调)。
 */
import type { CapabilityDescriptor } from "../host-manifest/index.js";
import type { HostCommandHandler } from "../commands/host-command-registry.js";
import { asCommands, asRoutes, type HostContribution } from "./host-contribution.js";
import { createConfigRoutes } from "../config/config-routes.js";
import { createMcpConfigRoutes } from "../config/mcp-config-routes.js";
import { createSandboxProjectRoutes } from "../config/sandbox-project-routes.js";
import { createSourceSettingsRoutes } from "../config/source-settings-routes.js";
import { createExtensionsConfigRoutes } from "../config/extensions-config-routes.js";
import { createSessionListRoutes } from "../session-list/session-list-routes.js";
import { createSessionActionsRoutes } from "../session-actions/session-actions-routes.js";
import { createAgentSourcesRoutes } from "../agent-source-list/agent-sources-routes.js";
import { createFavoritesRoutes } from "../agent-source-list/favorites-routes.js";
import { createLlmGatewayRoutes } from "../llm-gateway/gateway-routes.js";
import { createAiGatewayRoutes } from "../ai-gateway/routes.js";
import { createAuthRoutes } from "../auth/auth-routes.js";
import { createAttachmentRoutes } from "../http/routes/attachment-routes.js";
import { createBashRoutes } from "../http/routes/bash-routes.js";
import { createExtensionRoutes } from "../extensions/routes.js";

// 借工厂 opts 类型(避免手写/跟踪每个 opts 类型名;工厂本就在本模块 import)。
type ConfigOpts = NonNullable<Parameters<typeof createConfigRoutes>[0]>;
type SourceSettingsOpts = Parameters<typeof createSourceSettingsRoutes>[0];
type SessionListOpts = Parameters<typeof createSessionListRoutes>[0];
type AttachmentOpts = NonNullable<Parameters<typeof createAttachmentRoutes>[1]>;
type ExtensionOpts = Parameters<typeof createExtensionRoutes>[0];
type LlmGatewayOpts = Parameters<typeof createLlmGatewayRoutes>[0];
type AiGatewayOpts = Parameters<typeof createAiGatewayRoutes>[0];
type AuthOpts = Parameters<typeof createAuthRoutes>[0];

/**
 * 宿主装配依赖并集(设计 D4)。在 `buildSingleton()` 内一次构造,传给 `defaultCapabilities` 与
 * `composeCapabilities`。
 *
 * 条件挂载(llm/ai/auth)用**可选字段**表达:未配置时字段为 `undefined`,对应能力面 factory
 * 产空路由集(等价现状三元 `cond ? createX(...) : []`)。secret 等的惰性/条件求值发生在
 * `buildSingleton` 构造这些可选字段时——未配置时根本不构造,规避 `resolveLlmGatewaySecret` 等
 * 在未配置时抛错。
 */
export interface HostDeps {
  readonly agentDir: string;
  readonly defaultCwd: string;
  /**
   * 可选:注入的宿主状态 `Workspace`(config-workspace-injection)。提供时 config.domains / config.source
   * 的读写导向注入的(租户隔离的)命名空间而非本地 fs;缺省不传 = 现状路径分支。desktop 不传。
   */
  readonly workspace?: ConfigOpts["workspace"];
  /**
   * 可选:config 域的管理员鉴权接缝(config-workspace-injection / 契约 §4 R4)。提供时透传给
   * config.domains / config.source 工厂(拒绝 → 403);缺省 = 各工厂默认放行(本地单用户)。
   * 云端(pi-clouds C3)注入 role-based 实现,防多租户下未鉴权写面。
   */
  readonly adminPolicy?: ConfigOpts["adminPolicy"];
  readonly listModelOptions: ConfigOpts["listModelOptions"];
  readonly resolveSourceSettings: SourceSettingsOpts["resolveSettings"];
  readonly onSourceSettingsSaved: SourceSettingsOpts["onSaved"];
  readonly sessionStoreConfig: SessionListOpts["storeConfig"];
  readonly sessionsGlobalEnabled: boolean;
  readonly sessionsManageEnabled: boolean;
  readonly sourcesScanRoots: readonly string[];
  readonly sourcesRegistryPath: string;
  /** 仅 `config.llmGateway?.serve` 时构造(否则 undefined);gateway.llm 据此挂载。 */
  readonly llmGateway?: LlmGatewayOpts;
  /** 仅 AI 网关已配置时构造;gateway.ai 据此挂载。 */
  readonly aiGateway?: AiGatewayOpts;
  /** 仅云登录已配置时非空;auth.session 据此挂载。 */
  readonly authState?: AuthOpts["state"];
  readonly attachmentStore: Parameters<typeof createAttachmentRoutes>[0];
  readonly resolveWriteBackend: AttachmentOpts["resolveWriteBackend"];
  readonly store: Parameters<typeof createBashRoutes>[0];
  readonly bashEnabled: boolean;
  readonly extension: ExtensionOpts;
  readonly hostCommandHandlers: readonly HostCommandHandler[];
}

type HostDescriptor = CapabilityDescriptor<HostDeps, HostContribution>;

/**
 * 16 个 v1 能力面的默认绑定(顺序同 `HOST_CAPABILITY_IDS_V1`)。
 *
 * `deps` 参数为契约签名(§5.1)保留;各 descriptor 的 `factory` 经 `composeCapabilities` 收到
 * 同一个 `deps`(pi-handler 传同一对象),故此处不闭包捕获,让 factory 保持纯(吃参数)。
 */
export function defaultCapabilities(deps: HostDeps): readonly HostDescriptor[] {
  void deps;
  return [
    // ⚠ 顺序敏感(非名册顺序):Router 按注册顺序匹配、首个 method+path 命中即返回
    // (router.ts:163 `for...break`)。`/config/mcp` 与 `/config/:domain` 同为 2 段 GET,
    // 若 config.domains 在前,GET /config/mcp 会被 `:domain`(="mcp") 抢匹配 → DOMAIN_NOT_FOUND。
    // 故 config.mcp **必须**排在 config.domains 之前(复刻现状 pi-handler 的既有约束)。
    // 顺序不同于 HOST_CAPABILITY_IDS_V1 名册,但 id 集相等(装配级测试守卫①)。
    { id: "config.mcp", factory: (d) => asRoutes(createMcpConfigRoutes({ agentDir: d.agentDir })) },
    // config.domains / config.source:透传可选 `workspace`(注入承载) 与 `adminPolicy`(鉴权)——
    // 提供时走注入分支(config-workspace-injection);缺省则 rootDir 路径 + 默认放行(现状零变化)。
    {
      id: "config.domains",
      factory: (d) =>
        asRoutes(
          createConfigRoutes({
            rootDir: d.agentDir,
            listModelOptions: d.listModelOptions,
            ...(d.workspace !== undefined ? { workspace: d.workspace } : {}),
            ...(d.adminPolicy !== undefined ? { adminPolicy: d.adminPolicy } : {}),
          }),
        ),
    },
    { id: "config.sandboxProject", factory: (d) => asRoutes(createSandboxProjectRoutes({ defaultCwd: d.defaultCwd })) },
    {
      id: "config.source",
      factory: (d) =>
        asRoutes(
          createSourceSettingsRoutes({
            rootDir: d.agentDir,
            defaultCwd: d.defaultCwd,
            resolveSettings: d.resolveSourceSettings,
            onSaved: d.onSourceSettingsSaved,
            ...(d.workspace !== undefined ? { workspace: d.workspace } : {}),
            ...(d.adminPolicy !== undefined ? { adminPolicy: d.adminPolicy } : {}),
          }),
        ),
    },
    { id: "config.extensions", factory: (d) => asRoutes(createExtensionsConfigRoutes({ agentDir: d.agentDir, defaultCwd: d.defaultCwd })) },
    { id: "session.list", factory: (d) => asRoutes(createSessionListRoutes({ storeConfig: d.sessionStoreConfig, globalEnabled: d.sessionsGlobalEnabled, defaultCwd: d.defaultCwd })) },
    { id: "session.actions", factory: (d) => asRoutes(createSessionActionsRoutes({ storeConfig: d.sessionStoreConfig, agentDir: d.agentDir, manageEnabled: d.sessionsManageEnabled })) },
    { id: "agentSource.list", factory: (d) => asRoutes(createAgentSourcesRoutes({ scanRoots: d.sourcesScanRoots, registryPath: d.sourcesRegistryPath })) },
    { id: "agentSource.favorites", factory: (d) => asRoutes(createFavoritesRoutes({ agentDir: d.agentDir })) },
    { id: "gateway.llm", factory: (d) => (d.llmGateway !== undefined ? asRoutes(createLlmGatewayRoutes(d.llmGateway)) : []) },
    { id: "gateway.ai", factory: (d) => (d.aiGateway !== undefined ? asRoutes(createAiGatewayRoutes(d.aiGateway)) : []) },
    { id: "auth.session", factory: (d) => (d.authState !== undefined ? asRoutes(createAuthRoutes({ state: d.authState })) : []) },
    { id: "attachment.routes", factory: (d) => asRoutes(createAttachmentRoutes(d.attachmentStore, { resolveWriteBackend: d.resolveWriteBackend })) },
    { id: "shell.bash", factory: (d) => asRoutes(createBashRoutes(d.store, { enabled: d.bashEnabled })) },
    { id: "extension.manage", factory: (d) => asRoutes(createExtensionRoutes(d.extension)) },
    { id: "host.commands", factory: (d) => asCommands(d.hostCommandHandlers) },
  ];
}
