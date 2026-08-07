/**
 * pi-handler — the singleton `createPiWebHandler` assembly.
 *
 * First call assembles the session dependencies (SessionManager + SessionStore
 * from @blksails/pi-web-server) plus a `createChannel` seam, injects config defaults,
 * and constructs `createPiWebHandler`. The instance is pinned on `globalThis`
 * so it survives Next dev hot-reload and is reused across requests (Req 2.5).
 *
 * In stub-agent mode (config.stubAgent) `createChannel` ignores the resolved
 * spawn spec and spawns the local stub process instead — reusing the entire
 * real channel/session/SSE chain offline with no API key. In real mode the
 * default `createChannel` (rpc-channel + PiRpcProcess on resolved.spawnSpec) is
 * used; provider keys are passed through to the agent process via env.
 *
 * Provider keys are never logged or echoed (Req 3.5).
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { withAgentCompileCache } from "./agent-compile-cache.js";
import { readDesktopScopedConfig, resolveDesktopConfig } from "./desktop-defaults.js";
import {
  createPiWebHandler,
  type PiWebHandler,
  SessionManager,
  InMemorySessionStore,
  PiRpcProcess,
  // e2b 云沙盒传输(spec e2b-sandbox-transport):传输无关会话核心 + e2b adapter + 配置解析。
  PiRpcSession,
  AgentSourceResolver,
  runnerBootstrapPath,
  // 15 个路由能力面工厂已移至 host-assembly/default-capabilities(M3 经 composeCapabilities 装配);
  // 此处不再直接 import。保留下方 resolve*/broadcast* 等辅助(HostDeps 构造仍需)。
  resolveSourceSettingsFromPackageDirs,
  type ResolvedSourceSettings,
  // per-source settings 运行期实时下发(spec source-settings-and-slots,任务 7.2,通道 b)。
  broadcastSettingsChanged,
  createCompositeSourceProvider,
  createScanSourceProvider,
  createRegistrySourceProvider,
  createRegistryHttpSourceProvider,
  // 线上源可运行(spec desktop-online-source-runnable):已装索引 + 解析插件类型。
  createInstalledRegistryIndex,
  type SourceResolverPlugin,
  defaultAgentEntryPath,
  createHostCommandRegistry,
  attachmentStoreConfigFromEnv,
  ATTACHMENT_PROFILE_DISABLED_ENV,
  // 附件拓扑条件透传判定(spec sandbox-baked-agent-image 任务 4.2):e2b 分支按拓扑
  // 本体 backend.kind 判「全远程」,与 attachmentStoreConfigFromEnv 同源同时机解析。
  ATTACHMENT_BACKENDS_ENV,
  parseBackendsEnv,
  resolveSandboxEntry,
  sessionStoreConfigFromEnv,
  // 会话展示元数据索引(spec session-meta-index):本地文件实现 + Workspace 实现 + 端口类型。
  createLocalSessionMetaIndex,
  JsonFileSessionMetaIndex,
  type SessionMetaIndex,
  ConfigCodec,
  // 目录组装服务(spec model-catalog,任务 3.1):chat/image 双命名空间的合并 + 过滤
  // 统一入口。GET /config/models 经 query() 取数(multi-gateway-providers 任务 4.3:
  // 端点合一后唯一的部署级目录端点,原独立的 GET /aigc/models / GET /vision/models
  // 已删除,其能力由 `?input=`/`?output=` 类型筛选覆盖)。
  createModelCatalogService,
  type CatalogQuery,
  // M3 能力面装配(spec host-contract-capability-composition):强制表态引擎 + 冻结名册 + 表态类型。
  composeCapabilities,
  HOST_CAPABILITY_IDS_V1,
  type CapabilityDecision,
  type ResolvedSource,
  type SessionChannel,
  type CreateChannelOpts,
} from "@blksails/pi-web-server";
import type { SessionActivity } from "@blksails/pi-web-protocol";
import {
  resolvePiCliEntry,
  ChildProcessPiCli,
  DEFAULT_ALLOWLIST,
  defaultOnAudit,
  redactReason,
  type AllowlistConfig,
} from "@blksails/pi-web-adapters/extensions/index.js";
import {
  createPiResourceManager,
  createResourceRoutes,
  type ResourceAgentTarget,
} from "@blksails/pi-web-adapters/resources/index.js";
import {
  resolveLlmGatewaySecret,
  resolveAiGatewaySecret,
} from "@blksails/pi-web-adapters/tokens/index.js";
import {
  createDesktopCapabilitiesClient,
  resolveDesktopCapabilitiesUrl,
  deriveCapabilitiesUrlFromEgressBase,
  deriveLoginUrlFromEgressBase,
  createCloudLoginClient,
  createCloudDesktopAuthClient,
  resolveShellToken,
  // auth(desktop-cloud-login,任务 6.1):进程内登录态 + 鉴权注入路由。egress-model-source
  // (引 pi SDK)不在此,由 runner option-mapper 子路径直引。
  AuthSessionState,
} from "@blksails/pi-web-adapters/auth/index.js";
import {
  // LLM 网关 provider 登记表 + secret 解析(HostDeps 构造 gateway.llm 用;路由工厂
  // createLlmGatewayRoutes 已移至 host-assembly/default-capabilities)。
  resolveLlmGatewayProviderTable,
} from "@blksails/pi-web-adapters/llm-gateway/index.js";
import {
  // ai-gateway 专属 provider 套件(spec ai-gateway-providers,任务 4.1):config 解析 +
  // 主对话转发路由 + Key 解析器 + 模型目录聚合,与 llm-gateway 分离共存,未配置
  // AI_GATEWAY_BASE_URL 时零注册(Req 1.1/1.2)。
  // 多实例装配(spec multi-gateway-providers 任务 3.6,Req 1.1/1.3):`aiGwConfig`(单实例
  // 形态)仅保留用于 modelPrecedence 这一**全局**(非按实例)旋钮与 e2b 分支(任务 3.6
  // 边界外,沿用缺省实例);部署级目录、路由挂载表、本地会话 spawn env 一律改由
  // `resolveGatewayInstances` 的实例集合构造。
  resolveAiGatewayConfig,
  resolveGatewayInstances,
  createGatewayCatalogs,
  InstanceEnvKeyResolver,
  DEFAULT_GATEWAY_INSTANCE_ID,
  instanceEnvPrefix,
  mergeModelCatalog,
  type GatewayModelEntry,
  type GatewayInstanceConfig,
} from "@blksails/pi-web-adapters/ai-gateway/index.js";
import { createDesktopPasswordIdentityProvider } from "@blksails/pi-web-adapters/identity/index.js";
import {
  E2bTransport,
  SandboxWsTransport,
  selectTransport,
  // 按 source 的三级沙箱模板解析(spec sandbox-baked-agent-image):map→派生→全局→清晰错误。
  resolveSandboxTemplate,
} from "@blksails/pi-web-adapters/sandbox-transport/index.js";
import { loggingConfigSchema, type LoggingConfig } from "@blksails/pi-web-protocol";
import {
  configureFileOutputFromEnv,
  configureLogger,
  createLogger,
} from "@blksails/pi-web-logger";
// trust 策略经子路径导入(不走 barrel),使 Next serverExternalPackages 对 pi SDK 的
// external 正确生效,避免 pi SDK/pi-ai 被打进路由 bundle(node:fs 解析失败)。
import { makeProjectTrustPolicy } from "@blksails/pi-web-server/trust";
// M3 默认能力面清单 + 装配依赖类型:经独立子路径出口(D0),绝不并入主 barrel
// (其 factory import 真实工厂含 pi SDK,进主 barrel 会拖垮 routes bundle 的 node:fs)。
import {
  defaultCapabilities,
  type HostContribution,
  type HostDeps,
} from "@blksails/pi-web-server/host-assembly";
import { resolveBashEnabled } from "./bash-default.js";
// listModelOptions 同理走子路径(它 import pi SDK,用于 settings 的 provider/model 下拉)。
// parseHiddenProviders 为纯函数,经同一子路径转出,用于按 PI_WEB_HIDE_PROVIDERS
// 部署期开关从下拉中剔除指定 provider 的模型(过滤本体已收进 ModelCatalogService)。
import {
  listModelOptions,
  parseHiddenProviders,
} from "@blksails/pi-web-server/model-options";
// 自定义 provider 部署级注册表装配(spec multi-gateway-providers,任务 5.3 修复轮,
// Req 7.2/7.5):经 host-assembly 子路径转出(D0 同惯例) —— 根 package.json 只依赖
// @blksails/pi-web-server,无法 deep-import core 的子路径;custom-provider-source.ts
// 走 fs IO,不允许并入零 IO 的 core/server 主 barrel。
import { createCustomProviderRegistry } from "@blksails/pi-web-server/host-assembly/custom-providers.js";
// 图像模型静态目录(self + 网关)经 tool-kit **主入口**(零 pi SDK、零 env 读取,前端安全):
// 供 ModelCatalogService 的 image 命名空间组装(spec model-catalog,任务 3.1)。
import {
  AIGC_MODEL_CATALOG,
  AI_GATEWAY_AIGC_CATALOG,
  CLOUDFLARE_AIGC_CATALOG,
  isCloudflareConfiguredAtRuntime,
  cloudflareSpawnEnvFragment,
} from "@blksails/pi-web-tool-kit";
import type { SpawnSpec } from "@blksails/pi-web-protocol";
import { loadConfig, type AppConfig } from "./config.js";
import { readyTimeoutFromEnv } from "./readiness-config.js";
// LLM 网关凭据切换决策(spec sandbox-credentials-v2,任务 3.3):e2b 分支的
// providerKeysForE2b/sandboxLlmEnv 计算抽成纯函数,便于脱离真实传输单测。
import {
  computeE2bProviderEnv,
  deprecatedAigcProxyWarning,
} from "./llm-gateway-assembly.js";
// ai-gateway 会话 token 注入决策(spec ai-gateway-providers,design.md §2.5,任务 4.1;
// 路由/scope 按实例分流见 spec multi-gateway-providers 任务 3.4,Req 1.3):e2b 分支按
// 会话铸造 scope="ai-gateway:<instance>" token,注入沙箱可达 base + token(增量可选,
// 不替换任何既有 provider key,与 llm-gateway 的强制 credential-switch 语义不同)。
import { computeAiGatewaySessionEnv } from "./ai-gateway-assembly.js";
// spec ai-gateway-session-models(任务 2.2):本地分支的网关会话模型下发;多实例序列化见
// spec multi-gateway-providers 任务 3.6(Req 1.1/1.3)。
import { computeAiGatewaySessionsSpawnEnv } from "./ai-gateway-session-assembly.js";
// ai-gateway-catalog-coldstart(任务 2.2):会话侧模型清单反向拉取的宿主应答。
import { makeGatewayModelsResolver } from "./ai-gateway-models-resolver.js";
import {
  resolveCloudLoginConfig,
  readDesktopScopedCloudEgressBase,
  computeEgressSpawnEnvFromGrant,
  RUNNER_CREDENTIAL_ENV,
} from "./auth-egress-assembly.js";
// 会话 token TTL 兜底(config.llmGateway 未配置时,ai-gateway token 生命周期仍需一个
// 保守默认值——沿用 llm-gateway 同一常量,语义详见 llm-gateway-config.ts 注释)。
import { DEFAULT_SANDBOX_TIMEOUT_MS } from "./llm-gateway-config.js";
// 随包固化的云端默认接入地址(仅桌面壳生效;见该文件顶部三条约束)。
import { resolveBakedCloudEgressBase } from "./cloud-defaults.js";
// 扩展管理扩展文件路径解析(纯路径模块,不拉 pi SDK,安全进 Next bundle):
// spec extension-install-agent-tools —— 经 spawn env 下发给 agent 子进程强制注入。
// 自动会话标题扩展文件路径解析(同样为纯路径模块,不拉 pi SDK):spec auto-session-title ——
// 总开关 PI_WEB_AUTO_TITLE 开启(默认)时经 spawn env 下发给 agent 子进程强制注入。
import { createClearHostCommand } from "./clear-host-command.js";
import {
  createPackageHostCommand,
  type InstallAuditEvent,
  type PackageHostCommandDeps,
} from "./package-host-command.js";
import { createInstaller } from "../../server/cli/install/installer.js";
import { ensurePublishKey } from "../../server/cli/publish/keystore.js";
import { ensurePublishKeyRegistered, isKeyInPlace } from "./publish-key-registration.js";
import { executePublish } from "./publish-execute.js";
import { createPluginInstaller } from "../../server/cli/install/plugin-installer.js";
import { resolveSourcesRoot } from "../../server/cli/context.js";
// 线上源可运行(spec desktop-online-source-runnable,任务 3.1/3.2):安装端口与解析插件。
// 二者位于应用层而非 packages/server —— 它们经 server/cli 间接依赖 @pi-clouds/registry-client,
// 而 P1 的范围铁律要求该依赖不得进入包内(判别与索引已下沉包内,纯 fs)。
import { createRegistryInstallPort } from "./online-source/registry-install-port.js";
import { createLazyRegistryChannel } from "./online-source/registry-channel-adapter.js";
import { createRegistrySourceResolver } from "./online-source/registry-source-resolver.js";
import {
  resolveEnabledWithSource,
  resolveLoggingEnvDefault,
} from "./logging-default.js";
import { makeResumeMetaLoader } from "./resume-meta.js";
// 会话事件 store 工厂(启动时 prune 元数据索引残留用;与冷恢复 / 列表同源)。
import { createSessionEntryStore } from "@blksails/pi-web-adapters/session-store-postgres/index.js";
import { systemResourceArgs } from "./system-resource-args.js";
import { resolveBuiltinPromptTemplatePaths } from "@blksails/pi-web-server/builtin-prompt-paths.js";

