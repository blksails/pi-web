export const READINESS_PROBE_TIMEOUT_ENV = "PI_WEB_READINESS_PROBE_TIMEOUT_MS";

/** Positive integer override; invalid values preserve PiSession's 30s default. */
export function readinessProbeTimeoutFromEnv(
  env: Record<string, string | undefined>,
): number | undefined {
  const raw = env[READINESS_PROBE_TIMEOUT_ENV]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;

  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
