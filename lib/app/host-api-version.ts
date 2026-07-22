declare const __PI_WEB_KIT_VERSION__: string | undefined;

function injectedHostApiVersion(): string | undefined {
  try {
    if (typeof __PI_WEB_KIT_VERSION__ === "string" && __PI_WEB_KIT_VERSION__.trim() !== "") {
      return __PI_WEB_KIT_VERSION__.trim();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function resolveHostApiVersion(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.NEXT_PUBLIC_PI_WEB_KIT_VERSION ?? env.PI_WEB_KIT_VERSION;
  if (override !== undefined && override.trim() !== "") return override.trim();

  const injected = injectedHostApiVersion();
  if (injected !== undefined) return injected;

  throw new Error(
    "[host-api-version] host web-kit version was not injected; set PI_WEB_KIT_VERSION for direct TypeScript execution",
  );
}