/**
 * Real-mode resolver wrapper.
 *
 * `create-session` only forwards `{ cwd }` to `resolver.resolve`. The REAL
 * spawn requires `runnerEntry` (the cwd-independent bootstrap) and `piCliEntry`
 * (the pi CLI bin), or `assemble` throws (custom mode used a placeholder runner
 * path that crashed instantly → onClosed → store.delete → 404 on :id routes).
 *
 * This wrapper anchors those entries so resolved spawn specs point at real,
 * cwd-independent module-resolution roots. `agentDir` is threaded through when
 * the app pins an isolated PI_CODING_AGENT_DIR.
 */
function makeRealResolver(
  config: AppConfig,
  /**
   * 线上源解析插件(spec desktop-online-source-runnable,任务 4.1)。
   *
   * 经 `ResolveOptions.sourceResolver` 送进 `identify()`,其判别优先于 builtin/git/本地目录。
   * 仅在云登录与能力端点均已配置时由装配处传入;缺省不传 → 解析链路与本特性引入前完全一致
   * (Req 8.2)。`create-session` 的新建与恢复两条路径共用本 wrapper,故一处接入即全覆盖。
   */
  sourceResolver?: SourceResolverPlugin,
): {
  resolve: (
    source: string | undefined,
    opts?: { cwd?: string; trust?: boolean },
  ) => Promise<ResolvedSource>;
} {
  const runnerEntry = runnerBootstrapPath();
  const piCliEntry = resolvePiCliEntry();
  const builtinPromptTemplatePaths = resolveBuiltinPromptTemplatePaths();
  // Pin the pi config dir so the agent process reads ~/.pi/agent/auth.json
  // (credentials from `pi` login) and settings.json (default provider/model,
  // installed packages). assemble-spawn writes this as PI_CODING_AGENT_DIR last,
  // so it cannot be shadowed by baseEnv/trust fragments.
  const agentDir = config.agentDir;
  // The agent-source module never reads process.env itself (Req 7.x); it builds
  // spawnSpec.env solely from baseEnv + env + trust fragment. The spawned child
  // therefore needs the host environment threaded in as baseEnv — without PATH
  // the OS cannot even locate `node`, and the child fails to spawn (exit
  // code:null/signal:null with no stderr) → onClosed → session deleted → 404.
  // 首次 custom agent 启动时由 Node 生成 V8 编译缓存；后续 runner 进程直接复用。
  // 显式 NODE_COMPILE_CACHE / NODE_DISABLE_COMPILE_CACHE 保持最高优先级。
  const baseEnv = withAgentCompileCache(process.env, os.homedir());
  // 项目信任策略(C-P1/C-P4):复用 pi 的 ProjectTrustStore(同一 agentDir),叠加 trustedRoots。
  // 决定 custom 模式是否向 runner 传放行信号 → SDK 才加载工作目录下的项目级 `.pi/`
  // (扩展/子代理/技能)。仅值导入被 Next serverExternalPackages 外置的 SDK,不打进 bundle。
  //
  // 默认信任 app 所服务的项目根(`config.defaultCwd` = PI_WEB_DEFAULT_CWD ?? process.cwd())
  // 及其子树:运行 pi-web 即隐含信任你所服务的项目(其 agent 代码本就在子进程执行),使
  // 仓库内 `.pi/`(含 examples/* 示例)开箱即加载。可经 PI_WEB_TRUST_DEFAULT_CWD=false 关闭;
  // 外部 git/任意路径源不在该子树内,仍默认不信任(secure-by-default 仍成立)。
  // 额外受信根经 PI_WEB_TRUSTED_ROOTS(路径分隔符分隔)叠加。
  const trustDefaultCwd = process.env.PI_WEB_TRUST_DEFAULT_CWD !== "false";
  const trustedRoots = [
    ...(trustDefaultCwd ? [config.defaultCwd] : []),
    ...(process.env.PI_WEB_TRUSTED_ROOTS ?? "")
      .split(path.delimiter)
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  ];
  const trustPolicy = makeProjectTrustPolicy({
    ...(agentDir !== undefined ? { agentDir } : {}),
    trustedRoots,
  });
  return {
    resolve: async (source, opts) => {
      const cwd = opts?.cwd ?? config.defaultCwd;
      // 「扩展」面板开关:关闭系统 skills/extensions → 注入 --no-skills/--no-extensions。
      // 项目级开关须读 **agent source 自身目录** 的 .pi/settings.json(本地目录源即项目根,
      // 与 runner 资源发现的 cwd 一致),否则被 handler defaultCwd 遮蔽 → per-source
      // loadSystemSkills 覆盖失效(plugin-system-unification R12 Fix#1)。git/cli 源回退 cwd。
      let resourceCwd = cwd;
      if (typeof source === "string" && source.length > 0) {
        try {
          const abs = path.resolve(cwd, source);
          if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) resourceCwd = abs;
        } catch {
          // 解析失败(非本地路径/权限)→ 保持 cwd。
        }
      }
      const extraArgs = await systemResourceArgs(agentDir, resourceCwd);
      const resolved = await AgentSourceResolver.resolve(source, {
        cwd,
        runnerEntry,
        piCliEntry,
        agentDir,
        baseEnv,
        trustPolicy,
        // DTO `trust` → 显式信任意图;缺省时由 trustPolicy(信任库/trustedRoots/默认)决定。
        ...(opts?.trust !== undefined ? { requestTrust: opts.trust } : {}),
        ...(extraArgs.length > 0 ? { extraArgs } : {}),
        ...(sourceResolver !== undefined ? { sourceResolver } : {}),
      });
      // CLI 型 Agent 不经过 runner 的 SDK 资源映射，显式加载全局内置模板。
      // 自定义 Agent 已由 runner 注入；E2B 传输不消费宿主 spawn args，故不在此伪注入。
      if (resolved.mode === "cli" && builtinPromptTemplatePaths.length > 0) {
        return {
          ...resolved,
          spawnSpec: {
            ...resolved.spawnSpec,
            args: [
              ...resolved.spawnSpec.args,
              ...builtinPromptTemplatePaths.flatMap((templatePath) => [
                "--prompt-template",
                templatePath,
              ]),
            ],
          },
        };
      }
      return resolved;
    },
  };
}

/**
 * agent source 的默认安装/发现根。与 pi 的配置目录(`PI_WEB_AGENT_DIR`,默认 `~/.pi/agent`,
 * 存 settings/auth/attachments)分属两个目录族:那里是 **pi 的资产**,这里是 **pi-web 的资产**。
 * `pi-web install` 装 `kind:"agent"` 的包时落于此(plugin 则交 DefaultPackageManager 落 `~/.pi/agent`)。
 */
function defaultSourcesRoot(): string {
  return path.join(os.homedir(), ".pi-web", "agents");
}

/** Agent 资源编辑元数据:发布者/管理者由 agent 清单声明，服务端仅以 userId 判权。 */
function readAgentResourceAccess(agentRoot: string): {
  readonly publisherId?: string;
  readonly managerIds: readonly string[];
} {
  const candidates = [path.join(agentRoot, "pi-web.json"), path.join(agentRoot, "package.json")];
  for (const file of candidates) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      if (typeof parsed !== "object" || parsed === null) continue;
      const root = parsed as Record<string, unknown>;
      const nested =
        typeof root["pi-web"] === "object" && root["pi-web"] !== null
          ? (root["pi-web"] as Record<string, unknown>)
          : undefined;
      const access =
        typeof root.resourceAccess === "object" && root.resourceAccess !== null
          ? (root.resourceAccess as Record<string, unknown>)
          : nested !== undefined &&
              typeof nested.resourceAccess === "object" &&
              nested.resourceAccess !== null
            ? (nested.resourceAccess as Record<string, unknown>)
            : undefined;
      if (access === undefined) continue;
      const publisherId =
        typeof access.publisherId === "string" && access.publisherId.trim().length > 0
          ? access.publisherId.trim()
          : undefined;
      const managerIds = Array.isArray(access.managerIds)
        ? access.managerIds.filter(
            (id): id is string => typeof id === "string" && id.trim().length > 0,
          ).map((id) => id.trim())
        : [];
      return { ...(publisherId !== undefined ? { publisherId } : {}), managerIds };
    } catch {
      // 清单不存在/损坏时不授予 Agent 编辑权，仍可浏览或复制到个人级。
    }
  }
  return { managerIds: [] };
}

