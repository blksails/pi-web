import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WecomGatewayClient, DeliveryMode } from "../client.js";
import { resolveSessionId } from "../session-id.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined };
}

export function registerWecomSend(
  pi: ExtensionAPI,
  client: WecomGatewayClient,
  defaultChannelId: string,
): void {
  pi.registerTool({
    name: "wecom_send",
    label: "WeCom send",
    description:
      "Send a message to the enterprise WeChat (WeCom) thread bound to this session via pi-gateway. " +
      "Use when the user asks to push a notification, reminder, or proactive update to WeCom, " +
      "or when a scheduled job must notify the original chat. " +
      "If this session was started from WeCom, omit threadId and the gateway uses the session binding. " +
      "delivery=auto prefers passive reply when possible, otherwise active push; use active for timed jobs.",
    parameters: Type.Object({
      text: Type.String({
        description: "Markdown/plain text to send to WeCom (required).",
      }),
      delivery: Type.Optional(
        Type.String({
          description:
            "auto (default) | passive (requires live replyReqId) | active (sendMessage without req_id).",
        }),
      ),
      threadId: Type.Optional(
        Type.String({
          description:
            "Override target: WeCom userid (single) or chatid (group). " +
            "Omit to use the session's channel binding.",
        }),
      ),
      channelId: Type.Optional(
        Type.String({
          description: `Gateway channel id (default ${defaultChannelId}).`,
        }),
      ),
      idempotencyKey: Type.Optional(
        Type.String({
          description: "Optional key to avoid duplicate sends on retries.",
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
      const text = typeof params.text === "string" ? params.text : "";
      if (!text.trim()) {
        return textResult("wecom_send failed: text is required");
      }
      const deliveryRaw =
        typeof params.delivery === "string" ? params.delivery : "auto";
      const delivery = (
        ["auto", "passive", "active"].includes(deliveryRaw) ? deliveryRaw : "auto"
      ) as DeliveryMode;
      const threadId =
        typeof params.threadId === "string" && params.threadId.trim()
          ? params.threadId.trim()
          : undefined;
      const channelId =
        typeof params.channelId === "string" && params.channelId.trim()
          ? params.channelId.trim()
          : defaultChannelId;
      const idempotencyKey =
        typeof params.idempotencyKey === "string" ? params.idempotencyKey : undefined;

      const sessionId = resolveSessionId();
      const intent =
        threadId !== undefined
          ? {
              endpoint: {
                channelId,
                channelType: "wecom",
                threadId,
              },
              text,
              delivery,
              idempotencyKey,
              cause: "tool:wecom_send",
            }
          : sessionId
            ? {
                sessionId,
                text,
                delivery,
                idempotencyKey,
                cause: "tool:wecom_send",
              }
            : null;

      if (!intent) {
        return textResult(
          "wecom_send failed: no sessionId (not a channel-bound session) and no threadId override. " +
            "Pass threadId for active push, or run from a WeCom-originated session.",
        );
      }

      try {
        const result = await client.outbound(intent);
        if (!result.ok) {
          return textResult(
            `wecom_send failed: ${result.code} — ${result.message}`,
          );
        }
        return textResult(
          `wecom_send ok: delivery=${result.deliveryUsed} channel=${result.channelId} thread=${result.threadId}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return textResult(`wecom_send error: ${msg}`);
      }
    },
  });
}
