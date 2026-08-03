/**
 * 就绪看门狗超时的 env 解析(spec runner-ready-frame,Req 4.2)。
 *
 * ★ rename 而非叠加:原 `PI_WEB_READINESS_PROBE_TIMEOUT_MS`(探针超时)随探针机制一并
 *   删除,不再读取 —— 语义已从「探针请求超时」变为「等待 runner_ready 帧的看门狗上限」,
 *   保留旧名是误导(运维 breaking,见 design Migration)。
 */
export const READY_TIMEOUT_ENV = "PI_WEB_READY_TIMEOUT_MS";

/** Positive integer override; invalid values preserve PiSession's 30s default. */
export function readyTimeoutFromEnv(
  env: Record<string, string | undefined>,
): number | undefined {
  const raw = env[READY_TIMEOUT_ENV]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;

  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
