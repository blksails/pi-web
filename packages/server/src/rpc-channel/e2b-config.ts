/**
 * e2bTransportConfigFromEnv — 从环境变量解析 `ResolvedE2bConfig`(Req 3.2/3.3;
 * spec sandbox-baked-agent-image Req 3.3/3.5:template 放宽 + 模板映射/派生配置面)。
 *
 * 与既有 `*ConfigFromEnv` 纯函数同风格(如 `attachmentStoreConfigFromEnv`):不读
 * `process.env` 全局而消费传入的 env 快照,便于单测。缺 `E2B_API_KEY` 时
 * **抛携带修复指引的清晰错误**,绝不返回可用配置——避免「以为在沙盒里其实在本地」的
 * 静默回退(Req 3.3)。template 可缺:缺失时**不在此抛**,终判移交会话创建路径的
 * `resolveSandboxTemplate`(三级解析后仍无才报错,错误文案含三种修复路径)。
 *
 * 读取的变量:
 *  - `E2B_API_KEY`(必需):e2b API key。
 *  - `PI_WEB_E2B_TEMPLATE`(可选):全局 e2b template id(预装 node + pi + agent 源);
 *    模板解析序的第三级回退(显式映射 → 门控派生 → 全局)。
 *  - `PI_WEB_E2B_TEMPLATE_MAP`(可选):JSON object,「source 标识 → 模板名」显式映射;
 *    非法 JSON / 非 object / 值非字符串 → 抛清晰错误,禁静默忽略(与 backends-config
 *    的 fail-fast 风格一致)。
 *  - `PI_WEB_E2B_TEMPLATE_DERIVE`(可选):="1" 时启用从 source 标识派生模板名的约定
 *    (默认关,避免既有部署解析到未注册模板名)。
 *  - `PI_WEB_E2B_TIMEOUT_MS`(可选):沙盒超时毫秒,非法数字忽略。
 *  - `PI_WEB_E2B_RUNNER_CMD`(可选):沙盒内启动 runner 的命令,默认 `pi --mode rpc`。
 *  - `PI_WEB_E2B_CWD`(可选):沙盒内 agent 工作目录。
 *  - `PI_WEB_E2B_ENV_PASSTHROUGH`(可选):逗号分隔的键白名单,从 spawnSpec.env 透传。
 *  - `PI_WEB_E2B_DOMAIN` / `E2B_DOMAIN`(可选):e2b 控制面域名(自托管/ACS 兼容端点);
 *    前者优先,回落后者。
 *  - `PI_WEB_E2B_VALIDATE_API_KEY`(可选):="false" 时关闭 SDK 的 `e2b_` key 格式校验
 *    (自托管/ACS 用 `sys-*` 等非 `e2b_` token 时须关);缺省不设(SDK 默认校验,对齐真实 e2b 云)。
 *  - `PI_WEB_E2B_DATAPLANE`(可选):`envd`(默认,commands.run/真实 e2b 云)| `ws-runner`
 *    (WS 连沙箱内 agent-runner;agent-sandbox/ACS 无 envd 时用)。
 *  - `PI_WEB_E2B_RUNNER_PORT`(可选,仅 ws-runner):沙箱内 runner 端口,默认 8080。
 *  - `PI_WEB_E2B_RUNNER_WS_BASE`(可选,仅 ws-runner):manager WS base(如 `ws://127.0.0.1:10000`);
 *    配则 manager-path 路由(agent-sandbox/ACS),否则 e2b-host(getHost,真实 e2b 云)。
 *  - `PI_WEB_E2B_RUNNER_WS_ROUTE`(可选,仅 ws-runner 且 wsBase 已配):`path`(默认,
 *    agent-sandbox 路径路由)| `header`(ACS sandbox-gateway 请求头路由,
 *    `e2b-sandbox-id`/`e2b-sandbox-port`;本机 port-forward 联调 ACS 用)。
 *  - `PI_WEB_E2B_RECONNECT_MS`(可选,仅 ws-runner):断线重连等待毫秒,默认 300。
 */
import type { E2bTransportConfig } from "./e2b-transport.js";
import type { SandboxWsTransportConfig } from "./sandbox-ws-transport.js";

