/**
 * e2bTransportConfigFromEnv — 从环境变量解析 `E2bTransportConfig`(Req 3.2/3.3)。
 *
 * 与既有 `*ConfigFromEnv` 纯函数同风格(如 `attachmentStoreConfigFromEnv`):不读
 * `process.env` 全局而消费传入的 env 快照,便于单测。缺 `E2B_API_KEY` 或 template 时
 * **抛携带修复指引的清晰错误**,绝不返回可用配置——避免「以为在沙盒里其实在本地」的
 * 静默回退(Req 3.3)。
 *
 * 读取的变量:
 *  - `E2B_API_KEY`(必需):e2b API key。
 *  - `PI_WEB_E2B_TEMPLATE`(必需):e2b template id(预装 node + pi + agent 源)。
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
 *  - `PI_WEB_E2B_RECONNECT_MS`(可选,仅 ws-runner):断线重连等待毫秒,默认 300。
 */
import type { E2bTransportConfig } from "./e2b-transport.js";
import type { SandboxWsTransportConfig } from "./sandbox-ws-transport.js";

/**
 * 已解析的 e2b 配置 —— 两种数据面传输(envd 的 `E2bTransport`、ws-runner 的
 * `SandboxWsTransport`)共享控制面字段,各自读所需子集。取二者交集类型,使同一配置对象
 * 可传给任一传输构造。
 */
export type ResolvedE2bConfig = E2bTransportConfig & SandboxWsTransportConfig;

/** e2b 数据面。`envd`=SDK commands.run(真实 e2b 云);`ws-runner`=WS 连沙箱内 agent-runner。 */
export type E2bDataPlane = "envd" | "ws-runner";

/** 缺配置时抛出的错误消息(集中一处,便于测试断言与文案维护)。 */
export const E2B_CONFIG_MISSING_MESSAGE =
  "PI_WEB_TRANSPORT=e2b 需要 E2B_API_KEY 与 PI_WEB_E2B_TEMPLATE。请设置这两个环境变量,或改用 PI_WEB_TRANSPORT=local(默认)。";

export function e2bTransportConfigFromEnv(
  env: Record<string, string | undefined>,
): ResolvedE2bConfig {
  const apiKey = trimmed(env.E2B_API_KEY);
  const template = trimmed(env.PI_WEB_E2B_TEMPLATE);
  if (apiKey === undefined || template === undefined) {
    throw new Error(E2B_CONFIG_MISSING_MESSAGE);
  }

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

  return {
    apiKey,
    template,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(runnerCmd !== undefined ? { runnerCmd } : {}),
    ...(sandboxCwd !== undefined ? { sandboxCwd } : {}),
    ...(envPassthrough.length > 0 ? { envPassthrough } : {}),
    ...(domain !== undefined ? { domain } : {}),
    ...(apiUrl !== undefined ? { apiUrl } : {}),
    ...(validateApiKey !== undefined ? { validateApiKey } : {}),
    ...(runnerPort !== undefined ? { runnerPort } : {}),
    ...(wsBase !== undefined ? { wsBase } : {}),
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
 * `{ mode: "e2b", config }`;**缺 `E2B_API_KEY`/template 时抛清晰错误,不静默回退 local**。
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
