/**
 * @blksails/pi-web-wecom — pi ExtensionFactory for WeCom interaction tools.
 *
 * Tools talk to pi-gateway (`POST /api/outbound`, binding lookup, /health).
 * LLM never needs the outbound schema for normal turn replies; these tools are
 * for proactive notify / binding inspection / diagnostics.
 *
 * Load via agent `extensions: [wecomExtensionEntryPath()]` or absolute path to this file.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WecomGatewayClient } from "./client.js";
import { resolveWecomGatewayConfig } from "./config.js";
import { registerWecomGetBinding } from "./tools/wecom-get-binding.js";
import { registerWecomHealth } from "./tools/wecom-health.js";
import { registerWecomSend } from "./tools/wecom-send.js";
import { registerWecomSendFile } from "./tools/wecom-send-file.js";
import { registerWecomSendMenu } from "./tools/wecom-send-menu.js";

export { WecomGatewayClient } from "./client.js";
export type {
  ChannelEndpoint,
  DeliveryMode,
  OutboundIntent,
  OutboundResult,
  SessionChannelBinding,
} from "./client.js";
export { resolveWecomGatewayConfig } from "./config.js";
export { resolveSessionId } from "./session-id.js";
export { wecomExtensionEntryPath } from "./entry-path.js";

/**
 * Default export: ExtensionFactory for pi forcedExtensionPaths / agent.extensions.
 */
export default function wecomExtension(pi: ExtensionAPI): void {
  const config = resolveWecomGatewayConfig();
  const client = new WecomGatewayClient(config);

  registerWecomSend(pi, client, config.defaultChannelId);
  registerWecomSendFile(pi, client, config.defaultChannelId);
  registerWecomSendMenu(pi, client, config.defaultChannelId);
  registerWecomGetBinding(pi, client);
  registerWecomHealth(pi, client);

  pi.registerCommand("wecom-status", {
    description: "Show pi-gateway / WeCom channel health (same as wecom_gateway_health tool)",
    handler: async (_args, ctx) => {
      try {
        const h = await client.health();
        const ch = (h.channels ?? [])
          .map((c) => `${c.id}:${c.transport ?? "?"}/${c.authenticated ? "auth" : "noauth"}`)
          .join(", ");
        ctx.ui.notify(
          `gateway=${h.status} upstream=${String(h.upstream?.healthy)} channels=[${ch}]`,
          "info",
        );
      } catch (err) {
        ctx.ui.notify(
          `wecom-status failed: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    },
  });
}