/**
 * 已解析的 e2b 配置 —— 两种数据面传输(envd 的 `E2bTransport`、ws-runner 的
 * `SandboxWsTransport`)共享控制面字段,各自读所需子集。基于二者交集类型,但显式把
 * `template` 放宽为可选(两传输配置各自仍必填;pi-handler 在会话创建路径经
 * `resolveSandboxTemplate` 终判后覆写 template 再喂传输构造),并附加模板解析配置面
 * (`templateMap` / `templateDerive`,供 `resolveSandboxTemplate` 消费)。
 */
export type ResolvedE2bConfig = Omit<
  E2bTransportConfig & SandboxWsTransportConfig,
  "template"
> & {
  /** 全局 e2b template id(模板解析序第三级回退);三级解析前可缺。 */
  readonly template?: string;
  /** 「source 标识 → 模板名」显式映射(`PI_WEB_E2B_TEMPLATE_MAP`);未配置时省略。 */
  readonly templateMap?: Readonly<Record<string, string>>;
  /** 是否启用从 source 标识派生模板名(`PI_WEB_E2B_TEMPLATE_DERIVE` === "1")。 */
  readonly templateDerive: boolean;
};

/** e2b 数据面。`envd`=SDK commands.run(真实 e2b 云);`ws-runner`=WS 连沙箱内 agent-runner。 */
export type E2bDataPlane = "envd" | "ws-runner";

/** 缺配置时抛出的错误消息(集中一处,便于测试断言与文案维护)。 */
export const E2B_CONFIG_MISSING_MESSAGE =
  "PI_WEB_TRANSPORT=e2b 需要 E2B_API_KEY。请设置该环境变量,或改用 PI_WEB_TRANSPORT=local(默认)。";