function resolveLocalAgentTarget(
  record: {
    readonly id: string;
    readonly source: string;
    readonly name: string;
    readonly kind: string;
  },
): ResourceAgentTarget | undefined {
  if (record.kind !== "dir") return undefined;
  const candidate = path.isAbsolute(record.id)
    ? record.id
    : path.isAbsolute(record.source)
      ? record.source
      : undefined;
  if (candidate === undefined || !fs.existsSync(candidate)) return undefined;
  try {
    if (!fs.statSync(candidate).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  const access = readAgentResourceAccess(candidate);
  return {
    id: record.id,
    name: record.name,
    root: path.resolve(candidate),
    ...(access.publisherId !== undefined ? { publisherId: access.publisherId } : {}),
    ...(access.managerIds.length > 0 ? { managerIds: access.managerIds } : {}),
  };
}

/**
 * agent-sources-list:解析 PI_WEB_SOURCES_ROOT 为绝对扫描根列表。
 * path.delimiter(: / ;)分隔多个;相对路径以 defaultCwd 绝对化;去空段。
 *
 * 未配 → 回落 `~/.pi-web/agents`(单元素)。显式配置**完全接管**(覆盖而非追加),保持既有语义。
 * 回落无需区分 dev/prod:`ScanSourceProvider` 的契约是「root 不存在/无法解析 → 跳过该 root」,
 * 故目录不存在时静默产出空列表,与改动前的 `[]` 行为一致。
 */
function resolveSourcesScanRoots(
  defaultCwd: string,
  /** 配置目录;用于读 desktop 域的 sourcesRoot(仅桌面壳生效)。 */
  agentDir?: string,
): readonly string[] {
  const raw = process.env.PI_WEB_SOURCES_ROOT;
  if (raw !== undefined && raw.trim().length > 0) {
    return raw
      .split(path.delimiter)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => (path.isAbsolute(s) ? s : path.resolve(defaultCwd, s)));
  }
  // env 未表态 → 看 desktop 域(桌面用户在设置里指定的扫描目录)。仅桌面壳生效:
  // `~/.pi/agent` 是壳与 dev/CLI 共用目录,无条件读会让后两者跟着改扫描位置。
  const desktopRoot = resolveDesktopConfig({
    env: process.env,
    userConfig: readDesktopScopedConfig(agentDir, process.env),
  }).sourcesRoot;
  if (desktopRoot !== undefined) {
    return [absolutizeScanRoot(desktopRoot, defaultCwd)];
  }
  return [defaultSourcesRoot()];
}

/** 扫描根绝对化:展开前导 `~`(用户在设置面板里更可能写 `~/agents` 而非绝对路径),再按 cwd 解析。 */
function absolutizeScanRoot(raw: string, defaultCwd: string): string {
  const expanded = raw === "~" || raw.startsWith("~/")
    ? path.join(os.homedir(), raw.slice(1))
    : raw;
  return path.isAbsolute(expanded) ? expanded : path.resolve(defaultCwd, expanded);
}

/** `PI_WEB_SOURCES_REGISTRY` 解析:显式配置优先,回退 `<agentDir>/sources.json`
 * (与 `createAgentSourcesRoutes` 挂载处的同名表达式保持一致,见下方调用点)。 */
function sourcesRegistryPath(config: AppConfig): string {
  return process.env.PI_WEB_SOURCES_REGISTRY ?? path.join(config.agentDir, "sources.json");
}

/**
 * per-source settings 生产 `resolveSettings` 接线(补task 2.3,替换任务 2.2 遗留的
 * `() => Promise.resolve(undefined)` 占位实现)。
 *
 * 候选包根目录集合(sourceKey 输入恒为 `descriptor.id`,与装配期注入
 * `runner/source-settings-assembly-wiring.ts` 使用同一 `resolvePiPlugin` → `descriptor.id`
 * 管线,保证同一 source 在 HTTP 端点与装配期解析出同一 sourceKey,拍板 Q2):
 *  - `config.defaultCwd` —— 未显式指定 source 时的隐式激活 agent(`agent-source/resolver.ts`
 *    的 `identify()` "default" 分支把 cwd 本身当作该次会话的 source);
 *  - 内置 default-agent 的入口目录(`builtin:default-agent`,`defaultAgentEntryPath()`);
 *  - 「已安装/已登记的本地目录源」——与 `GET /agent-sources`(任务见上方 `createAgentSourcesRoutes`
 *    挂载点)同一路 provider 组合(注册表 ∪ 扫描根),过滤 `kind==="dir"`:git 源需 clone 才能
 *    拿到本地包根,不在本次接线范围,查不到 settings 时降级为 404(与「该 source 未声明
 *    settings」同一对外语义,不额外泄露信息)。
 *
 * 每次请求重新枚举、不缓存:量级是「本地目录数」,枚举失败 best-effort 降级(不阻断
 * default/builtin 两个基本候选)——先正确后快,缓存留给后续任务按需补。
 */
function makeSourceSettingsResolver(
  config: AppConfig,
): (sourceKeyValue: string) => Promise<ResolvedSourceSettings | undefined> {
  const provider = createCompositeSourceProvider(
    createRegistrySourceProvider({ registryPath: sourcesRegistryPath(config) }),
    createScanSourceProvider({ roots: resolveSourcesScanRoots(config.defaultCwd, config.agentDir) }),
  );

  return async (sourceKeyValue: string): Promise<ResolvedSourceSettings | undefined> => {
    const packageDirs = new Set<string>([config.defaultCwd]);
    const builtinEntry = defaultAgentEntryPath();
    if (builtinEntry !== undefined) packageDirs.add(path.dirname(builtinEntry));
    try {
      const records = await provider.list();
      for (const record of records) {
        if (record.kind === "dir") packageDirs.add(record.source);
      }
    } catch {
      // best-effort:枚举失败(扫描根/注册表读取异常)不阻断 default/builtin 两个基本候选。
    }
    return resolveSourceSettingsFromPackageDirs([...packageDirs], sourceKeyValue);
  };
}

/**
 * Absolute path to the stub agent script. Resolved from the project root
 * (`process.cwd()`, where the Next server runs) so it is stable regardless of
 * how this module is bundled. Overridable via PI_WEB_STUB_AGENT_PATH.
 */
function stubAgentPath(): string {
  const override = process.env.PI_WEB_STUB_AGENT_PATH;
  if (override !== undefined && override !== "") {
    // Resolve against the project root (`process.cwd()`, where the Next server
    // runs) so a RELATIVE override works regardless of the stub's spawn cwd
    // (= the `@blksails/pi-web-server` package dir). `path.resolve` passes an absolute
    // override through unchanged.
    return path.resolve(process.cwd(), override);
  }
  return path.join(process.cwd(), "lib", "app", "stub-agent-process.mjs");
}

/**
 * Attachment spawn-env passthrough (attachment-store, Req 7.3/7.4).
 *
 * Build the env entries the main process downstreams to a session child so a
 * FUTURE runner child can share the SAME local backend: the storage-dir
 * convention `PI_WEB_ATTACHMENT_DIR` AND the signing secret
 * `PI_WEB_ATTACHMENT_SECRET`. Both values are taken from the MAIN-process
 * attachment store config (`attachmentStoreConfigFromEnv()`'s `dir`/`secret`),
 * NOT recomputed — so the child points at the same directory and holds the same
 * HMAC secret (otherwise a child-produced tool-output `/raw` signed URL would
 * 401 in the main process).
 *
 * This slice ONLY downstreams the convention + secret. It does NOT instantiate
 * a store in the child nor do any cross-process resolve — that is owned by the
 * downstream `attachment-tool-bridge` spec, which must not edit this passthrough
 * (it only verifies the child received both vars). The secret is never logged.
 *
 * `passthroughEnv` (attachment-backend-pluggable spec, Req 6.1) is merged in last:
 * when a multi-backend topology (`PI_WEB_ATTACHMENT_BACKENDS`) is configured, the
 * config factory computes the topology raw text plus every referenced credential
 * env var it references, so the child can rebuild the SAME union backend. Empty
 * object when no topology is configured — zero behavior change for single-backend
 * deployments (still just DIR + SECRET + URL_BASE above).
 */
function attachmentSpawnEnv(
  attachment: { dir: string; secret: string },
  passthroughEnv: Record<string, string> = {},
  // agent-attachment-profile 关断开关(Req 5.1/5.2):调用方传入**装配期捕获一次**的值
  // (而非在此处现读 `process.env`),使主/子两侧关断读取收敛到同一次判定、同一来源
  // (research.md「关断的读取位置」决策;避免请求处理期 env 漂移导致主/子不同步)。
  // 未设置时不注入该键(子进程按未关断默认)。
  attachmentProfileDisabledValue?: string,
): Record<string, string> {
  return {
    PI_WEB_ATTACHMENT_DIR: attachment.dir,
    PI_WEB_ATTACHMENT_SECRET: attachment.secret,
    // 分发 URL base path:子进程产出的 tool-output 签名 URL 需带 app 挂载前缀 `/api`
    // 才直接可达(与主进程一致;否则前端取该签名 URL 会 404)。
    PI_WEB_ATTACHMENT_URL_BASE: "/api",
    ...(attachmentProfileDisabledValue !== undefined
      ? { [ATTACHMENT_PROFILE_DISABLED_ENV]: attachmentProfileDisabledValue }
      : {}),
    ...passthroughEnv,
  };
}

interface HandlerSingleton {
  readonly handler: PiWebHandler;
  readonly manager: SessionManager;
}

const GLOBAL_KEY = Symbol.for("pi-web.app.handler");

type GlobalWithHandler = typeof globalThis & {
  [GLOBAL_KEY]?: HandlerSingleton;
};

/**
 * Build the stub spawn spec (local node + stub script), inheriting env.
 *
 * Stub 先以 plain Node 应答 readiness，再在进程内惰性启 Jiti 导入 TS-source
 * `@blksails/pi-web-server`，使冷编译不占用宿主 readiness 时限。
 * Session identity + creation metadata are passed via `PI_WEB_STUB_*` env so the
 * stub aligns its persisted session id with the host sessionId and can cold-resume.
 * `SESSION_STORE*` is already inherited from `process.env`.
 */
function stubSpawnSpec(
  config: AppConfig,
  opts: CreateChannelOpts,
  sessionCwd: string,
  attachment: { dir: string; secret: string },
  attachmentPassthroughEnv: Record<string, string> = {},
  attachmentProfileDisabledValue?: string,
): SpawnSpec {
  // cwd 保持 @blksails/pi-web-server 包目录，供 stub 的 programmatic Jiti
  // 解析该包自带依赖与 TS source。会话 cwd 另经 PI_WEB_STUB_CWD 传入。
  const serverPkgDir = path.dirname(runnerBootstrapPath());
  return {
    cmd: process.execPath,
    args: [stubAgentPath()],
    cwd: serverPkgDir,
    env: {
      ...process.env,
      ...config.providerKeys,
      // 附件目录约定 + 签名 secret 经 spawn env 下发(Req 7.3/7.4),取自主进程 store
      // 配置,保证主/子进程一致;最后写入,防止被 process.env 既有同名变量遮蔽。
      ...attachmentSpawnEnv(
        attachment,
        attachmentPassthroughEnv,
        attachmentProfileDisabledValue,
      ),
      PI_WEB_STUB_SESSION_ID: opts.sessionId,
      PI_WEB_STUB_CWD: sessionCwd,
      ...(opts.source !== undefined ? { PI_WEB_STUB_SOURCE: opts.source } : {}),
      ...(opts.model !== undefined ? { PI_WEB_STUB_MODEL: opts.model } : {}),
    } as Record<string, string>,
  };
}

// LLM 网关(spec sandbox-credentials-v2,Req 4.2):aigc-proxy 摘除后的废弃 env 告警,
// 命名空间 "app:llm-gateway" 便于检索;每次会话创建(createChannel 调用一次)记一次即可,
// 不需要跨会话去重。
const llmGatewayLogger = createLogger({ namespace: "app:llm-gateway" });

/**
 * 同步解析某网关实例的凭据(spec multi-gateway-providers 任务 3.6,Req 1.5)。
 *
 * spawn spec 的构造是**同步**路径(`createChannel` 非 async),故不能走 `KeyResolver`
 * 的 `resolve()`(异步接口)——本函数按与 {@link InstanceEnvKeyResolver} 逐字节一致的
 * 规则同步读取:先认该实例自己的 `<prefix>API_KEY`;若为缺省实例
 * ({@link DEFAULT_GATEWAY_INSTANCE_ID})且自身未配置,再回落两个存量全局凭据名
 * (新名优先、旧名回落)。显式声明的实例(经 `PI_WEB_GATEWAYS` 列出)不做任何回落,
 * 避免两个实例意外共享同一把全局 key。
 */
function resolveGatewayInstanceApiKeySync(
  instance: GatewayInstanceConfig,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const own = env[`${instanceEnvPrefix(instance.id)}API_KEY`]?.trim();
  if (own !== undefined && own.length > 0) return own;
  if (instance.id !== DEFAULT_GATEWAY_INSTANCE_ID) return undefined;
  const legacy = env.BLKSAILS_GATEWAY_API_KEY?.trim() || env.AI_GATEWAY_API_KEY?.trim();
  return legacy !== undefined && legacy.length > 0 ? legacy : undefined;
}

// M3 能力面装配日志(spec host-contract-capability-composition,D7):onDecline 时把弃用
// id + reason 记入启动日志(契约 §5.2)。pi-web 本地对 16 id 全 use 故不触发;为两端 decline 而设。
const hostAssemblyLogger = createLogger({ namespace: "server:host-assembly" });

function buildSingleton(): HandlerSingleton {
  const config = loadConfig();

  // ai-gateway 套件装配期配置解析(spec ai-gateway-providers,design.md §2.5,任务 4.1,
  // Req 1.1/1.2/1.4):未配置 AI_GATEWAY_BASE_URL → undefined(套件整体不注册);非法配置
  // (URL/优先级枚举/TTL 覆盖值)→ fail-fast 抛出(不吞错、不静默降级)。
  // ★多实例接线(spec multi-gateway-providers 任务 3.6,Req 1.1/1.3)后,`aiGwConfig` 只
  //   还剩两个用途:①`modelPrecedence`(全局旋钮,不按实例区分,`GatewayInstanceConfig`
  //   本无此字段);②e2b 分支(`computeAiGatewaySessionEnv`,任务 3.6 边界外——沙箱内
  //   多网关路由留待后续任务,本轮沿用缺省实例)。**不再**用它判定套件是否启用、
  //   取 baseUrl/timeoutMs/providerAllowlist——那些一律改由下面的 `gatewayInstances`
  //   逐实例给出。
  const aiGwConfig = resolveAiGatewayConfig(process.env);

  // 多网关实例装配(spec multi-gateway-providers 任务 3.1/3.3/3.6,
  // Req 1.1/1.2/1.3/1.5/1.6):`PI_WEB_GATEWAYS` 显式列出 → 按实例解析;仅有存量单实例
  // 变量 → 合成一个标识沿用 `AI_GATEWAY_PROVIDER_NAME` 的缺省实例,行为与改造前逐字节
  // 一致;都未配置 → 空数组(套件整体不注册)。每个实例各自持有独立的
  // `GatewayModelCatalog`(独立目录快照 / TTL / fail-soft)与独立的
  // `InstanceEnvKeyResolver`(独立凭据解析)——一个实例拉取失败或凭据缺失只影响其
  // 自身,不牵连其余实例与本地模型(Req 1.5)。
  const gatewayInstances = resolveGatewayInstances(process.env);
  const gatewayEnabled = gatewayInstances.length > 0;
  const gatewayCatalogs = createGatewayCatalogs(gatewayInstances);
  // 目录服务 / 路由挂载表 / 本地会话 spawn env 三处消费方共用**同一份**按实例聚合的读数
  // (design.md「三处目录装配点合一」):逐实例取其 `GatewayModelCatalog.get()` 快照后拼接,
  // 与 `mergeModelCatalog`(任务 3.2)按 `entry.instanceId` 归属 provider 的语义配套。
  const gatewayChatAggregate = gatewayEnabled
    ? {
        get: (): readonly GatewayModelEntry[] =>
          gatewayInstances.flatMap((inst) => gatewayCatalogs.get(inst.id)?.get() ?? []),
      }
    : undefined;

  // desktop-cloud-login(任务 6.1,Req 3.1/4.2/7.3):云端登录 egress 装配期配置解析。未配
  // PI_WEB_CLOUD_LOGIN_EGRESS_BASE → undefined(功能关闭、无登录入口,行为与今日一致);非法
  // → fail-fast 抛出。进程内登录态由启动 env(桌面壳经 base_env 播种 PI_WEB_DESKTOP_CREDENTIAL)
  // 初始化,鉴权端点运行时更新;会话 spawn 读同一实例注入 runner egress env。
  // env 优先、回落 `<agentDir>/cloud.json`(spec desktop-cloud-login Req 8)。
  // 没有回落时打包桌面版永远启用不了登录:壳不转发 env、Finder 无 shell 环境、
  // `.env` 落在会被 GC 的运行时目录 —— 实测表现为 /api/auth/me 404、登录入口不渲染。
  // 三级次序:env 显式值 > 用户 `<agentDir>/cloud.json`(仅桌面壳) > 随包固化默认值(仅桌面壳)。
  // 固化值排最后,故用户在设置面板改过的地址永远压得住它 —— 反过来会让「改了保存也没用」
  // 这种静默失效发生(spec desktop-account-login Req 11)。
  // ★ 后两级都只对桌面壳生效:`<agentDir>` 默认 `~/.pi/agent/` 被桌面壳与 `pnpm dev`/npm CLI
  //   共用,桌面版登录写下的 cloud.json 曾因此让 dev 也撞上登录门禁(实测,见
  //   readDesktopScopedCloudEgressBase 的文件内说明)。env 显式值仍对所有宿主有效。
  const cloudLoginConfig = resolveCloudLoginConfig(
    process.env,
    readDesktopScopedCloudEgressBase(config.agentDir, process.env) ??
      resolveBakedCloudEgressBase(process.env),
  );
  const authSessionState = new AuthSessionState();
  if (cloudLoginConfig !== undefined) {
    const seededCredential = process.env[RUNNER_CREDENTIAL_ENV];
    if (seededCredential !== undefined && seededCredential.trim().length > 0) {
      // 播种失败(非法/过期)静默忽略——保持未登录态,不阻断装配。
      authSessionState.set(seededCredential);
    }
  }
  // 目录组装服务(spec model-catalog,design.md「ModelCatalogService」,任务 3.1,
  // Req 1.1/4.1/4.3/5.1–5.4):chat(merge + hidden 过滤)与 image(静态∪网关,附 source)
  // 的统一取数入口。**每请求构造**以保持 PI_WEB_HIDE_PROVIDERS 的既有请求期求值语义
  // (原闭包即每请求 parseHiddenProviders,env 即时生效;service 零 IO 轻对象,每请求
  // new 无成本)。网关启用判别 = `gatewayEnabled`(spec multi-gateway-providers 任务 3.6:
  // 至少有一个网关实例被解析出来,不再单看 `AI_GATEWAY_BASE_URL` 这一个 env),
  // 与路由挂载/runner 侧判据同源;未启用时 gatewayChat/gatewayImageCatalog 均不注入,
  // 两端点输出与主干逐字节一致(Req 1.3/4.3)。
  const makeModelCatalog = () =>
    createModelCatalogService({
      listSelfChat: () => listModelOptions(config.agentDir),
      gatewayChat: gatewayChatAggregate,
      // 合并能力由装配层注入(spec: core-package-extraction 任务 3.1)。目录服务属内核层,
      // 不认识 ai-gateway 适配器;它与 gatewayChat 同进同出,漏传会当场抛错而非静默降级。
      mergeCatalog: mergeModelCatalog,
      modelPrecedence: aiGwConfig?.modelPrecedence,
      imageCatalog: AIGC_MODEL_CATALOG,
      gatewayImageCatalog: gatewayEnabled ? AI_GATEWAY_AIGC_CATALOG : undefined,
      // Cloudflare 图像目录(spec cloudflare-aigc-provider,Req 4.2):启用判据用的是
      // 与 runner 侧 aigcExtension **同一个** isCloudflareConfiguredAtRuntime
      // (env + `<agentDir>/aigc.json` 每次 re-read),两处判据不会漂移。
      cloudflareImageCatalog: isCloudflareConfiguredAtRuntime({
        env: process.env,
        agentDir: config.agentDir,
      })
        ? CLOUDFLARE_AIGC_CATALOG
        : undefined,
      hiddenProviders: parseHiddenProviders(process.env.PI_WEB_HIDE_PROVIDERS),
      // 自定义 provider(spec multi-gateway-providers,任务 5.3 修复轮,Req 7.2/7.5):
      // 每请求重新组装(与本函数其余依赖同惯例) —— `createCustomProviderSource().list()`
      // 每次调用重新读 `<agentDir>/providers.json`,使新增/停用免重启即时生效。
      customProviders: createCustomProviderRegistry(config.agentDir),
    });

  // 主进程自身 logger 的 runtime 门控:主进程不像 runner 那样调 initConfigFromEnv,
  // 库默认 enabled=true 会让 server 侧 createLogger(pi-session 等)无条件打到 server stderr。
  // 在此按同一 env 默认(PI_WEB_LOG_*,默认关)对齐,避免未开日志时刷终端;PI_WEB_LOG_ENABLED=1
  // 时主进程与 runner 同步开启。(注:此为主进程自身日志门控,runner 日志→UI 仍由
  // loggingConfigProvider/gateConfig 单独控制。)
  configureLogger(resolveLoggingEnvDefault());
  // ★ 文件输出必须在此**单独**配一次:`configureLogger` 只管 enabled/level/namespaces,
  //   而文件 sink 装在 `initConfigFromEnv()` 里 —— 主进程刻意不调那个(见上),
  //   于是 `PI_WEB_LOG_FILE` 长期**只在 runner 子进程生效**:日志文件确实被创建、
  //   看着一切正常,里面却没有一行主进程的日志。真机排查发布链时因此完全失明。
  // ★★ 文件 sink 的 `fs` 来自 `globalThis.__PI_WEB_FS__` 接缝 —— logger 包本身**不含任何
  //     `node:` 说明符**(否则浏览器/Next 构建会去解析 Node 内置模块),故必须由 Node-only 的
  //     调用方来填。此前**只有 runner 填过**(`packages/server/src/runner/runner.ts:248`),
  //     主进程从没填 → `getFsRef()` 恒 null → 每次文件写入都是**静默空操作**。
  //
  //     后果:`PI_WEB_LOG_FILE` 看似生效(文件被 runner 创建、内容也在增长),
  //     里面却只有 runner 子进程的行,主进程一条都没有。真机排查发布链时因此完全失明。
  //     ⚠ 只配 `configureFileOutputFromEnv` 是**不够的** —— 两步缺一,文件就是空的。
  //
  //     这里可以同步填(本文件已静态 `import fs from "node:fs"`),不必像 runner 那样 await。
  (globalThis as Record<string, unknown>)["__PI_WEB_FS__"] ??= fs;

  const fileLogEnabled = configureFileOutputFromEnv(process.env);
  // 一条**必定触发**的启动行:没有它,"日志到底通没通"无从判断 ——
  // 主进程在装配期原本一条日志都不记,于是「文件是空的」既可能是没配好、
  // 也可能是压根没事发生,两者无法区分。真机排查发布链时正是卡在这个盲区上
  // (文件确实存在、看着一切正常,里面却只有 runner 子进程的行)。
  hostAssemblyLogger.info("logging configured", {
    level: process.env.PI_WEB_LOG_LEVEL ?? "info",
    file: fileLogEnabled ? process.env.PI_WEB_LOG_FILE : undefined,
  });

  /**
   * 解析日志门控:Settings 原始值 + env 覆盖 + dev/生产默认(优先级见
   * {@link resolveEnabledWithSource})。
   */
  const resolveLoggingGate = async (): Promise<LoggingConfig> => {
    let raw: unknown = null;
    try {
      raw = await new ConfigCodec(config.agentDir).load("logging");
    } catch {
      raw = null; // 读失败按「无配置」处理,继续走 env / 默认。
    }
    const { enabled, source } = resolveEnabledWithSource(raw);
    const base =
      raw !== null && typeof raw === "object" && Object.keys(raw).length > 0
        ? raw
        : resolveLoggingEnvDefault();
    const parsed = loggingConfigSchema.parse(base);
    // ★ enabled 一律以 resolveEnabledWithSource 为准,覆盖 parse 出来的值 ——
    //   否则 env 覆盖与 dev 默认都会被 Settings 里存盘的旧值顶掉。
    const gate = { ...parsed, enabled };
    if (source !== lastLoggingGateSource) {
      lastLoggingGateSource = source;
      // 门控从哪来、值是多少 —— 「日志为什么不显示」的第一现场。必定输出一次。
      hostAssemblyLogger.info("logging gate resolved", {
        enabled,
        level: gate.level,
        source,
      });
    }
    return gate;
  };

  /**
   * 最近一次解析出的日志门控。spawn env 组装是**同步**路径,而门控解析要读配置文件
   * (异步),故缓存于此。
   *
   * 种子取 env/模式默认(纯同步,不读盘);装配期立刻发起一次异步刷新收敛到 Settings。
   * 会话创建必然在一次 HTTP 请求之后,窗口实际为零 —— 但即便命中该窗口,后果也只是
   * 首个会话的子进程按默认门控运行(服务端门控仍然正确),不会错发日志给前端。
   */
  let lastLoggingGateSource: string | undefined;
  let lastLoggingGate: LoggingConfig = loggingConfigSchema.parse(
    resolveLoggingEnvDefault(),
  );
  void resolveLoggingGate().then((g) => {
    lastLoggingGate = g;
  });

  /**
   * 下发给 runner 子进程的日志 env(★ 门控下沉到**产生端**)。
   *
   * 改造前:子进程 logger 库默认 `enabled: true`,而服务端门控默认关 —— 于是子进程把每条
   * 日志序列化成 JSON 写 stderr,主进程解析完**全部丢弃**(`pi-session.ts` 的 `!gate.enabled`
   * → continue)。白烧 CPU、刷终端,且「关掉日志」这个动作在产生端毫无体现。
   *
   * 现在把已解析的门控原样下发,子进程 `initConfigFromEnv()` 据此自我关闭 —— 关闭时
   * **一行都不产生**。三个键与 logger 包既有的 env 契约同名,不新增 env 名。
   *
   * 注:e2b/沙箱分支未接(那条路 env 还要过 `envPassthrough` 白名单),沙箱内维持现状。
   */
  const loggingSpawnEnv = (): Record<string, string> => {
    const gate = lastLoggingGate;
    const out: Record<string, string> = {
      PI_WEB_LOG_ENABLED: gate.enabled ? "1" : "false",
      PI_WEB_LOG_LEVEL: gate.level,
    };
    const on = Object.entries(gate.namespaces ?? {})
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (on.length > 0) out.PI_WEB_LOG_NAMESPACES = on.join(",");
    return out;
  };

  const store = new InMemorySessionStore(true);

  // 日志门控 provider（Req 6.4/6.5/6.6 / task 4.4）：每次新会话创建时读取最新配置。
  // 缺文件/空配置/读失败 → env 推导默认（日志默认**关闭**；`PI_WEB_LOG_ENABLED` 存在且
  // 非 "false" 时强制开启，无需经 Settings；级别/命名空间一并取自 PI_WEB_LOG_* env，
  // 见 resolveLoggingEnvDefault）。有内容 → parse(raw) 应用 Settings 已保存的配置。
  const loggingConfigProvider = async () => {
    const resolved = await resolveLoggingGate();
    // 缓存供**同步**路径读取(spawn env 组装是同步的,见 loggingSpawnEnv)。
    lastLoggingGate = resolved;
    return resolved;
  };

  // readinessHandshake: 开启会话就绪握手(spec session-readiness-handshake) —— 仅生产 app 接线开启,
  // 使前端在 agent 真正就绪前门控发送、就绪通告经粘性 session-status 帧投递。可经 env 关闭以回退。
  // snapshotAuthority: 开启会话权威快照(spec session-snapshot-authority) —— 仅生产 app 接线开启,
  // 使 busy/stats/lifecycle 经单一权威 session-state 帧投递、前端纯投影。可经 env 关闭以一步回退。
  // ⚠ 与 readinessHandshake 存在耦合:lifecycle 仅经 setLifecycle 入快照(后者在握手关闭时早返回),
  // 故若开此而关 readinessHandshake,snapshot.lifecycle 恒为 initializing。二者应同开同关(默认皆开)。
  // 会话展示元数据索引(spec session-meta-index)。两条实现,按宿主形态选:
  //
  //  - **本地默认**(桌面 / dev / npm CLI)→ `JsonFileSessionMetaIndex`:整份 JSON 文件
  //    (默认 `~/.pi/agent/piweb-session-index.json`,可经 PI_WEB_SESSION_META_INDEX_PATH 覆盖,
  //    置于 sessions 目录**之外**)+ 跨进程锁。零依赖、可直接查看/编辑,适合会话量不大的场景。
  //  - **本地 sqlite**(`SESSION_META_STORE=sqlite`,或会话存储本身已是 sqlite)→
  //    `SqliteSessionMetaIndex`:行存储 + 事务 + WAL。单次写是一行 upsert 而非整份重写,
  //    并发控制交给数据库(无需自制锁)。会话量大或多进程共写频繁时选它。
  //  - **云端**(pi-clouds 自行装配)→ 传 `HostDeps.sessionMetaIndex =
  //    new WorkspaceSessionMetaIndex(tenantWorkspace.user)`:每会话一键,持久化经宿主状态端口,
  //    天然获得租户隔离。该字段的类型就是端口本身,故云端无需改动 pi-web 即可接入。
  //
  // 两条实现由 `test/session-meta/conformance.it.test.ts` 的同一批断言共同验收。
  // 定位都是**缓存**:任何读写失败都退化为「无元数据」,不影响会话列出与恢复。
  const sessionMetaIndex: SessionMetaIndex = createLocalSessionMetaIndex();

  // 启动时清一次残留(Req 5.3):索引对会话是**弱引用** —— 绕过 pi-web 的删除(手工 rm、
  // pi CLI 删、换机器、换存储后端)会留下孤儿键。孤儿不影响正确性(列表以实际会话为准),
  // 但索引每次写都要整份读写,孤儿越攒越贵。
  //
  // 只在启动时清一次:够用且最省 —— 重启即收敛,不必引调度器,也不必让每次列表请求
  // 付全量扫描的代价。fire-and-forget + 吞错:清不掉就下次启动再清,绝不阻塞装配。
  void (async (): Promise<void> => {
    try {
      // 顺带清掉原子写留下的 tmp 残留(进程被杀时会留下,单个无害但会累积)。
      if (sessionMetaIndex instanceof JsonFileSessionMetaIndex) {
        await sessionMetaIndex.cleanupStaleTemps();
      }
      const entryStore = await createSessionEntryStore(sessionStoreConfigFromEnv());
      const existing = (await entryStore.listAll()).map((m) => m.sessionId);
      const removed = await sessionMetaIndex.prune(existing);
      if (removed > 0) {
        hostAssemblyLogger.info("session meta index pruned", { removed });
      }
    } catch {
      // 静默:元数据是展示增强(Req 3.5)。
    }
  })();

  // 会话活跃态查询(Req 7.5):从**活跃会话注册表**(store,非持久化 SessionEntryStore)按标识
  // 取会话的活跃态投影。未加载的历史会话 → undefined = 空闲,且**不为取状态加载任何会话**。
  const sessionActivityOf = (sessionId: string): SessionActivity | undefined =>
    store.get(sessionId)?.activity;

  const manager = new SessionManager({
    store,
    idleMs: 0,
    loggingConfigProvider,
    // 标题变化 → 同步进元数据索引,使列表快读命中(Req 1.2)。回调抛错由 PiSession 吞掉。
    onTitleChanged: (id, title) => {
      void sessionMetaIndex.merge(id, { title }).catch(() => {});
    },
    readinessHandshake: process.env.PI_WEB_DISABLE_READINESS_HANDSHAKE !== "1",
    readyTimeoutMs: readyTimeoutFromEnv(process.env),
    snapshotAuthority: process.env.PI_WEB_DISABLE_SNAPSHOT_AUTHORITY !== "1",
    // ai-gateway-catalog-coldstart(任务 2.2,Req 1.1/2.1/3.3/5.3):会话侧模型清单的反向
    // 拉取应答。未启用网关套件 → undefined,不注册处理器,行为逐字节不变(Req 5.1)。
    ...(gatewayEnabled
      ? {
          gatewayModelsResolver: makeGatewayModelsResolver({
            catalogs: gatewayCatalogs,
            instances: gatewayInstances,
          }),
        }
      : {}),
  });

  // 强制注入:解析 pi-sandbox 入口一次(env 覆盖 > <agentDir>/npm/.../pi-sandbox/index.ts)。
  // 使沙箱 enforcement **不依赖** pi 默认扩展发现:cli 模式经 `-e <entry>` 显式加载;
  // custom 模式经 env `PI_WEB_SANDBOX_ENTRY` 由 runner option-mapper 追加到 additionalExtensionPaths。
  // 未安装时为 undefined → 跳过注入(不报错,行为回退到默认发现)。
  const sandboxEntry = resolveSandboxEntry(config.agentDir);
  // ⚠ 三个 pi-web 自带内置扩展(ext-tools / auto-title / mcp)的入口**不再由主进程解析下发**
  // (spec runner-self-resolved-builtins):它们改由 runner 侧从**自身安装树**自解析
  // (packages/server/src/runner/builtin-extensions.ts)。原机制隐含「主进程与 runner 同文件
  // 系统」的前提,在 e2b 沙箱下不成立,导致这些扩展在沙箱中静默不可用。
  // 自动标题总开关 PI_WEB_AUTO_TITLE 的判定已随之下沉到扩展内部(关闭即不注册 handler),
  // 用户可观察语义不变。sandboxEntry 不在此列:其入口在 agent 包内,仍由主进程解析下发。

  // 附件存储(attachment-store,Req 7.1):在主进程实例化一次,经 env 约定解析落盘目录
  // (PI_WEB_ATTACHMENT_DIR)与稳定签名 secret(PI_WEB_ATTACHMENT_SECRET),构造本地后端门面。
  // store 随 handler 单例 pin 在 globalThis(此函数仅首次调用),故读(上传落库)/写(分发取流)
  // 两路径共用同一主进程实例。下游 attachment-tool-bridge 的 spawn env 透传(目录+secret)归
  // task 5.2,不在此装配。
  // 同时取出 dir/secret(task 5.2,Req 7.3/7.4):经 spawn env 下发给子进程,
  // 为未来 runner 子进程共享同一本地后端预留接缝,并保证签名 secret 主/子进程一致。
  // 仅下发——本切片不在子进程实例化 store(那是 attachment-tool-bridge)。
  const {
    store: attachmentStore,
    dir: attachmentDir,
    secret: attachmentSecret,
    // 多后端拓扑透传清单(attachment-backend-pluggable spec,Req 6.1):未配置拓扑时为空对象,
    // 子进程 spawn env 仅下发既有 DIR/SECRET/URL_BASE,零行为变化。
    passthroughEnv: attachmentPassthroughEnv,
    // 主进程 store 也用 `/api` 前缀(上传端点返回的 displayUrl 与 tool-output 一致可达)。
  } = attachmentStoreConfigFromEnv(process.env, { urlBasePath: "/api" });
  const attachmentEnv = { dir: attachmentDir, secret: attachmentSecret };
  // agent-attachment-profile 关断开关(Req 5.1/5.2):装配期捕获一次(与 dir/secret 同一时机),
  // 而非在每次 spawn 时现读 process.env——避免请求处理期 env 被改动造成主/子不同步。
  const attachmentProfileDisabledValue = process.env[ATTACHMENT_PROFILE_DISABLED_ENV];
  // 附件拓扑条件透传判定(spec sandbox-baked-agent-image 任务 4.2,Req 5.1/5.2):
  // 装配期一次判定,与上面 attachmentStoreConfigFromEnv 同一 env 来源、同一时机——
  // attachmentPassthroughEnv 是装配期快照,判定若在请求期现读 process.env 会与快照漂移。
  // 规则:拓扑存在且**每个** backend.kind ∈ {cloud-http, s3}(全远程)→ e2b 分支把
  // attachmentPassthroughEnv(拓扑原文 + 被引凭据)并入 e2bSpec.env 且其键并入
  // envPassthrough 白名单(Req 5.1);否则(未配拓扑 / 混合含 local-fs)完全不注入——
  // 沙箱内子进程 wiring 走既有 fail-closed 附件降级(Req 5.2),避免把本地磁盘语义的
  // 附件 env 带进云沙箱(签名 URL 401)。注:parseBackendsEnv 的错误路径不新增——
  // 同一原文已被上面的 attachmentStoreConfigFromEnv 先解析,坏配置在此之前即抛。
  // local/stub 分支不经此判定(与主进程同机共享后端,混合拓扑照样透传,行为零变化)。
  const attachmentTopology = parseBackendsEnv(process.env[ATTACHMENT_BACKENDS_ENV]);
  const attachmentAllRemote =
    attachmentTopology !== undefined &&
    attachmentTopology.backends.every((b) => b.kind === "cloud-http" || b.kind === "s3");
  const sandboxAttachmentEnv: Record<string, string> = attachmentAllRemote
    ? attachmentPassthroughEnv
    : {};

  const createChannel = (
    resolved: ResolvedSource,
    opts: CreateChannelOpts,
  ): SessionChannel => {
    if (config.stubAgent) {
      // Deterministic offline agent: reuse the real channel over the stub spec,
      // threading session identity + metadata via env (resolved cwd kept aligned).
      return new PiRpcProcess(
        stubSpawnSpec(
          config,
          opts,
          resolved.spawnSpec.cwd,
          attachmentEnv,
          attachmentPassthroughEnv,
          attachmentProfileDisabledValue,
        ),
      );
    }
    // e2b 云沙盒传输(spec e2b-sandbox-transport,Req 3.2/5.x/6.x):agent 子进程改在
    // e2b 隔离沙盒里跑,前端/协议/组合根无感。会话核心 PiRpcSession 复用于 E2bTransport。
    //  - 缺 E2B_API_KEY/template → 在此抛清晰错误,不静默回退 local(Req 3.3)。
    //  - E2bTransport 只消费 spec.env(经 cfg.envPassthrough 白名单过滤),不用 spec.cmd/args/cwd
    //    (沙盒内跑 cfg.runnerCmd),故本地假设天然绕过:**不注入附件 env**(Req 6.3,避免本地磁盘
    //    签名 URL 401)、不依赖 project-trust 的宿主 cwd 信任语义(Req 6.2)、无本地文件热重载
    //    (Req 6.1;PI_RUNNER_HOT_RELOAD 属 runner 本地机制,e2b 分支根本不下发)。
    //  - 一期 PoC:runner 在 template 内(预装 node + pi + 最小 agent 源),沙盒内跑
    //    `pi --mode rpc`;仅把 provider 凭据经 envPassthrough 透传。会话身份对齐/附件共享/
    //    沙盒复用为二期,不改本传输接口。
    // 执行传输后端选择(Req 3.1/3.2/3.3):默认 local;PI_WEB_TRANSPORT=e2b 时经 e2b 沙盒。
    // 在会话创建路径(此闭包内)调用 selectTransport,缺 e2b 配置即以清晰错误让会话创建失败,
    // 不静默回退 local、不在 app 启动期 fail-fast(Req 3.3)。
    const selection = selectTransport(process.env);
    if (selection.mode === "e2b") {
      // 废弃告警(spec sandbox-credentials-v2,任务 3.1,Req 4.2):aigc-proxy 已从代码与
      // 装配中完全摘除;若运维仍设置其专属废弃 env(三者任一),这些 env 自身已不再产生
      // 任何效果(沙箱沿用现状 key 透传行为,与摘除前"未配置代理"的形态等同,Req 4.3),
      // 仅在此提示已废弃与替代去向,便于运维排查为何配置不再生效。
      const deprecationWarning = deprecatedAigcProxyWarning(process.env);
      if (deprecationWarning !== undefined) {
        llmGatewayLogger.warn(deprecationWarning);
      }
      // LLM 网关凭据切换(任务 3.3,design.md LlmGatewayAssembly,Req 2.1/2.2/2.4/2.5/4.3/4.4):
      // 决策逻辑抽成纯函数 computeE2bProviderEnv(见 llm-gateway-assembly.ts),便于脱离真实
      // e2b/ws-runner 传输单测——配置 LLM 网关时 providerKeysForE2b 为空(真实 provider key
      // 全量不进 env/白名单),sandboxLlmEnv 携 PI_LLM_GATEWAY_BASE/PI_LLM_TOKEN_<ID> 顶替;
      // 未配置时 providerKeysForE2b=config.providerKeys(现状透传,含 AIGC 三键,Req 4.3/4.4),
      // sandboxLlmEnv 为空,并带一条待记的 warn(Req 2.4)。
      const e2bProviderEnv = computeE2bProviderEnv({
        config,
        sessionId: opts.sessionId,
        env: process.env,
      });
      if (e2bProviderEnv.warn !== undefined) {
        llmGatewayLogger.warn(e2bProviderEnv.warn);
      }
      const { providerKeysForE2b, sandboxLlmEnv } = e2bProviderEnv;
      // ai-gateway 会话 token 注入(spec ai-gateway-providers,design.md §2.5,任务 4.1,
      // Req 4.5):增量可选,不替换 providerKeysForE2b/sandboxLlmEnv 中的任何键(与
      // llm-gateway 分离共存,Req 1.3)。未启用套件或缺沙箱可达 public base 时零注入,
      // 仅记一条待记 warn(后者复用 llm-gateway 的 sandbox-reachable public base 概念,
      // 两套路由挂载在同一部署 /api 之下)。
      const aiGatewaySessionEnv = computeAiGatewaySessionEnv({
        aiGatewayConfig: aiGwConfig,
        sessionId: opts.sessionId,
        env: process.env,
        publicBase: config.llmGateway?.publicBase,
        tokenTtlMs: config.llmGateway?.tokenTtlMs ?? DEFAULT_SANDBOX_TIMEOUT_MS,
      });
      if (aiGatewaySessionEnv.warn !== undefined) {
        llmGatewayLogger.warn(aiGatewaySessionEnv.warn);
      }
      const cloudflareEnvForE2b = cloudflareSpawnEnvFragment({
        env: process.env,
        agentDir: config.agentDir,
      });
      const e2bSpec: SpawnSpec = {
        ...resolved.spawnSpec,
        env: {
          ...resolved.spawnSpec.env,
          ...providerKeysForE2b,
          ...sandboxLlmEnv,
          ...aiGatewaySessionEnv.env,
          ...cloudflareEnvForE2b,
          // 附件拓扑条件透传(任务 4.2,Req 5.1):全远程拓扑时并入装配期快照
          // (拓扑原文 + 被引凭据,值以快照为权威、不受请求期 env 漂移影响);
          // 否则空对象(零键)——沙箱内附件走既有 fail-closed 降级(Req 5.2)。
          ...sandboxAttachmentEnv,
          // 会话身份对齐(Req 4.1):烘焙镜像 AGENT_CMD 定死于构建期,per-session 的
          // --session-id 塞不进 argv;改经 env 下发,runner 侧 argv 缺席时读此兜底,
          // 使沙箱内会话 id 与宿主一致(附件属主校验依赖)。池化预 spawn 的 agent
          // 收不到 per-session env,附件工具场景须用非池模板(取舍见 tasks.md Notes)。
          PI_WEB_SESSION_ID: opts.sessionId,
        },
      };
      // 按 source 的三级沙箱模板解析(spec sandbox-baked-agent-image 任务 4.1,
      // Req 3.1/3.4):显式映射(PI_WEB_E2B_TEMPLATE_MAP)→ 门控派生 → 全局模板
      // (PI_WEB_E2B_TEMPLATE)。ok 时以解析结果覆写 selection.config.template
      // (二传输的 config.template 必填,覆写后自然窄化);三级全空即抛携三种修复
      // 路径的错误——会话创建失败,不静默回退 local(与既有缺配置语义一致)。
      //  - policySource:resolver 稳定来源标识(dir source 串或缺省 cwd / git url /
      //    builtin:<name>);外部自定义 resolver 未赋值时回退 opts.source → resolved.cwd。
      //  - rawSource:用户传入的原始 source 串(map 键第一优先位;resume 元数据缺
      //    source 时为 undefined,仅按 policySource 查找)。
      const templateResolution = resolveSandboxTemplate({
        source: {
          policySource: resolved.policySource ?? opts.source ?? resolved.cwd,
          ...(opts.source !== undefined ? { rawSource: opts.source } : {}),
        },
        env: process.env,
      });
      if (!templateResolution.ok) {
        throw new Error(templateResolution.error);
      }
      // env 白名单组装(任务 4.2/3.3,Req 4.2/5.1/2.1/2.2):传输只把 envPassthrough 白名单键从
      // e2bSpec.env 下发进沙箱,故上面并入 env 的键必须同步并入白名单才真正可达。
      //  - e2bProviderEnv.passthroughKeys**无条件**并入(不受附件判定影响;值已在上方
      //    e2bSpec.env)——配置网关时这是 sandboxLlmEnv 的键(PI_LLM_GATEWAY_BASE/
      //    PI_LLM_TOKEN_<ID>,零真实 provider key),未配置时是 providerKeysForE2b 的键
      //    (现状透传,与摘除 aigc-proxy 前一致);两态互斥,见 llm-gateway-assembly.ts。
      //  - 附件透传键仅在全远程判定通过时非空(与 env 并入同一开关,键值成对)。
      //  - Set 去重:provider/网关/附件键可能与既有 PI_WEB_E2B_ENV_PASSTHROUGH 配置重复。
      const envPassthrough = [
        ...new Set([
          ...(selection.config.envPassthrough ?? []),
          ...Object.keys(sandboxAttachmentEnv),
          ...e2bProviderEnv.passthroughKeys,
          ...aiGatewaySessionEnv.passthroughKeys,
          // 会话身份 env(见上方 e2bSpec.env 注入处注释)。
          "PI_WEB_SESSION_ID",
        ]),
      ];
      const e2bConfig = {
        ...selection.config,
        template: templateResolution.template,
        envPassthrough,
      };
      // 数据面二选一:
      //  - ws-runner:WS 连沙箱内 agent-runner(agent-sandbox/ACS,无 envd)——完整闭环。
      //  - envd(默认):e2b SDK commands.run(真实 e2b 云有 envd)。
      const transport =
        selection.dataPlane === "ws-runner"
          ? new SandboxWsTransport(e2bSpec, e2bConfig)
          : new E2bTransport(e2bSpec, e2bConfig);
      return new PiRpcSession(transport) satisfies SessionChannel;
    }
    // Real mode: append session-alignment args by source mode. Both modes take
    // --session-id (agent-side open-or-create); custom (runner) also takes
    // --source-meta for piweb.session metadata; cli (pi) takes --model natively.
    const extraArgs: string[] = ["--session-id", opts.sessionId];
    if (opts.model !== undefined) extraArgs.push("--model", opts.model);
    if (resolved.mode === "custom" && opts.source !== undefined) {
      extraArgs.push("--source-meta", opts.source);
    }
    // cli 模式显式加载沙箱扩展(`--extension, -e <path>`,不依赖 user-scope 注册表)。
    if (resolved.mode === "cli" && sandboxEntry !== undefined) {
      extraArgs.push("-e", sandboxEntry);
    }
    // Cloudflare:release 桌面无 .env.local,凭据在 aigc.json;每次 spawn re-read 并入 runner env,
    // 使 requiredVars / var-resolver 在子进程里能展开 ${CLOUDFLARE_*}(不 bake 进 payload)。
    // 素材 pane 及其 PI_LABS_WEBAPP_URL 属 aigc-agent 业务仓,宿主不代管。
    const cloudflareEnv = cloudflareSpawnEnvFragment({
      env: process.env,
      agentDir: config.agentDir,
    });
    const spec: SpawnSpec = {
      ...resolved.spawnSpec,
      args: [...resolved.spawnSpec.args, ...extraArgs],
      env: {
        ...resolved.spawnSpec.env,
        ...config.providerKeys,
        ...cloudflareEnv,
        // ★ 日志门控下沉到产生端:把已解析的门控下发子进程,关闭时 runner **一行都不产生**
        //   (改造前是子进程照产、主进程解析后全丢)。见 loggingSpawnEnv 的说明。
        ...loggingSpawnEnv(),
        // custom 模式据此在 runner 内强制注入;cli 模式无害(由上面的 -e 生效)。
        ...(sandboxEntry !== undefined ? { PI_WEB_SANDBOX_ENTRY: sandboxEntry } : {}),
        // 公司级 pi skills/prompts 由 host 明确下发；user/project 默认发现仍由 pi 保留。
        PI_WEB_COMPANY_SKILLS_DIR: path.join(companyResourceRoot, "skills"),
        PI_WEB_COMPANY_PROMPTS_DIR: path.join(companyResourceRoot, "prompts"),
        // ext-tools / auto-title / mcp 这三个既有内置扩展入口**不再下发**:改由 runner 侧自解析
        // (spec runner-self-resolved-builtins)。这消除了「宿主机绝对路径在沙箱内不存在」
        // 的失效面,也使新增内置扩展不必再在此处接线。
        // 附件目录约定 + 签名 secret 经 spawn env 下发(Req 7.3/7.4),取自主进程 store
        // 配置,保证主/子进程一致(子进程产出的 tool-output /raw 签名 URL 才能在主进程通过校验)。
        ...attachmentSpawnEnv(
          attachmentEnv,
          attachmentPassthroughEnv,
          attachmentProfileDisabledValue,
        ),
        // desktop-cloud-login(任务 6.1,Req 3.1/4.4/5.2):登录态下把桌面凭据 + egress base + 模型
        // 清单经 spawn env 下发 runner(runner option-mapper 据此注入内存 ModelRegistry 走 egress)。
        // 未启用/未登录/凭据过期 → 空对象,runner 走本地 auth.json 默认(Req 4.1/4.4)。凭据仅经 env
        // 下发(同 providerKeys 信任边界),不入日志/历史(Req 5.2)。sk-gw 云端换取,不下发(B-pure)。
        // desktop-account-login 任务 6.1/6.2(Req 4.5):有 `egress` 授予时以授予为准,
        // 否则完全退回上面那套 env 配置行为。cachedStatic() 是同步读(不打网络)——
        // spawn spec 的构造是同步路径,为读一个已在内存里的值把整条链改成异步不划算。
        ...computeEgressSpawnEnvFromGrant(
          cloudLoginConfig,
          authSessionState.currentCredential(),
          desktopCapabilitiesClient?.cachedStatic()?.egress,
        ),
        // spec ai-gateway-session-models(任务 2.2,Req 1.3/2.1/2.5);多实例序列化见 spec
        // multi-gateway-providers 任务 3.6(Req 1.1/1.3):逐实例把网关基址 + 凭据 + 目录
        // id 清单经 spawn env 下发本地 runner,runner 据此为每个实例各自注册同名 provider
        // (`packages/server/src/host-assembly/model-sources.ts` 的 `resolveAiGatewaySessionSpecsFromEnv`
        // 已支持多实例还原),使清单里的网关模型能被 registry 解析(否则选中即
        // 「模型未找到」)。任一实例未启用 / 无凭据 / 目录为空 → 该实例被跳过
        // (fail-soft,不影响其余实例),零网关实例时行为与本 spec 实施前一致。
        // 凭据经 env 下发,与上面 `config.providerKeys` 同一信任边界、同一形态(design §D1)。
        // `catalog.get()` 是同步快照(stale-while-revalidate,不打网络),契合 spawn spec
        // 的同步构造路径。
        ...computeAiGatewaySessionsSpawnEnv({
          instances: gatewayInstances.map((inst) => ({
            instanceId: inst.id,
            baseUrl: inst.baseUrl,
            apiKey: resolveGatewayInstanceApiKeySync(inst, process.env),
            catalog: gatewayCatalogs.get(inst.id)?.get() ?? [],
          })),
        }).env,
      },
    };
    return new PiRpcProcess(spec);
  };

  // extension-management + 统一命令层(unified-command-result-layer)共享的安装治理依赖。
  // host 命令(/plugin)与 REST 路由复用同一 piCli/allowlist/reload + env 门控,保持一致。
  const extPiCli = new ChildProcessPiCli();
  const extAllowMutate = process.env.PI_WEB_EXT_ADMIN_ALLOW_ANY === "1";
  // allowlist 放宽开关(各自独立、可叠加):
  //   PI_WEB_EXT_ALLOW_LOCAL=1 → 放行 `local:<path>` 源
  //   PI_WEB_EXT_ALLOW_NPM=1   → 放行任意 npm 包(含无 scope),仍要求精确版本固定
  const extAllowlist: AllowlistConfig = {
    ...DEFAULT_ALLOWLIST,
    ...(process.env.PI_WEB_EXT_ALLOW_LOCAL === "1" ? { allowLocal: true } : {}),
    ...(process.env.PI_WEB_EXT_ALLOW_NPM === "1" ? { allowAnyNpm: true } : {}),
  };
  // pi-native resources use three explicit scopes: company (deployment-configured),
  // agent (<cwd>/.pi), and personal (<agentDir>). The default company root is safe and
  // empty until populated; deployments can point it at a shared directory.
  const companyResourceRoot =
    process.env.PI_WEB_COMPANY_RESOURCES_DIR?.trim() || path.join(config.agentDir, "company");
  const resourceManager = createPiResourceManager({
    cwd: config.defaultCwd,
    agentDir: config.agentDir,
    companyRoot: companyResourceRoot,
  });
  const reloadRunner = async (session: {
    restartRunner(): Promise<void>;
  }): Promise<void> => {
    await session.restartRunner();
  };

  // /agent 与 /plugin host 命令(spec agent-plugin-commands):命令名即类别,取代原先靠
  // `--kind` 分派的单一 /install。复用 CLI install 子域(createInstaller/createPluginInstaller
  // 直调,零第二份编排)。治理与 REST /extensions 同源:extAllowlist(白名单)/
  // extAllowMutate(admin 门)/extPiCli。agent 落盘目标与 GET /agent-sources 的
  // 「扫描 ∪ 注册表」同值,装完选择器天然可见。
  const installRegistryPath =
    process.env.PI_WEB_SOURCES_REGISTRY ??
    path.join(config.agentDir, "sources.json");
  const packageCommandDeps: PackageHostCommandDeps = {
    installer: createInstaller({
      allowlistConfig: extAllowlist,
      piCli: extPiCli,
      agentInstallerOptions: {
        sourcesRoot: resolveSourcesRoot(process.env, config.defaultCwd),
        registryPath: installRegistryPath,
      },
      // registry 通道(spec installer-registry-channel):`/agent install <registry-id>` 与
      // source 选择器路径走同一份安装实现。
      //
      // ★ 全程惰性:`desktopCapabilitiesClient` 与 `sourcesScanRoots` 都在下方才构造,故这里
      //   不能直接引用它们的值 —— 与 `listAgentSources` 同一手法(闭包内取,调用时才求值),
      //   而不是把 packageCommandDeps 的构造整块下移(牵连面大得多)。
      // ★ 未登录 / 未配置云端 → 通道报 NOT_AUTHENTICATED → 上浮为 REGISTRY_UNAVAILABLE,
      //   是诚实降级,不是「不支持」。
      registryChannel: {
        async materialize(spec, opts) {
          if (desktopCapabilitiesClient === undefined) {
            return { ok: false, error: { code: "NOT_AUTHENTICATED" } };
          }
          return createLazyRegistryChannel({
            getSourcesGrant: () => desktopCapabilitiesClient.getSourcesGrant(),
            // agent 落点 = 第一个扫描根,装完即被 scan-provider 枚举(与选择器路径同根)。
            agentTargetRoot: sourcesScanRoots[0] ?? defaultSourcesRoot(),
            // plugin 落点刻意**在扫描根之外**:落进去会被源枚举当成 agent 源列出来。
            // 是长期位置,不是暂存 —— pi 只把路径记进台账,不拷贝内容。
            pluginTargetRoot: path.join(config.agentDir, "registry-plugins"),
          }).materialize(spec, opts);
        },
      },
    }),
    pluginInstaller: createPluginInstaller({ piCli: extPiCli }),
    adminGate: () => extAllowMutate,
    reloadRunner,
    // 审计与 REST 扩展安装同 sink(defaultOnAudit):host 通道无 AuthContext,actor 固定
    // 标识来源;uninstall→remove,其余动作按安装类记录(list/update 仅 admin 拒绝会至此)。
    audit: (event: InstallAuditEvent): void => {
      defaultOnAudit({
        actor: "host-command",
        at: new Date().toISOString(),
        action: event.action === "uninstall" ? "remove" : "install",
        source: event.source ?? event.action,
        outcome: event.outcome,
        reason: redactReason(event.reason),
      });
    },
    // `/agent list` 的数据源:CLI 的 agent 通道只有装/卸,没有列举能力,故接既有的 agent 源
    // 枚举 provider(与 GET /agent-sources 同一实例)。惰性求值:provider 在下方构造。
    listAgentSources: async () => await agentSourcesProvider.list(),
    cwd: config.defaultCwd,
    // 发布前确保本机公钥已登记(spec publish-key-lifecycle)。惰性求值,理由同上。
    // 未登录 / 未配置云端 → 直接跳过(编排器内部对 grant 缺席即返回),不产生任何请求。
    ensurePublishKeyRegistered: async () => {
      if (desktopCapabilitiesClient === undefined) return;
      await ensurePublishKeyRegistered({
        ensureKey: () => ensurePublishKey(),
        getPublishGrant: () => desktopCapabilitiesClient.getPublishGrant(),
        registerPublishKey: (input) => desktopCapabilitiesClient.registerPublishKey(input),
      });
    },
    // 真实发布(spec publish-execution)。恒注入 —— 未配置云端时 `getPublishGrant` 取不到授予,
    // `executePublish` 自己就会返回 `PUBLISH_NOT_AVAILABLE`(与本 spec 引入前逐字相同的文案),
    // 故不必在此再判一次"有没有云端"(判两次 = 两处文案要同步)。
    executePublish: (input) =>
      executePublish(input, {
        getPublishGrant: async () => desktopCapabilitiesClient?.getPublishGrant(),
        // ★ 与 dry-run 路径不同:这里是**硬前置**。公钥没登记则服务端验签必然失败,
        //   而那次失败会烧掉一个版本号。`already`(回执命中)同样算就位。
        ensureKeyRegistered: async () => {
          if (desktopCapabilitiesClient === undefined) return false;
          const outcome = await ensurePublishKeyRegistered({
            ensureKey: () => ensurePublishKey(),
            getPublishGrant: () => desktopCapabilitiesClient.getPublishGrant(),
            registerPublishKey: (i) => desktopCapabilitiesClient.registerPublishKey(i),
          });
          return isKeyInPlace(outcome);
        },
      }),
    auditPublish: (event): void => {
      defaultOnAudit({
        actor: "host-command",
        at: new Date().toISOString(),
        // 审计动作词表沿用既有三态,发布归入 install(它也是"把东西放进注册表")。
        action: "install",
        source: event.source ?? "publish",
        outcome: event.outcome === "succeeded" ? "success" : "failure",
        reason: redactReason(event.reason ?? event.outcome),
      });
    },
  };
  const agentHostCommand = createPackageHostCommand("agent", packageCommandDeps);
  const pluginHostCommand = createPackageHostCommand("plugin", packageCommandDeps);

  // desktop-hybrid-agent-sources: 线上 registry ∪ 本地 sources.json ∪ 扫描根(~/.pi-web/agents)。
  // 登录时经桌面凭据换 capabilities.sources;未登录/云失败 → 仅本地(fail-soft)。
  const sourcesScanRoots = resolveSourcesScanRoots(config.defaultCwd, config.agentDir);
  const sourcesRegistryPathValue =
    process.env.PI_WEB_SOURCES_REGISTRY ?? path.join(config.agentDir, "sources.json");
  const localFileRegistry = createRegistrySourceProvider({
    registryPath: sourcesRegistryPathValue,
  });
  const localScan = createScanSourceProvider({ roots: sourcesScanRoots });
  // capabilities URL:env 显式值优先,否则由**已解析的**云端出口地址推导。
  // ★ 必须用 cloudLoginConfig.egressBaseUrl 而非 process.env —— 后者在打包桌面版里为空
  //   (配置来自 `<agentDir>/cloud.json`),只读 env 会让 capabilities 客户端恒为 undefined,
  //   进而线上源解析插件不注入、选中线上源报 500。此坑由打包态真机烟雾发现(Req 8.3)。
  const capabilitiesUrl =
    resolveDesktopCapabilitiesUrl(process.env) ??
    (cloudLoginConfig !== undefined
      ? deriveCapabilitiesUrlFromEgressBase(cloudLoginConfig.egressBaseUrl)
      : undefined);
  const desktopCapabilitiesClient =
    cloudLoginConfig !== undefined && capabilitiesUrl !== undefined
      ? createDesktopCapabilitiesClient({
          capabilitiesUrl,
          getDesktopCredential: () => authSessionState.currentCredential(),
        })
      : undefined;
  // 身份端口 P5(spec desktop-account-login,任务 6.2,Req 2.1/2.5/2.6)。
  //
  // ★ 登录 URL 由 **cloudLoginConfig.egressBaseUrl** 推导,不读 process.env ——
  //   打包桌面版里 env 为空(壳不转发、Finder 无 shell 环境、.env 落在会被 GC 的运行时
  //   目录),配置实际来自 `<agentDir>/cloud.json`。此坑已由 desktop-cloud-login Req 8.3
  //   与 desktop-online-source-runnable 各踩过一次,不要再从 env 读。
  //
  // 未配置云端 → undefined → 能力面不挂载 → GET /api/identity 404 → 前端不渲染登录入口
  // (Req 2.5),链路与本特性引入前完全一致。
  const cloudLoginUrl =
    cloudLoginConfig !== undefined
      ? deriveLoginUrlFromEgressBase(cloudLoginConfig.egressBaseUrl)
      : undefined;
  const cloudDesktopAuth =
    cloudLoginUrl !== undefined
      ? createCloudDesktopAuthClient({ loginUrl: cloudLoginUrl })
      : undefined;
  const desktopIdentityProvider =
    desktopCapabilitiesClient !== undefined && cloudLoginUrl !== undefined
      ? createDesktopPasswordIdentityProvider({
          loginClient: createCloudLoginClient({ loginUrl: cloudLoginUrl }),
          desktopAuth: cloudDesktopAuth,
          capabilitiesClient: desktopCapabilitiesClient,
          authState: authSessionState,
          onCredentialChanged: (credential) =>
            manager.broadcastRunnerFrame({
              type: "piweb_credential_refresh",
              credential: credential ?? null,
            }),
        })
      : undefined;

  const agentSourcesProvider =
    desktopCapabilitiesClient !== undefined
      ? createCompositeSourceProvider(
          createRegistryHttpSourceProvider({
            getGrant: () => desktopCapabilitiesClient.getSourcesGrant(),
          }),
          localFileRegistry,
          localScan,
        )
      : createCompositeSourceProvider(localFileRegistry, localScan);

  // 线上源可运行(spec desktop-online-source-runnable,任务 4.1)。
  //
  // 仅在云登录与能力端点均已配置时构造;否则保持 undefined → makeRealResolver 不注入插件,
  // 解析链路与本特性引入前**完全一致**(Req 8.2)。
  //
  // ★ 索引每次 lookup 现建,而非装配时建一次:刚安装好的源必须在**下一次**解析时即可见,
  // 否则会被判为「未安装」而重复下载。一次 readdir 的开销可忽略,换取新鲜度正确。
  const onlineSourceResolver: SourceResolverPlugin | undefined =
    desktopCapabilitiesClient !== undefined
      ? createRegistrySourceResolver({
          index: {
            lookup: (sourceId) =>
              createInstalledRegistryIndex({ roots: sourcesScanRoots }).lookup(sourceId),
          },
          port: createRegistryInstallPort({
            getSourcesGrant: () => desktopCapabilitiesClient.getSourcesGrant(),
            // 落点 = 第一个扫描根,使装完即被 scan-provider 枚举(Req 1.4)。
            targetRoot: sourcesScanRoots[0] ?? defaultSourcesRoot(),
          }),
        })
      : undefined;

  // ── M3:16 个能力面经 composeCapabilities 强制表态后装配(spec host-contract-capability-composition)──
  // HostDeps 一次构造(deps 并集,D4);条件挂载(llm/ai/auth)以**可选字段**表达——未配置时
  // 字段为 undefined,对应 factory 产空路由集(等价现状三元 `cond ? createX(...) : []`)。
  // secret 等惰性求值发生在此(未配置根本不构造),规避 resolveLlmGatewaySecret 在未配置时抛错。
  const hostDeps: HostDeps = {
    agentDir: config.agentDir,
    defaultCwd: config.defaultCwd,
    // GET /config/models 唯一部署级目录取数(multi-gateway-providers 任务 4.3,Req 3.1,
    // 3.2, 3.4):带 `input`/`output` 筛选参数时转发给 `ModelCatalogService.query()`,取代
    // 此前独立的 GET /aigc/models(output=image)与 GET /vision/models(input=image)。
    //
    // ★ 未带任何筛选参数时**刻意不**调用 `query({})` —— 那会无条件把 image 命名空间
    //   (AIGC 静态目录,与本特性的网关/自定义 provider 无关,一直存在)并入结果,
    //   在 settings 的通用 provider/model 下拉(`model-select-field.tsx`,尚未迁移到
    //   显式筛选参数,属任务 6.1)里混入 `newapi`/`sufy`/`dashscope` 等图像专用
    //   provider——这些从不是可选的对话 provider。`query()` 还会给每条目无条件盖章
    //   `source`(默认 `"self"`),而未注入网关时的旧 `chatOptions()` 完全不带该字段。
    //   两者都不是「零筛选 = 行为不变」(Req 10.1),故未带筛选参数时继续走
    //   `chatOptions()`,与本特性引入前逐字节一致;只有调用方显式传参(即消费方已
    //   按 Req 11.2 迁移到「按类型呈现」)才切到 `query()` 的合并/筛选路径。
    //   原始查询字符串未经取值域校验直传 —— 非法取值不匹配任何条目,`query()`
    //   静默返回空集而非报错(见 config-routes.ts)。
    listModelOptions: (query) => {
      const catalog = makeModelCatalog();
      if (query.input === undefined && query.output === undefined) {
        return catalog.chatOptions();
      }
      return catalog.query({
        input: query.input as CatalogQuery["input"],
        output: query.output as CatalogQuery["output"],
      });
    },
    resolveSourceSettings: makeSourceSettingsResolver(config),
    onSourceSettingsSaved: (sourceKeyValue, payload) =>
      broadcastSettingsChanged(manager.getStore(), sourceKeyValue, payload),
    sessionStoreConfig: sessionStoreConfigFromEnv(),
    // 元数据索引 + 活跃态查询(spec session-meta-index):session.list 投影标题/来源/活跃态,
    // session.actions 改名写标题、删除清条目。
    sessionMetaIndex,
    sessionActivityOf,
    sessionsManageEnabled:
      process.env.NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE !== "false" &&
      process.env.NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE !== "0",
    sourcesScanRoots,
    sourcesRegistryPath: sourcesRegistryPathValue,
    agentSourcesProvider,
    llmGateway: config.llmGateway?.serve
      ? {
          secret: resolveLlmGatewaySecret(process.env),
          registry: resolveLlmGatewayProviderTable(process.env),
        }
      : undefined,
    // routes.ts 按实例分流(spec multi-gateway-providers 任务 3.4,Req 1.3);本装配点
    // (任务 3.6,Req 1.1/1.3)按 `gatewayInstances` 逐个构造路由表——两个实例同时启用时
    // 分别挂载,各自持有独立的 `InstanceEnvKeyResolver`(独立凭据解析,一个实例配错
    // 凭据不影响另一个的转发)。
    // ★`timeoutMs` 是 `CreateAiGatewayRoutesDeps` 的**单一**全局字段(路由层未按实例区分
    //   超时,这是 routes.ts 契约本身的限制,不在本任务边界内),取首个实例的超时值;
    //   零实例时 `aiGateway` 整体不注册。
    aiGateway: gatewayEnabled
      ? {
          instances: new Map(
            gatewayInstances.map((inst) => [
              inst.id,
              {
                baseUrl: inst.baseUrl,
                keyResolver: new InstanceEnvKeyResolver(inst.id, process.env, {
                  legacyFallback: inst.id === DEFAULT_GATEWAY_INSTANCE_ID,
                }),
              },
            ]),
          ),
          secret: resolveAiGatewaySecret(process.env),
          timeoutMs: gatewayInstances[0]?.timeoutMs,
        }
      : undefined,
    authState: cloudLoginConfig !== undefined ? authSessionState : undefined,
    identityProvider: desktopIdentityProvider,
    desktopAuthClient: cloudDesktopAuth,
    // 壳凭据取回 token(Req 12)。仅桌面壳注入该 env;为空则该端点不挂载。
    shellToken: resolveShellToken(process.env),
    attachmentStore,
    resolveWriteBackend: (sessionId) => store.get(sessionId)?.getAttachmentWriteProfile(),
    store,
    bashEnabled: resolveBashEnabled(),
    extension: {
      piCli: extPiCli,
      store,
      manager,
      ...(extAllowMutate ? { adminPolicy: (): boolean => true } : {}),
      allowlist: extAllowlist,
      reloadSession: reloadRunner,
    },
    hostCommandHandlers: [createClearHostCommand(), agentHostCommand, pluginHostCommand],
  };

  // pi-web 对 16 个能力面**全表态 use**(静态、可读);条件挂载的启停由各 factory 内部读
  // deps 决定,不在 decisions 里动态构造(D3)。漏任一 id → composeCapabilities 抛 missing-decision。
  const hostDecisions: Readonly<
    Record<string, CapabilityDecision<HostDeps, HostContribution>>
  > = Object.fromEntries(
    HOST_CAPABILITY_IDS_V1.map((id) => [id, { kind: "use" } as const]),
  );

  const hostContributions = composeCapabilities<HostDeps, HostContribution>({
    descriptors: defaultCapabilities(hostDeps),
    decisions: hostDecisions,
    deps: hostDeps,
    onDecline: (id, reason) =>
      hostAssemblyLogger.info("capability declined", { id, reason }),
  });
  const composedRoutes = hostContributions
    .filter((c): c is Extract<HostContribution, { kind: "route" }> => c.kind === "route")
    .map((c) => c.route);
  const composedCommands = hostContributions
    .filter((c): c is Extract<HostContribution, { kind: "command" }> => c.kind === "command")
    .map((c) => c.command);

  const defaultResourceAgent = (): ResourceAgentTarget | undefined =>
    resolveLocalAgentTarget({
      id: config.defaultCwd,
      source: config.defaultCwd,
      name: path.basename(config.defaultCwd) || "当前 Agent",
      kind: "dir",
    });
  const targetFromSourceRecord = (record: Awaited<ReturnType<typeof agentSourcesProvider.list>>[number]): ResourceAgentTarget | undefined => {
    const direct = resolveLocalAgentTarget(record);
    if (direct !== undefined) return direct;
    const installed = createInstalledRegistryIndex({ roots: sourcesScanRoots }).lookup(record.id);
    return installed === undefined
      ? undefined
      : resolveLocalAgentTarget({
          id: record.id,
          source: installed.dir,
          name: record.name,
          kind: "dir",
        });
  };
  const resolveResourceAgent = async (id: string): Promise<ResourceAgentTarget | undefined> => {
    if (id === "." || id === config.defaultCwd || id === "builtin:default-agent") {
      return defaultResourceAgent();
    }
    const records = await agentSourcesProvider.list();
    const direct = records.find((item) => item.id === id || item.source === id);
    const normalizedLocalId =
      id.includes("://") || id.startsWith("builtin:")
        ? undefined
        : path.resolve(config.defaultCwd, id);
    const record = direct ?? (normalizedLocalId === undefined
      ? undefined
      : records.find((item) => {
          if (item.kind !== "dir") return false;
          const candidates = [item.id, item.source];
          return candidates.some((candidate) => path.resolve(config.defaultCwd, candidate) === normalizedLocalId);
        }));
    if (record !== undefined) return targetFromSourceRecord(record);
    // 对齐会话创建侧契约(resolver.ts):任意绝对路径本地目录均可作为 agent 源加载,
    // resources 面板若只在扫描根内解析,则桌面版 source-picker 接受的路径必然 422。
    // 故绝对路径目录(存在即有效)回退为 ResourceAgentTarget;权限仍由 resourceAccess
    // 清单判定(resolveLocalAgentTarget → readAgentResourceAccess),无清单则只读。
    if (path.isAbsolute(id)) {
      return resolveLocalAgentTarget({
        id,
        source: id,
        name: path.basename(id) || "Agent",
        kind: "dir",
      });
    }
    return undefined;
  };
  const listResourceAgents = async (): Promise<readonly ResourceAgentTarget[]> => {
    const targets = new Map<string, ResourceAgentTarget>();
    const current = defaultResourceAgent();
    if (current !== undefined) targets.set(current.id, current);
    for (const record of await agentSourcesProvider.list()) {
      const target = targetFromSourceRecord(record);
      if (target !== undefined) targets.set(target.id, target);
    }
    return [...targets.values()];
  };

  const handler = createPiWebHandler({
    manager,
    store,
    // host 命令通道(server 侧执行,结果同步 HTTP 回流)。/clear = agent 上下文清空 +
    // 前端 clear-transcript;/agent 与 /plugin = 按命令名所指类别装/卸/列(spec
    // agent-plugin-commands,取代原 /install)。
    // M3:命令贡献经 composeCapabilities 分拣而来 —— host.commands 与 15 个路由能力面在
    // 同一次强制表态中一起被表态(spec host-contract-capability-composition,D5)。
    hostCommands: createHostCommandRegistry(composedCommands),
    // 附件元数据源:makeMessagesHandler 据请求 body.attachmentIds 经 head(id) 取
    // {id,mimeType,name} 注入 prompt 文本引用(attachment-tool-bridge task 5.2);
    // 与 vision/images base64 并存,不内联字节。
    attachmentStore,
    // Inject the real-mode entries (bootstrap runner + pi CLI) so resolved
    // custom/cli spawn specs are cwd-independent and never crash on a
    // placeholder path. In stub mode the resolved spec is discarded by
    // createChannel, but resolve() still runs without throwing.
    resolver: makeRealResolver(config, onlineSourceResolver),
    createChannel,
    // Cold-resume reader: POST /sessions { resumeId } loads {source, cwd, model}
    // from the configured SessionEntryStore (same SESSION_STORE backend) by id.
    loadResumeMeta: makeResumeMetaLoader(sessionStoreConfigFromEnv()),
    // 建会话时记下所属 agent-source(policySource),供列表显示来源与色条(Req 1.1)。
    sessionMetaIndex,
    // Inject config endpoints — schema-driven settings UI persistence.
    //  - GET/PUT /config/:domain → ~/.pi/agent/{auth,settings,sandbox}.json
    //    (sandbox = pi-sandbox 全局策略,方案 A)。codec 读 PI_WEB_AGENT_DIR
    //    (默认 ~/.pi/agent);adminPolicy 默认放行(P0)。
    //  - GET/PUT /config/sandbox/project[?cwd] → <cwd>/.pi/sandbox.json(方案 B +
    //    项目级覆盖)。cwd 缺省取所服务项目根,且限定在该子树内防越权写。
    //  - GET/PUT /config/extensions/{global,project} → settings.json 的 commands +
    //    顶层 per-扩展 KV 互映(全局 <agentDir>/settings.json,项目 <cwd>/.pi/settings.json)。
    routes: [
      // M3:15 个路由能力面经 composeCapabilities 强制表态后的产出
      // (spec host-contract-capability-composition,D5)。各能力面的原挂载条件(llm/ai/auth 的
      // 网关/登录门控)已内聚到 defaultCapabilities 对应 factory 内(读 hostDeps 可选字段),
      // 行为等价现状三元 `cond ? createX(...) : []`;secret 等惰性求值在 hostDeps 构造处完成。
      //
      // ★ 独立的 GET /aigc/models(image-toggles-field)与 GET /vision/models(canvas 解读)
      //   两个只读端点已随 multi-gateway-providers 任务 4.3(Req 3.1, 3.2, 3.4)删除 ——
      //   其能力由上面 `config.domains` 能力面挂载的 `GET /config/models?input=&output=`
      //   完全覆盖(config.mcp 之后进入的 composedRoutes 已含该端点,见 hostDeps.listModelOptions)。
      //   前端消费方(aigc-model-toggles-field / vision-model-select-field / canvas-ui
      //   vision-op)迁移到统一端点属后续任务(6.1-6.3),在其落地前旧路径会 404 ——
      //   这是本任务预期内的过渡态,不是遗留缺陷。
      ...composedRoutes,
      ...createResourceRoutes({
        manager: resourceManager,
        managerForAgent: (agentRoot) =>
          createPiResourceManager({
            cwd: agentRoot,
            agentDir: config.agentDir,
            companyRoot: companyResourceRoot,
          }),
        resolveAgent: async (id) => resolveResourceAgent(id),
        listAgents: async () => listResourceAgents(),
      }),
    ],
    // 资源权限与会话身份共用同一桌面身份端口；未配置云端时保持匿名本地态。
    authResolver: async () => {
      const state = await desktopIdentityProvider?.current();
      if (state?.kind === "authenticated") {
        return {
          anonymous: false,
          userId: state.tenant.userId,
          tenantId: state.tenant.companyId,
          companyId: state.tenant.companyId,
          role: state.tenant.role,
        };
      }
      return { anonymous: true };
    },
    // The app mounts the handler under `/api/**`; the handler's internal routes
    // are `/sessions/**` and `/config/**`, so strip the `/api` prefix.
    sse: { basePath: "/api" },
  });

  return { handler, manager };
}

function getSingleton(): HandlerSingleton {
  const g = globalThis as GlobalWithHandler;
  let singleton = g[GLOBAL_KEY];
  if (singleton === undefined) {
    singleton = buildSingleton();
    g[GLOBAL_KEY] = singleton;
  }
  return singleton;
}

/** Return the process-resident singleton handler. */
export function getHandler(): PiWebHandler {
  return getSingleton().handler;
}

/** Graceful shutdown passthrough (host SIGTERM). */
export async function shutdownHandler(): Promise<void> {
  const g = globalThis as GlobalWithHandler;
  await g[GLOBAL_KEY]?.manager.shutdown();
}
