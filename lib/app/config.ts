/**
 * config — read & validate typed app configuration from `process.env`.
 *
 * Credential & default model resolution is delegated to the pi agent dir
 * (`~/.pi/agent`): the spawned agent process reads `auth.json` (API keys / OAuth
 * tokens stored by `pi` login) and `settings.json` (default provider / model,
 * installed packages, theme) itself. This app therefore does NOT require a
 * provider key in the environment — env provider keys, when present, are merely
 * passed through (additive) and never logged / echoed (Req 3.5).
 *
 *  - provider API keys (e.g. ANTHROPIC_API_KEY) — optional passthrough;
 *  - agentDir — the pi config dir (default `~/.pi/agent`) whose auth.json /
 *    settings.json the agent process consumes;
 *  - default provider / model — OPTIONAL env overrides; when unset, the agent
 *    process uses settings.json's defaults (so the UI honors your `pi` config);
 *  - the e2e stub-agent switch (`PI_WEB_STUB_AGENT`) for offline determinism.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export interface AppConfig {
  /** Provider env passed through to the session; never logged / echoed. Optional. */
  readonly providerKeys: Readonly<Record<string, string>>;
  /** pi config dir consumed by the agent process (auth.json / settings.json). */
  readonly agentDir: string;
  /** Optional provider override; when undefined, settings.json decides. */
  readonly defaultProvider: string | undefined;
  /** Optional model override; when undefined, settings.json's defaultModel decides. */
  readonly defaultModel: string | undefined;
  /** Default agent source (used when the user picks "default source"). */
  readonly defaultSource: string | undefined;
  /** Default working directory for sessions. */
  readonly defaultCwd: string;
  /** When true, sessions run against a deterministic stub agent (e2e). */
  readonly stubAgent: boolean;
  /**
   * When true, auto-create a session from `defaultSource` on first load and skip
   * the agent-source picker. Set by the CLI (`PI_WEB_AUTOSTART=1`) since it has
   * already determined the source; the user can still switch source in-session.
   */
  readonly autoStart: boolean;
}

/** Recognizable configuration error; its message never includes secret values. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const PROVIDER_KEY_NAMES = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
  "MISTRAL_API_KEY",
  "OPENROUTER_API_KEY",
  // DashScope(阿里云百炼/token-plan 兼容端点):沙盒基座镜像的 entrypoint 依赖此容器 env
  // 把 key 注入容器内 models.json(spec sandbox-baked-agent-image;e2b 分支 providerKeys
  // 键自动并入 envPassthrough → Sandbox.create envs → Pod spec env → entrypoint)。
  "DASHSCOPE_API_KEY",
] as const;

function isTruthy(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

/** Resolve the pi agent config dir (`~/.pi/agent` unless overridden). */
export function resolveAgentDir(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.PI_WEB_AGENT_DIR ??
    env.PI_CODING_AGENT_DIR ??
    join(homedir(), ".pi", "agent")
  );
}

/**
 * Load typed config. Never throws for "missing provider key": credentials are
 * resolved by the agent process from `~/.pi/agent/auth.json` (or env, additive).
 * If neither is available the agent process surfaces a recognizable auth error
 * through the event stream — the page still renders.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const stubAgent = isTruthy(env.PI_WEB_STUB_AGENT);

  const providerKeys: Record<string, string> = {};
  for (const name of PROVIDER_KEY_NAMES) {
    const value = env[name];
    if (value !== undefined && value.length > 0) providerKeys[name] = value;
  }

  return Object.freeze({
    providerKeys: Object.freeze({ ...providerKeys }),
    agentDir: resolveAgentDir(env),
    defaultProvider: env.PI_WEB_DEFAULT_PROVIDER,
    defaultModel: env.PI_WEB_DEFAULT_MODEL,
    // 未显式配置 source 时,回退到随包发布的内置 default-agent(custom 模式 → auto-title 等
    // runner 期特性生效),而非退回 "."(仓库根/任意 cwd 的 cli 模式,无标题)。见 resolver 的
    // `builtin:` 处理。部署方仍可用 PI_WEB_DEFAULT_SOURCE 覆盖为自己的 agent。
    defaultSource: env.PI_WEB_DEFAULT_SOURCE ?? "builtin:default-agent",
    defaultCwd: env.PI_WEB_DEFAULT_CWD ?? process.cwd(),
    stubAgent,
    autoStart: isTruthy(env.PI_WEB_AUTOSTART),
  });
}
