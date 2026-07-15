import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WecomGatewayClient } from "../client.js";
import { resolveSessionId } from "../session-id.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined };
}

export function registerWecomGetBinding(
  pi: ExtensionAPI,
  client: WecomGatewayClient,
): void {
  pi.registerTool({
    name: "wecom_get_binding",
    label: "WeCom binding",
    description:
      "Look up whether this pi-web session is bound to a WeCom (enterprise WeChat) channel endpoint. " +
      "Returns channelId, threadId, origin, and allowActivePush. " +
      "Use before wecom_send when you need to know if proactive WeCom delivery is available.",
    parameters: Type.Object({
      sessionId: Type.Optional(
        Type.String({
          description: "Session id to query; omit to use the current runner session.",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ) {
      const sessionId =
        (typeof params.sessionId === "string" && params.sessionId.trim()) ||
        resolveSessionId();
      if (!sessionId) {
        return textResult(
          "wecom_get_binding: no sessionId available (not running under pi-web runner with --session-id).",
        );
      }
      try {
        const b = await client.getBinding(sessionId);
        if (!b) {
          return textResult(
            `wecom_get_binding: NO_BINDING for session ${sessionId} (web-only or unbound session; wecom_send needs threadId override).`,
          );
        }
        return textResult(
          [
            "wecom_get_binding ok:",
            `- sessionId: ${b.sessionId}`,
            `- origin: ${b.origin}`,
            `- channelId: ${b.endpoint.channelId}`,
            `- channelType: ${b.endpoint.channelType}`,
            `- threadId: ${b.endpoint.threadId}`,
            `- userId: ${b.endpoint.userId ?? "(none)"}`,
            `- allowActivePush: ${b.allowActivePush}`,
            `- agentSource: ${b.agentSource ?? "(none)"}`,
          ].join("\n"),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return textResult(`wecom_get_binding error: ${msg}`);
      }
    },
  });
}
