/**
 * Runtime config for talking to pi-gateway from an agent subprocess.
 */

export interface WecomGatewayConfig {
  /** e.g. http://127.0.0.1:7930 */
  baseUrl: string;
  /** Optional bearer / shared secret header value */
  token?: string;
  /** Default channel id when not specified by tool params */
  defaultChannelId: string;
}

export function resolveWecomGatewayConfig(
  env: NodeJS.ProcessEnv = process.env,
): WecomGatewayConfig {
  const baseUrl = (
    env.PI_GATEWAY_BASE_URL ||
    env.PI_GATEWAY_URL ||
    "http://127.0.0.1:7930"
  ).replace(/\/$/, "");
  const token = env.PI_GATEWAY_TOKEN?.trim() || undefined;
  const defaultChannelId = env.PI_GATEWAY_CHANNEL_ID?.trim() || "wecom";
  return { baseUrl, token, defaultChannelId };
}
