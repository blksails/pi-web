import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WecomGatewayClient } from "../client.js";
import { resolveSessionId } from "../session-id.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined };
}

function sanitizeTaskId(raw: string): string {
  const s = raw.replace(/[^0-9a-zA-Z_\-@]/g, "_").slice(0, 128);
  return s.length > 0 ? s : `task_${Date.now()}`;
}

/**
 * Single-chat menu via template_card button_interaction.
 * User taps button → WeCom event.template_card_event (handler can be added later).
 */
export function registerWecomSendMenu(
  pi: ExtensionAPI,
  client: WecomGatewayClient,
  defaultChannelId: string,
): void {
  pi.registerTool({
    name: "wecom_send_menu",
    label: "WeCom send menu",
    description:
      "Send an interactive button menu card to the WeCom single-chat user bound to this session. " +
      "Use for simple choices (approve/reject, pick an option). " +
      "Buttons: 1–6 items with text + key. " +
      "MVP: single chat only (threadId = userid).",
    parameters: Type.Object({
      title: Type.String({ description: "Card main title (e.g. 请选择操作)" }),
      desc: Type.Optional(Type.String({ description: "Optional subtitle under title" })),
      buttons: Type.Array(
        Type.Object({
          text: Type.String({ description: "Button label" }),
          key: Type.String({ description: "Callback key, e.g. approve / reject / opt_1" }),
        }),
        { minItems: 1, maxItems: 6, description: "Button list (1–6)" },
      ),
      taskId: Type.Optional(
        Type.String({
          description: "Stable task_id for correlating button events; auto-generated if omitted.",
        }),
      ),
      threadId: Type.Optional(
        Type.String({ description: "Override single-chat userid; omit for session binding." }),
      ),
      channelId: Type.Optional(Type.String()),
      idempotencyKey: Type.Optional(Type.String()),
    }),
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ) {
      const title = typeof params.title === "string" ? params.title.trim() : "";
      if (!title) return textResult("wecom_send_menu failed: title required");

      const buttonsRaw = Array.isArray(params.buttons) ? params.buttons : [];
      const buttons = buttonsRaw
        .map((b) => {
          if (!b || typeof b !== "object") return null;
          const row = b as { text?: string; key?: string };
          if (!row.text?.trim() || !row.key?.trim()) return null;
          return { text: row.text.trim(), key: row.key.trim() };
        })
        .filter((b): b is { text: string; key: string } => b !== null);
      if (buttons.length === 0) {
        return textResult("wecom_send_menu failed: at least one button {text,key} required");
      }
      if (buttons.length > 6) {
        return textResult("wecom_send_menu failed: max 6 buttons");
      }

      const desc = typeof params.desc === "string" ? params.desc.trim() : undefined;
      const taskId = sanitizeTaskId(
        typeof params.taskId === "string" && params.taskId.trim()
          ? params.taskId.trim()
          : `menu_${Date.now()}`,
      );
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

      // card_action is server-required (errcode 42045 if missing). PI-Smith live probe:
      // type:1 + placeholder url is known-good; type:0 acceptance unconfirmed.
      const templateCard: Record<string, unknown> = {
        card_type: "button_interaction",
        main_title: {
          title,
          ...(desc ? { desc } : {}),
        },
        button_list: buttons.map((b) => ({ text: b.text, key: b.key })),
        task_id: taskId,
        card_action: { type: 1, url: "https://work.weixin.qq.com/" },
      };

      const intent =
        threadId !== undefined
          ? {
              endpoint: { channelId, channelType: "wecom", threadId },
              kind: "template_card" as const,
              templateCard,
              delivery: "active" as const,
              idempotencyKey,
              cause: "tool:wecom_send_menu",
            }
          : sessionId
            ? {
                sessionId,
                kind: "template_card" as const,
                templateCard,
                delivery: "active" as const,
                idempotencyKey,
                cause: "tool:wecom_send_menu",
              }
            : null;

      if (!intent) {
        return textResult(
          "wecom_send_menu failed: no session binding and no threadId (single-chat userid).",
        );
      }

      try {
        const result = await client.outbound(intent);
        if (!result.ok) {
          return textResult(`wecom_send_menu failed: ${result.code} — ${result.message}`);
        }
        return textResult(
          `wecom_send_menu ok: thread=${result.threadId} task_id=${taskId} buttons=${buttons.map((b) => b.key).join(",")}`,
        );
      } catch (err) {
        return textResult(
          `wecom_send_menu error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });
}
