/**
 * logging-default — 服务端日志门控的「无配置文件」默认值（从 env 推导）。
 *
 * 日志系统默认**关闭**：用户未在 Settings 保存 logging 配置时，服务端权威门控
 * 采用本函数的结果。语义：
 *  - `PI_WEB_LOG_ENABLED` 未设置 → 关闭；设置且值非 "false"（大小写不敏感）→ 开启。
 *    （与 `@blksails/logger` 的 initConfigFromEnv 对该变量的解析保持一致。）
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

export function resolveLoggingEnvDefault(
  env: Record<string, string | undefined> = process.env,
): LoggingEnvDefault {
  const rawEnabled = env.PI_WEB_LOG_ENABLED;
  const enabled =
    rawEnabled !== undefined ? rawEnabled.toLowerCase() !== "false" : false;

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
