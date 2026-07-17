import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { WecomGatewayClient } from "../client.js";
import { resolveSessionId } from "../session-id.js";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined };
}

function sessionOrFail(params: Record<string, unknown>, tool: string): string | null {
  const sid =
    (typeof params.sessionId === "string" && params.sessionId.trim()) || resolveSessionId();
  if (!sid) {
    return null;
  }
  return sid;
}

function failNoSession(tool: string) {
  return textResult(
    `${tool}: no sessionId available (need current runner session or explicit sessionId). Cannot authorize without binding.`,
  );
}

function formatErr(tool: string, body: { code?: string; message?: string }): string {
  return `${tool} failed: ${body.code ?? "ERROR"} — ${body.message ?? JSON.stringify(body)}`;
}

export function registerWecomAdminTools(pi: ExtensionAPI, client: WecomGatewayClient): void {
  pi.registerTool({
    name: "wecom_admin_whoami",
    label: "WeCom admin whoami",
    description:
      "Return the IM userId and admin/user role for the current channel session (from gateway session binding). " +
      "Any bound user may call this.",
    parameters: Type.Object({
      sessionId: Type.Optional(Type.String({ description: "Defaults to current runner session" })),
    }),
    async execute(
      _id: string,
      params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ) {
      const sessionId = sessionOrFail(params, "wecom_admin_whoami");
      if (!sessionId) return failNoSession("wecom_admin_whoami");
      try {
        const r = await client.adminWhoami(sessionId);
        if ("role" in r && r.role) {
          return textResult(
            [
              "wecom_admin_whoami ok:",
              `- userId: ${r.userId}`,
              `- role: ${r.role}`,
              `- channelType: ${r.channelType}`,
              `- source: ${r.source ?? "(none)"}`,
            ].join("\n"),
          );
        }
        return textResult(formatErr("wecom_admin_whoami", r as { code?: string; message?: string }));
      } catch (err) {
        return textResult(
          `wecom_admin_whoami error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });

  pi.registerTool({
    name: "wecom_admin_list",
    label: "WeCom admin list",
    description:
      "List effective channel admins (baseline + runtime state). Requires admin role on the bound session.",
    parameters: Type.Object({
      sessionId: Type.Optional(Type.String()),
      channelType: Type.Optional(Type.String({ description: "Default wecom" })),
    }),
    async execute(
      _id: string,
      params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ) {
      const sessionId = sessionOrFail(params, "wecom_admin_list");
      if (!sessionId) return failNoSession("wecom_admin_list");
      const channelType =
        typeof params.channelType === "string" && params.channelType.trim()
          ? params.channelType.trim()
          : "wecom";
      try {
        const r = await client.adminList(sessionId, channelType);
        if ("admins" in r && Array.isArray(r.admins)) {
          const lines = r.admins.map((a) => `  - ${a.userId} (${a.source})`);
          return textResult(
            [`wecom_admin_list ok (${channelType}):`, ...lines].join("\n") ||
              `wecom_admin_list ok: (empty)`,
          );
        }
        return textResult(formatErr("wecom_admin_list", r as { code?: string; message?: string }));
      } catch (err) {
        return textResult(
          `wecom_admin_list error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });

  pi.registerTool({
    name: "wecom_admin_grant",
    label: "WeCom admin grant",
    description:
      "Grant runtime admin for a wecom userId (state file only; not baseline). Requires admin role. Identity is the bound session user, not this parameter as actor.",
    parameters: Type.Object({
      userId: Type.String({ description: "WeCom userid to add as state admin" }),
      sessionId: Type.Optional(Type.String()),
      channelType: Type.Optional(Type.String()),
    }),
    async execute(
      _id: string,
      params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ) {
      const sessionId = sessionOrFail(params, "wecom_admin_grant");
      if (!sessionId) return failNoSession("wecom_admin_grant");
      const userId = typeof params.userId === "string" ? params.userId.trim() : "";
      if (!userId) return textResult("wecom_admin_grant failed: userId required");
      try {
        const r = await client.adminGrant({
          sessionId,
          userId,
          channelType:
            typeof params.channelType === "string" ? params.channelType : undefined,
        });
        if (r.ok) {
          return textResult(
            `wecom_admin_grant ok: userId=${userId} code=${r.code ?? "OK"}`,
          );
        }
        return textResult(formatErr("wecom_admin_grant", r));
      } catch (err) {
        return textResult(
          `wecom_admin_grant error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });

  pi.registerTool({
    name: "wecom_admin_revoke",
    label: "WeCom admin revoke",
    description:
      "Revoke a runtime (state) admin. Cannot revoke baseline config/env admins. Requires admin role.",
    parameters: Type.Object({
      userId: Type.String({ description: "WeCom userid to remove from state roster" }),
      sessionId: Type.Optional(Type.String()),
      channelType: Type.Optional(Type.String()),
    }),
    async execute(
      _id: string,
      params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ) {
      const sessionId = sessionOrFail(params, "wecom_admin_revoke");
      if (!sessionId) return failNoSession("wecom_admin_revoke");
      const userId = typeof params.userId === "string" ? params.userId.trim() : "";
      if (!userId) return textResult("wecom_admin_revoke failed: userId required");
      try {
        const r = await client.adminRevoke({
          sessionId,
          userId,
          channelType:
            typeof params.channelType === "string" ? params.channelType : undefined,
        });
        if (r.ok) {
          return textResult(`wecom_admin_revoke ok: userId=${userId}`);
        }
        return textResult(formatErr("wecom_admin_revoke", r));
      } catch (err) {
        return textResult(
          `wecom_admin_revoke error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });

  pi.registerTool({
    name: "wecom_gateway_status",
    label: "WeCom gateway status (admin)",
    description:
      "Admin-gated gateway ops summary (channels, upstream healthy, bindings). Prefer wecom_gateway_health for unauthenticated probe-style checks.",
    parameters: Type.Object({
      sessionId: Type.Optional(Type.String()),
    }),
    async execute(
      _id: string,
      params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ) {
      const sessionId = sessionOrFail(params, "wecom_gateway_status");
      if (!sessionId) return failNoSession("wecom_gateway_status");
      try {
        const r = await client.adminStatus(sessionId);
        const errCode = (r as { code?: string; ok?: boolean }).code;
        const ok = (r as { ok?: boolean }).ok;
        if (ok === false || errCode === "NOT_ADMIN" || errCode === "NO_BINDING") {
          return textResult(formatErr("wecom_gateway_status", r as { code?: string; message?: string }));
        }
        if ("upstream" in r || ok === true) {
          const st = r as {
            version?: string;
            upstream?: { kind?: string; healthy?: boolean };
            bindings?: { forward?: number; reverse?: number };
            channels?: Array<{ id?: string; transport?: string }>;
          };
          const ch = (st.channels ?? [])
            .map((c) => `  - ${c.id}: ${c.transport ?? "?"}`)
            .join("\n");
          return textResult(
            [
              "wecom_gateway_status ok:",
              `- version: ${st.version ?? "?"}`,
              `- upstream.kind: ${st.upstream?.kind ?? "?"}`,
              `- upstream.healthy: ${String(st.upstream?.healthy ?? "?")}`,
              `- bindings: forward=${st.bindings?.forward ?? "?"} reverse=${st.bindings?.reverse ?? "?"}`,
              "- channels:",
              ch || "  (none)",
            ].join("\n"),
          );
        }
        return textResult(formatErr("wecom_gateway_status", r as { code?: string; message?: string }));
      } catch (err) {
        return textResult(
          `wecom_gateway_status error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });
}
