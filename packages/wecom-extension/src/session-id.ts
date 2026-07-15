/**
 * Resolve the current pi-web session id inside an agent subprocess.
 * Runner receives `--session-id <uuid>`; we also honor PI_WEB_SESSION_ID env.
 */

export function resolveSessionId(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromEnv = env.PI_WEB_SESSION_ID?.trim() || env.PI_SESSION_ID?.trim();
  if (fromEnv) return fromEnv;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--session-id" && argv[i + 1]) {
      const v = argv[i + 1]!.trim();
      if (v) return v;
    }
    if (a?.startsWith("--session-id=")) {
      const v = a.slice("--session-id=".length).trim();
      if (v) return v;
    }
  }
  return undefined;
}
