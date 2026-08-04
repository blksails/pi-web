/**
 * logging-default — 服务端日志门控的「无配置文件」默认值（从 env 推导）。
 *
 * 语义：
 *  - `PI_WEB_LOG_ENABLED` 设置且值非 "false"（大小写不敏感）→ 开启；显式 "false" → 关闭。
 *    （与 `@blksails/logger` 的 initConfigFromEnv 对该变量的解析保持一致。）
 *  - 未设置该变量时：**dev 模式默认开启、生产默认关闭**（{@link isDevMode}）。
 *    dev 下开发者要看的就是日志，让他每次先去 Settings 翻开关是纯粹的摩擦；
 *    生产保持关闭（日志有序列化与 IO 成本，且可能含业务内容）。
 *  - `PI_WEB_LOG_LEVEL` 合法（debug/info/warn/error）则采用，否则回落 "info"。
 *  - `PI_WEB_LOG_NAMESPACES` 逗号分隔，列出的命名空间各置 true；为空则省略该字段。
 *
 * 纯函数（env 显式传入），便于单测；产物交给 loggingConfigSchema.parse 补齐其余默认。
 */

const VALID_LEVELS = ["debug", "info", "warn", "error"] as const;
type LogLevel = (typeof VALID_LEVELS)[number];

export interface LoggingEnvDefault {
  enabled: boolean;
  level: LogLevel;
  namespaces?: Record<string, boolean>;
}

/**
 * 是否 dev 模式。判据与 `rpc-channel/hot-reload.ts` 一致（`NODE_ENV !== "production"`）——
 * 同一个仓里对「什么算 dev」只应有一个判据，两处漂移会让「dev 才开」的特性在某些
 * 启动方式下神秘失效。
 */
export function isDevMode(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NODE_ENV !== "production";
}

export function resolveLoggingEnvDefault(
  env: Record<string, string | undefined> = process.env,
): LoggingEnvDefault {
  const rawEnabled = env.PI_WEB_LOG_ENABLED;
  const enabled =
    rawEnabled !== undefined ? rawEnabled.toLowerCase() !== "false" : isDevMode(env);

  const rawLevel = env.PI_WEB_LOG_LEVEL?.toLowerCase();
  const level: LogLevel = VALID_LEVELS.includes(rawLevel as LogLevel)
    ? (rawLevel as LogLevel)
    : "info";

  const rawNs = env.PI_WEB_LOG_NAMESPACES;
  const names = rawNs
    ? rawNs
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [];
  const namespaces =
    names.length > 0
      ? Object.fromEntries(names.map((n) => [n, true]))
      : undefined;

  return { enabled, level, ...(namespaces ? { namespaces } : {}) };
}

/** {@link resolveLoggingGate} 的结果:门控值 + **它为什么是这个值**。 */
export interface ResolvedLoggingGate {
  readonly enabled: boolean;
  /** 诊断用:`env` / `settings` / `dev-default` / `prod-default`。 */
  readonly source: "env" | "settings" | "dev-default" | "prod-default";
}

/**
 * 解析 `enabled` 的**唯一优先级**(高 → 低):
 *
 *  1. `PI_WEB_LOG_ENABLED` —— 运维显式覆盖,**压过已保存的 Settings**;
 *  2. Settings 里**显式保存过**的 `enabled`(用户主动选择);
 *  3. dev 模式默认 **开**;
 *  4. 生产默认 **关**。
 *
 * ★ 第 1 条是一处**修复**而非新行为:改造前 env 只在「配置文件缺失/为空」时才被读取,
 *   一旦 Settings 存过盘(哪怕存的只是默认值),`PI_WEB_LOG_ENABLED=1` 就完全失效 ——
 *   而调用处的注释白纸黑字写着「存在且非 false 时**强制开启**,无需经 Settings」。
 *   注释与代码分歧,且分歧的方向恰好让最常用的排查手段(临时加个 env 跑一次)静默失灵。
 *
 * ★ 第 2/3 条的区分依据是「字段在**原始** JSON 里是否出现」,不能用 schema.parse 之后的值 ——
 *   parse 会把缺省补成 false,那样「用户主动关」与「压根没设过」就永远分不开,dev 默认开
 *   也就永远不会生效。故判据取 raw。
 *
 * @param raw Settings 已保存的原始对象(未经 schema.parse);无配置传 `undefined`/`null`。
 */
export function resolveEnabledWithSource(
  raw: unknown,
  env: Record<string, string | undefined> = process.env,
): ResolvedLoggingGate {
  const rawEnabled = env.PI_WEB_LOG_ENABLED;
  if (rawEnabled !== undefined) {
    return { enabled: rawEnabled.toLowerCase() !== "false", source: "env" };
  }
  if (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as { enabled?: unknown }).enabled === "boolean"
  ) {
    return { enabled: (raw as { enabled: boolean }).enabled, source: "settings" };
  }
  return isDevMode(env)
    ? { enabled: true, source: "dev-default" }
    : { enabled: false, source: "prod-default" };
}