export function e2bTransportConfigFromEnv(
  env: Record<string, string | undefined>,
): ResolvedE2bConfig {
  const apiKey = trimmed(env.E2B_API_KEY);
  if (apiKey === undefined) {
    throw new Error(E2B_CONFIG_MISSING_MESSAGE);
  }
  // template 可缺:终判移交会话创建路径的 resolveSandboxTemplate(三级解析)。
  const template = trimmed(env.PI_WEB_E2B_TEMPLATE);
  const templateMap = parseTemplateMap(env.PI_WEB_E2B_TEMPLATE_MAP);
  const templateDerive = trimmed(env.PI_WEB_E2B_TEMPLATE_DERIVE) === "1";

  const timeoutMs = parsePositiveInt(env.PI_WEB_E2B_TIMEOUT_MS);
  const runnerCmd = trimmed(env.PI_WEB_E2B_RUNNER_CMD);
  const sandboxCwd = trimmed(env.PI_WEB_E2B_CWD);
  const envPassthrough = parseCsv(env.PI_WEB_E2B_ENV_PASSTHROUGH);
  const domain = trimmed(env.PI_WEB_E2B_DOMAIN) ?? trimmed(env.E2B_DOMAIN);
  const apiUrl = trimmed(env.E2B_API_URL);
  // 仅当显式 ="false" 时关闭校验;其余(含未设)不注入该键,交 SDK 默认(true)。
  const validateApiKey =
    trimmed(env.PI_WEB_E2B_VALIDATE_API_KEY)?.toLowerCase() === "false"
      ? false
      : undefined;
  // ws-runner 专属字段。
  const runnerPort = parsePositiveInt(env.PI_WEB_E2B_RUNNER_PORT);
  const wsBase = trimmed(env.PI_WEB_E2B_RUNNER_WS_BASE);
  const reconnectDelayMs = parsePositiveInt(env.PI_WEB_E2B_RECONNECT_MS);
  // 仅认 "header";其余(含未设/"path")一律缺省 path 行为(不注入键)。
  const wsRoute =
    trimmed(env.PI_WEB_E2B_RUNNER_WS_ROUTE)?.toLowerCase() === "header"
      ? ("header" as const)
      : undefined;

  return {
    apiKey,
    templateDerive,
    ...(template !== undefined ? { template } : {}),
    ...(templateMap !== undefined ? { templateMap } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(runnerCmd !== undefined ? { runnerCmd } : {}),
    ...(sandboxCwd !== undefined ? { sandboxCwd } : {}),
    ...(envPassthrough.length > 0 ? { envPassthrough } : {}),
    ...(domain !== undefined ? { domain } : {}),
    ...(apiUrl !== undefined ? { apiUrl } : {}),
    ...(validateApiKey !== undefined ? { validateApiKey } : {}),
    ...(runnerPort !== undefined ? { runnerPort } : {}),
    ...(wsBase !== undefined ? { wsBase } : {}),
    ...(wsRoute !== undefined ? { wsRoute } : {}),
    ...(reconnectDelayMs !== undefined ? { reconnectDelayMs } : {}),
  };
}

/** 解析 e2b 数据面选择(`PI_WEB_E2B_DATAPLANE`,默认 envd)。 */
export function e2bDataPlaneFromEnv(
  env: Record<string, string | undefined>,
): E2bDataPlane {
  return trimmed(env.PI_WEB_E2B_DATAPLANE)?.toLowerCase() === "ws-runner"
    ? "ws-runner"
    : "envd";
}

/**
 * 传输后端选择结果(判别联合,spec e2b-sandbox-transport,Req 3.1/3.2)。
 * local 分支不携带配置(走既有本地进程);e2b 分支携带已解析的传输配置。
 */
export type TransportSelection =
  | { readonly mode: "local" }
  | {
      readonly mode: "e2b";
      readonly dataPlane: E2bDataPlane;
      readonly config: ResolvedE2bConfig;
    };

/**
 * 依 `PI_WEB_TRANSPORT` 选择执行传输后端(Req 3.1/3.2/3.3)。
 *
 * 未设置或非 `e2b` → `{ mode: "local" }`(默认零变化)。`=e2b` → 解析 e2b 配置并返回
 * `{ mode: "e2b", config }`;**缺 `E2B_API_KEY` 时抛清晰错误,不静默回退 local**
 * (template 缺失不在此抛,终判在 `resolveSandboxTemplate`)。
 *
 * 装配层应在**会话创建路径**(createChannel 被调用时)调用本函数,使缺配置以清晰错误
 * 让会话创建失败,而非在 app 启动期 fail-fast(Req 3.3 的「会话创建路径」措辞)。
 */
export function selectTransport(
  env: Record<string, string | undefined>,
): TransportSelection {
  const mode = (env.PI_WEB_TRANSPORT ?? "local").trim();
  if (mode !== "e2b") return { mode: "local" };
  return {
    mode: "e2b",
    dataPlane: e2bDataPlaneFromEnv(env),
    config: e2bTransportConfigFromEnv(env),
  };
}

/**
 * 解析 `PI_WEB_E2B_TEMPLATE_MAP`(JSON object:source 标识 → 模板名)。
 * 非法 JSON / 非 object / 值非字符串 → 抛携带变量名与修复指引的清晰错误,
 * 禁静默忽略(与 `parseBackendsEnv` 的 fail-fast 风格一致)。未设/纯空白 → undefined。
 */
function parseTemplateMap(
  raw: string | undefined,
): Readonly<Record<string, string>> | undefined {
  const v = trimmed(raw);
  if (v === undefined) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(v);
  } catch (err) {
    throw new Error(
      `PI_WEB_E2B_TEMPLATE_MAP 不是合法 JSON:${(err as Error).message}。期望形如 {"<source 标识>":"<模板名>"} 的 JSON object。`,
    );
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new Error(
      `PI_WEB_E2B_TEMPLATE_MAP 必须是 JSON object(形如 {"<source 标识>":"<模板名>"}),实际为 ${Array.isArray(json) ? "array" : json === null ? "null" : typeof json}。`,
    );
  }
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(json)) {
    if (typeof value !== "string") {
      throw new Error(
        `PI_WEB_E2B_TEMPLATE_MAP 的值必须全为字符串模板名,键 "${key}" 的值为 ${typeof value}。`,
      );
    }
    map[key] = value;
  }
  return map;
}

function trimmed(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim();
  return v.length > 0 ? v : undefined;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  const v = trimmed(raw);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function parseCsv(raw: string | undefined): readonly string[] {
  const v = trimmed(raw);
  if (v === undefined) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
