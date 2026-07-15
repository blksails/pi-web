import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WecomGatewayClient } from "../client.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined };
}

export function registerWecomHealth(pi: ExtensionAPI, client: WecomGatewayClient): void {
  pi.registerTool({
    name: "wecom_gateway_health",
    label: "WeCom gateway health",
    description:
      "Check pi-gateway health: WeCom channel connection/auth status, upstream (pi-web) health, and binding counts. " +
      "Use when WeCom delivery fails or to diagnose channel connectivity.",
    parameters: Type.Object({}),
    async execute(
      _toolCallId: string,
      _params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ) {
      try {
        const h = await client.health();
        const channels = (h.channels ?? [])
          .map(
            (c) =>
              `  - ${c.id}: transport=${c.transport ?? "?"} auth=${String(c.authenticated ?? "?")}`,
          )
          .join("\n");
        return textResult(
          [
            "wecom_gateway_health:",
            `- status: ${h.status ?? "?"}`,
            `- upstream.healthy: ${String(h.upstream?.healthy ?? "?")}`,
            `- upstream.agentSource: ${h.upstream?.agentSource ?? "?"}`,
            `- bindings: forward=${h.bindings?.forward ?? "?"} reverse=${h.bindings?.reverse ?? "?"}`,
            "- channels:",
            channels || "  (none)",
          ].join("\n"),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return textResult(`wecom_gateway_health error: ${msg}`);
      }
    },
  });
}
