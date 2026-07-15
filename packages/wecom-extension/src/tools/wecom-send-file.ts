import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WecomGatewayClient } from "../client.js";
import { resolveSessionId } from "../session-id.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined };
}

/**
 * Single-chat first: active push file to bound userid (or explicit threadId).
 */
export function registerWecomSendFile(
  pi: ExtensionAPI,
  client: WecomGatewayClient,
  defaultChannelId: string,
): void {
  pi.registerTool({
    name: "wecom_send_file",
    label: "WeCom send file",
    description:
      "Send a file to the WeCom (enterprise WeChat) user bound to this session (single chat first). " +
      "Provide a filesystem path readable by pi-gateway (same machine) or base64 content. " +
      "Optional caption text is sent as markdown after the file. " +
      "Prefer path for large files. Use when user asks to push a report/attachment to WeCom.",
    parameters: Type.Object({
      filename: Type.String({ description: "File name shown in WeCom, e.g. report.txt" }),
      path: Type.Optional(
        Type.String({
          description: "Absolute path on the machine running pi-gateway (preferred).",
        }),
      ),
      base64: Type.Optional(
        Type.String({
          description: "Base64 file bytes when path cannot be shared (small files only).",
        }),
      ),
      mediaType: Type.Optional(
        Type.String({
          description: "file (default) | image | voice | video",
        }),
      ),
      text: Type.Optional(
        Type.String({ description: "Optional caption markdown after the file." }),
      ),
      threadId: Type.Optional(
        Type.String({
          description: "Override userid (single chat). Omit to use session binding.",
        }),
      ),
      channelId: Type.Optional(Type.String({ description: "Gateway channel id." })),
      idempotencyKey: Type.Optional(Type.String()),
    }),
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ) {
      const filename = typeof params.filename === "string" ? params.filename.trim() : "";
      const path = typeof params.path === "string" ? params.path.trim() : undefined;
      const base64 = typeof params.base64 === "string" ? params.base64 : undefined;
      if (!filename) return textResult("wecom_send_file failed: filename required");
      if (!path && !base64) {
        return textResult("wecom_send_file failed: path or base64 required");
      }

      const mediaTypeRaw =
        typeof params.mediaType === "string" ? params.mediaType : "file";
      const mediaType = (["file", "image", "voice", "video"].includes(mediaTypeRaw)
        ? mediaTypeRaw
        : "file") as "file" | "image" | "voice" | "video";
      const text = typeof params.text === "string" ? params.text : undefined;
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
              endpoint: { channelId, channelType: "wecom", threadId },
              kind: "file" as const,
              file: { filename, path, base64, mediaType },
              text,
              delivery: "active" as const,
              idempotencyKey,
              cause: "tool:wecom_send_file",
            }
          : sessionId
            ? {
                sessionId,
                kind: "file" as const,
                file: { filename, path, base64, mediaType },
                text,
                delivery: "active" as const,
                idempotencyKey,
                cause: "tool:wecom_send_file",
              }
            : null;

      if (!intent) {
        return textResult(
          "wecom_send_file failed: no session binding and no threadId (single-chat userid).",
        );
      }

      try {
        const result = await client.outbound(intent);
        if (!result.ok) {
          return textResult(`wecom_send_file failed: ${result.code} — ${result.message}`);
        }
        return textResult(
          `wecom_send_file ok: thread=${result.threadId} file=${filename} delivery=${result.deliveryUsed}`,
        );
      } catch (err) {
        return textResult(
          `wecom_send_file error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });
}
