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
import {
  createPiWebHandler,
  type PiWebHandler,
  SessionManager,
  InMemorySessionStore,
  PiRpcProcess,
  // e2b 云沙盒传输(spec e2b-sandbox-transport):传输无关会话核心 + e2b adapter + 配置解析。
  PiRpcSession,
  E2bTransport,
  SandboxWsTransport,
  selectTransport,
  // 按 source 的三级沙箱模板解析(spec sandbox-baked-agent-image):map→派生→全局→清晰错误。
  resolveSandboxTemplate,
  AgentSourceResolver,
  resolvePiCliEntry,
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
  defaultAgentEntryPath,
  createAigcModelsRoute,
  createVisionModelsRoute,
  createHostCommandRegistry,
  ChildProcessPiCli,
  DEFAULT_ALLOWLIST,
  defaultOnAudit,
  redactReason,
  attachmentStoreConfigFromEnv,
  ATTACHMENT_PROFILE_DISABLED_ENV,
  // 附件拓扑条件透传判定(spec sandbox-baked-agent-image 任务 4.2):e2b 分支按拓扑
  // 本体 backend.kind 判「全远程」,与 attachmentStoreConfigFromEnv 同源同时机解析。
  ATTACHMENT_BACKENDS_ENV,
  parseBackendsEnv,
  resolveSandboxEntry,
  sessionStoreConfigFromEnv,
  ConfigCodec,
  // LLM 网关 provider 登记表 + secret 解析(HostDeps 构造 gateway.llm 用;路由工厂
  // createLlmGatewayRoutes 已移至 host-assembly/default-capabilities)。
  resolveLlmGatewayProviderTable,
  resolveLlmGatewaySecret,
  // ai-gateway 专属 provider 套件(spec ai-gateway-providers,任务 4.1):config 解析 +
  // 主对话转发路由 + Key 解析器 + 模型目录聚合,与 llm-gateway 分离共存,未配置
  // AI_GATEWAY_BASE_URL 时零注册(Req 1.1/1.2)。
  resolveAiGatewayConfig,
  EnvKeyResolver,
  GatewayModelCatalog,
  resolveAiGatewaySecret,
  // 目录组装服务(spec model-catalog,任务 3.1):chat/image 双命名空间的合并 + 过滤
  // 统一入口,GET /config/models 与 GET /aigc/models 均改经它取数。
  createModelCatalogService,
  // auth(desktop-cloud-login,任务 6.1):进程内登录态 + 鉴权注入路由。egress-model-source
  // (引 pi SDK)不在此,由 runner option-mapper 子路径直引。
  AuthSessionState,
  // M3 能力面装配(spec host-contract-capability-composition):强制表态引擎 + 冻结名册 + 表态类型。
  composeCapabilities,
  HOST_CAPABILITY_IDS_V1,
  type CapabilityDecision,
  type AllowlistConfig,
  type ResolvedSource,
  type SessionChannel,
  type CreateChannelOpts,
} from "@blksails/pi-web-server";
import { loggingConfigSchema } from "@blksails/pi-web-protocol";
import { configureLogger, createLogger } from "@blksails/pi-web-logger";
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
// 图像模型静态目录(self + 网关)经 tool-kit **主入口**(零 pi SDK、零 env 读取,前端安全,
// server 的 aigc-settings 路由同款引法):供 ModelCatalogService 的 image 命名空间组装
// (spec model-catalog,任务 3.1)。
import {
  AIGC_MODEL_CATALOG,
  AI_GATEWAY_AIGC_CATALOG,
} from "@blksails/pi-web-tool-kit";
// listVisionModelOptions 同理走子路径(它 import pi SDK):Canvas 提示词栏的视觉模型下拉
// (spec canvas-vision-readout)。薄路由 createVisionModelsRoute 从 barrel 取(纯类型 + 路由)。
import { listVisionModelOptions } from "@blksails/pi-web-server/vision-model-options";
import type { SpawnSpec } from "@blksails/pi-web-protocol";
import { loadConfig, type AppConfig } from "./config.js";
// LLM 网关凭据切换决策(spec sandbox-credentials-v2,任务 3.3):e2b 分支的
// providerKeysForE2b/sandboxLlmEnv 计算抽成纯函数,便于脱离真实传输单测。
import {
  computeE2bProviderEnv,
  deprecatedAigcProxyWarning,
} from "./llm-gateway-assembly.js";
// ai-gateway 会话 token 注入决策(spec ai-gateway-providers,design.md §2.5,任务 4.1):
// e2b 分支按会话铸造 scope="ai-gateway" token,注入沙箱可达 base + token(增量可选,
// 不替换任何既有 provider key,与 llm-gateway 的强制 credential-switch 语义不同)。
import { computeAiGatewaySessionEnv } from "./ai-gateway-assembly.js";
import {
  resolveCloudLoginConfig,
  computeAuthEgressSpawnEnv,
  RUNNER_CREDENTIAL_ENV,
} from "./auth-egress-assembly.js";
// 会话 token TTL 兜底(config.llmGateway 未配置时,ai-gateway token 生命周期仍需一个
// 保守默认值——沿用 llm-gateway 同一常量,语义详见 llm-gateway-config.ts 注释)。
import { DEFAULT_SANDBOX_TIMEOUT_MS } from "./llm-gateway-config.js";
// 扩展管理扩展文件路径解析(纯路径模块,不拉 pi SDK,安全进 Next bundle):
// spec extension-install-agent-tools —— 经 spawn env 下发给 agent 子进程强制注入。
import { extensionManagerEntryPath } from "@blksails/pi-web-tool-kit/extension-entry";
// 自动会话标题扩展文件路径解析(同样为纯路径模块,不拉 pi SDK):spec auto-session-title ——
// 总开关 PI_WEB_AUTO_TITLE 开启(默认)时经 spawn env 下发给 agent 子进程强制注入。
import { autoTitleEntryPath } from "@blksails/pi-web-tool-kit/auto-title-entry";
import { createClearHostCommand } from "./clear-host-command.js";
import {
  createInstallHostCommand,
  type InstallAuditEvent,
} from "./install-host-command.js";
import { createInstaller } from "../../server/cli/install/installer.js";
import { createPluginInstaller } from "../../server/cli/install/plugin-installer.js";
import { resolveSourcesRoot } from "../../server/cli/context.js";
import { resolveLoggingEnvDefault } from "./logging-default.js";
import { makeResumeMetaLoader } from "./resume-meta.js";
import { systemResourceArgs } from "./system-resource-args.js";

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
function makeRealResolver(config: AppConfig): {
  resolve: (
    source: string | undefined,
    opts?: { cwd?: string; trust?: boolean },
  ) => Promise<ResolvedSource>;
} {
  const runnerEntry = runnerBootstrapPath();
  const piCliEntry = resolvePiCliEntry();
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
  const baseEnv = process.env as Record<string, string>;
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
      return AgentSourceResolver.resolve(source, {
        cwd,
        runnerEntry,
        piCliEntry,
        agentDir,
        baseEnv,
        trustPolicy,
        // DTO `trust` → 显式信任意图;缺省时由 trustPolicy(信任库/trustedRoots/默认)决定。
        ...(opts?.trust !== undefined ? { requestTrust: opts.trust } : {}),
        ...(extraArgs.length > 0 ? { extraArgs } : {}),
      });
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

/**
 * agent-sources-list:解析 PI_WEB_SOURCES_ROOT 为绝对扫描根列表。
 * path.delimiter(: / ;)分隔多个;相对路径以 defaultCwd 绝对化;去空段。
 *
 * 未配 → 回落 `~/.pi-web/agents`(单元素)。显式配置**完全接管**(覆盖而非追加),保持既有语义。
 * 回落无需区分 dev/prod:`ScanSourceProvider` 的契约是「root 不存在/无法解析 → 跳过该 root」,
 * 故目录不存在时静默产出空列表,与改动前的 `[]` 行为一致。
 */
function resolveSourcesScanRoots(defaultCwd: string): readonly string[] {
  const raw = process.env.PI_WEB_SOURCES_ROOT;
  if (raw === undefined || raw.trim().length === 0) return [defaultSourcesRoot()];
  return raw
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (path.isAbsolute(s) ? s : path.resolve(defaultCwd, s)));
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
    createScanSourceProvider({ roots: resolveSourcesScanRoots(config.defaultCwd) }),
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
 * `--import jiti/register` lets the stub `.mjs` import the TS-source `@blksails/pi-web-server`
 * (no dist build) so it can persist/resume via the shared `SessionEntryStore`.
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
  // Run with cwd = @blksails/pi-web-server package dir so `--import jiti/register`
  // resolves jiti from the server package (pnpm does not hoist it to the app
  // root). The session cwd is conveyed separately via PI_WEB_STUB_CWD (used by
  // the stub to write the session header / piweb.session metadata).
  const serverPkgDir = path.dirname(runnerBootstrapPath());
  return {
    cmd: process.execPath,
    args: ["--import", "jiti/register", stubAgentPath()],
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

// M3 能力面装配日志(spec host-contract-capability-composition,D7):onDecline 时把弃用
// id + reason 记入启动日志(契约 §5.2)。pi-web 本地对 16 id 全 use 故不触发;为两端 decline 而设。
const hostAssemblyLogger = createLogger({ namespace: "server:host-assembly" });

function buildSingleton(): HandlerSingleton {
  const config = loadConfig();

  // ai-gateway 套件装配期配置解析(spec ai-gateway-providers,design.md §2.5,任务 4.1,
  // Req 1.1/1.2/1.4):未配置 AI_GATEWAY_BASE_URL → undefined(套件整体不注册);非法配置
  // (URL/优先级枚举/TTL 覆盖值)→ fail-fast 抛出(不吞错、不静默降级)。
  const aiGwConfig = resolveAiGatewayConfig(process.env);
  const aiGatewayKeyResolver = new EnvKeyResolver(process.env);

  // desktop-cloud-login(任务 6.1,Req 3.1/4.2/7.3):云端登录 egress 装配期配置解析。未配
  // PI_WEB_CLOUD_LOGIN_EGRESS_BASE → undefined(功能关闭、无登录入口,行为与今日一致);非法
  // → fail-fast 抛出。进程内登录态由启动 env(桌面壳经 base_env 播种 PI_WEB_DESKTOP_CREDENTIAL)
  // 初始化,鉴权端点运行时更新;会话 spawn 读同一实例注入 runner egress env。
  const cloudLoginConfig = resolveCloudLoginConfig(process.env);
  const authSessionState = new AuthSessionState();
  if (cloudLoginConfig !== undefined) {
    const seededCredential = process.env[RUNNER_CREDENTIAL_ENV];
    if (seededCredential !== undefined && seededCredential.trim().length > 0) {
      // 播种失败(非法/过期)静默忽略——保持未登录态,不阻断装配。
      authSessionState.set(seededCredential);
    }
  }
  const gatewayModelCatalog =
    aiGwConfig !== undefined
      ? new GatewayModelCatalog({
          baseUrl: aiGwConfig.baseUrl,
          ttlMs: aiGwConfig.catalogTtlMs,
          keyResolver: aiGatewayKeyResolver,
        })
      : undefined;

  // 目录组装服务(spec model-catalog,design.md「ModelCatalogService」,任务 3.1,
  // Req 1.1/4.1/4.3/5.1–5.4):chat(merge + hidden 过滤)与 image(静态∪网关,附 source)
  // 的统一取数入口。**每请求构造**以保持 PI_WEB_HIDE_PROVIDERS 的既有请求期求值语义
  // (原闭包即每请求 parseHiddenProviders,env 即时生效;service 零 IO 轻对象,每请求
  // new 无成本)。网关启用判别 = `aiGwConfig !== undefined`(AI_GATEWAY_BASE_URL 已配置),
  // 与路由挂载/runner 侧判据同源;未启用时 gatewayChat/gatewayImageCatalog 均不注入,
  // 两端点输出与主干逐字节一致(Req 1.3/4.3)。
  const makeModelCatalog = () =>
    createModelCatalogService({
      listSelfChat: () => listModelOptions(config.agentDir),
      gatewayChat: gatewayModelCatalog,
      modelPrecedence: aiGwConfig?.modelPrecedence,
      imageCatalog: AIGC_MODEL_CATALOG,
      gatewayImageCatalog:
        aiGwConfig !== undefined ? AI_GATEWAY_AIGC_CATALOG : undefined,
      hiddenProviders: parseHiddenProviders(process.env.PI_WEB_HIDE_PROVIDERS),
    });

  // 主进程自身 logger 的 runtime 门控:主进程不像 runner 那样调 initConfigFromEnv,
  // 库默认 enabled=true 会让 server 侧 createLogger(pi-session 等)无条件打到 server stderr。
  // 在此按同一 env 默认(PI_WEB_LOG_*,默认关)对齐,避免未开日志时刷终端;PI_WEB_LOG_ENABLED=1
  // 时主进程与 runner 同步开启。(注:此为主进程自身日志门控,runner 日志→UI 仍由
  // loggingConfigProvider/gateConfig 单独控制。)
  configureLogger(resolveLoggingEnvDefault());

  const store = new InMemorySessionStore(true);

  // 日志门控 provider（Req 6.4/6.5/6.6 / task 4.4）：每次新会话创建时读取最新配置。
  // 缺文件/空配置/读失败 → env 推导默认（日志默认**关闭**；`PI_WEB_LOG_ENABLED` 存在且
  // 非 "false" 时强制开启，无需经 Settings；级别/命名空间一并取自 PI_WEB_LOG_* env，
  // 见 resolveLoggingEnvDefault）。有内容 → parse(raw) 应用 Settings 已保存的配置。
  const loggingConfigProvider = async () => {
    try {
      const codec = new ConfigCodec(config.agentDir);
      const raw = await codec.load("logging");
      if (raw === null || typeof raw !== "object" || Object.keys(raw).length === 0) {
        return loggingConfigSchema.parse(resolveLoggingEnvDefault());
      }
      return loggingConfigSchema.parse(raw);
    } catch {
      return loggingConfigSchema.parse(resolveLoggingEnvDefault());
    }
  };

  // readinessHandshake: 开启会话就绪握手(spec session-readiness-handshake) —— 仅生产 app 接线开启,
  // 使前端在 agent 真正就绪前门控发送、就绪通告经粘性 session-status 帧投递。可经 env 关闭以回退。
  // snapshotAuthority: 开启会话权威快照(spec session-snapshot-authority) —— 仅生产 app 接线开启,
  // 使 busy/stats/lifecycle 经单一权威 session-state 帧投递、前端纯投影。可经 env 关闭以一步回退。
  // ⚠ 与 readinessHandshake 存在耦合:lifecycle 仅经 setLifecycle 入快照(后者在握手关闭时早返回),
  // 故若开此而关 readinessHandshake,snapshot.lifecycle 恒为 initializing。二者应同开同关(默认皆开)。
  const manager = new SessionManager({
    store,
    idleMs: 0,
    loggingConfigProvider,
    readinessHandshake: process.env.PI_WEB_DISABLE_READINESS_HANDSHAKE !== "1",
    snapshotAuthority: process.env.PI_WEB_DISABLE_SNAPSHOT_AUTHORITY !== "1",
  });

  // 强制注入:解析 pi-sandbox 入口一次(env 覆盖 > <agentDir>/npm/.../pi-sandbox/index.ts)。
  // 使沙箱 enforcement **不依赖** pi 默认扩展发现:cli 模式经 `-e <entry>` 显式加载;
  // custom 模式经 env `PI_WEB_SANDBOX_ENTRY` 由 runner option-mapper 追加到 additionalExtensionPaths。
  // 未安装时为 undefined → 跳过注入(不报错,行为回退到默认发现)。
  const sandboxEntry = resolveSandboxEntry(config.agentDir);
  // 扩展管理扩展入口(spec extension-install-agent-tools):强制注入每个会话,经 spawn env
  // 下发,runner option-mapper 加入 forcedExtensionPaths。解析不到(异常布局)→ undefined,跳过注入。
  const extToolsEntry = extensionManagerEntryPath();
  // 自动会话标题扩展入口(spec auto-session-title):总开关 PI_WEB_AUTO_TITLE 默认开,
  // 关闭(="0")时不解析、不下发 → 扩展根本不注入(服务端权威门控,零开销)。
  // 解析不到(异常布局)→ undefined,跳过注入,不阻塞会话创建。
  const autoTitleEnabled = process.env.PI_WEB_AUTO_TITLE !== "0";
  const autoTitleEntry = autoTitleEnabled ? autoTitleEntryPath() : undefined;

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
      const e2bSpec: SpawnSpec = {
        ...resolved.spawnSpec,
        env: {
          ...resolved.spawnSpec.env,
          ...providerKeysForE2b,
          ...sandboxLlmEnv,
          ...aiGatewaySessionEnv.env,
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
    const spec: SpawnSpec = {
      ...resolved.spawnSpec,
      args: [...resolved.spawnSpec.args, ...extraArgs],
      env: {
        ...resolved.spawnSpec.env,
        ...config.providerKeys,
        // custom 模式据此在 runner 内强制注入;cli 模式无害(由上面的 -e 生效)。
        ...(sandboxEntry !== undefined ? { PI_WEB_SANDBOX_ENTRY: sandboxEntry } : {}),
        // 扩展管理扩展入口 → runner forcedExtensionPaths(spec extension-install-agent-tools)。
        ...(extToolsEntry !== undefined ? { PI_WEB_EXT_TOOLS_ENTRY: extToolsEntry } : {}),
        // 自动会话标题扩展入口 → runner forcedExtensionPaths(spec auto-session-title)。
        ...(autoTitleEntry !== undefined ? { PI_WEB_AUTO_TITLE_ENTRY: autoTitleEntry } : {}),
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
        ...computeAuthEgressSpawnEnv(
          cloudLoginConfig,
          authSessionState.currentCredential(),
        ),
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
  const reloadRunner = async (session: {
    restartRunner(): Promise<void>;
  }): Promise<void> => {
    await session.restartRunner();
  };

  // /install host 命令(spec install-host-command):web 面按 kind 安装 agent/plugin,
  // 复用 CLI install 子域(createInstaller/createPluginInstaller 直调,零第二份编排)。
  // 治理与 REST /extensions 同源:extAllowlist(白名单)/extAllowMutate(admin 门)/extPiCli。
  // agent 落盘目标与 GET /agent-sources 的「扫描 ∪ 注册表」同值,装完选择器天然可见。
  const installRegistryPath =
    process.env.PI_WEB_SOURCES_REGISTRY ??
    path.join(config.agentDir, "sources.json");
  const installHostCommand = createInstallHostCommand({
    installer: createInstaller({
      allowlistConfig: extAllowlist,
      piCli: extPiCli,
      agentInstallerOptions: {
        sourcesRoot: resolveSourcesRoot(process.env, config.defaultCwd),
        registryPath: installRegistryPath,
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
    cwd: config.defaultCwd,
  });

  // ── M3:16 个能力面经 composeCapabilities 强制表态后装配(spec host-contract-capability-composition)──
  // HostDeps 一次构造(deps 并集,D4);条件挂载(llm/ai/auth)以**可选字段**表达——未配置时
  // 字段为 undefined,对应 factory 产空路由集(等价现状三元 `cond ? createX(...) : []`)。
  // secret 等惰性求值发生在此(未配置根本不构造),规避 resolveLlmGatewaySecret 在未配置时抛错。
  const hostDeps: HostDeps = {
    agentDir: config.agentDir,
    defaultCwd: config.defaultCwd,
    listModelOptions: () => makeModelCatalog().chatOptions(),
    resolveSourceSettings: makeSourceSettingsResolver(config),
    onSourceSettingsSaved: (sourceKeyValue, payload) =>
      broadcastSettingsChanged(manager.getStore(), sourceKeyValue, payload),
    sessionStoreConfig: sessionStoreConfigFromEnv(),
    sessionsGlobalEnabled:
      process.env.NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL === "true" ||
      process.env.NEXT_PUBLIC_PI_WEB_SESSIONS_GLOBAL === "1",
    sessionsManageEnabled:
      process.env.NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE !== "false" &&
      process.env.NEXT_PUBLIC_PI_WEB_SESSIONS_MANAGE !== "0",
    sourcesScanRoots: resolveSourcesScanRoots(config.defaultCwd),
    sourcesRegistryPath:
      process.env.PI_WEB_SOURCES_REGISTRY ??
      path.join(config.agentDir, "sources.json"),
    llmGateway: config.llmGateway?.serve
      ? {
          secret: resolveLlmGatewaySecret(process.env),
          registry: resolveLlmGatewayProviderTable(process.env),
        }
      : undefined,
    aiGateway:
      aiGwConfig !== undefined
        ? {
            baseUrl: aiGwConfig.baseUrl,
            secret: resolveAiGatewaySecret(process.env),
            keyResolver: aiGatewayKeyResolver,
            timeoutMs: aiGwConfig.timeoutMs,
          }
        : undefined,
    authState: cloudLoginConfig !== undefined ? authSessionState : undefined,
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
    hostCommandHandlers: [createClearHostCommand(), installHostCommand],
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

  const handler = createPiWebHandler({
    manager,
    store,
    // host 命令通道(server 侧执行,结果同步 HTTP 回流)。/clear = agent 上下文清空 +
    // 前端 clear-transcript;/install = 按 kind 装 agent/plugin(spec install-host-command,
    // 旧 agent 侧 /plugin 命令已随该 spec 摘除)。
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
    resolver: makeRealResolver(config),
    createChannel,
    // Cold-resume reader: POST /sessions { resumeId } loads {source, cwd, model}
    // from the configured SessionEntryStore (same SESSION_STORE backend) by id.
    loadResumeMeta: makeResumeMetaLoader(sessionStoreConfigFromEnv()),
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
      ...composedRoutes,
      // aigc.models / vision.models 不入 16 名册(集成设计 §5.4 判定为领域泄漏,删除属后续 spec)。
      // M3 维持其现状接线(compose 之外);Router 对 injected 顺序不敏感,置于末尾不影响行为。
      // ⚠ vision 端点还需 app/api/vision/[[...path]]/route.ts 转发器,否则静默 404。
      ...createAigcModelsRoute({
        listEntries: () => makeModelCatalog().imageEntries(),
      }),
      ...createVisionModelsRoute({
        listModels: () => listVisionModelOptions(config.agentDir),
      }),
    ],
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
