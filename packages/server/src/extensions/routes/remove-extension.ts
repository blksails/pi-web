/**
 * extension-management — DELETE /extensions/:extId(卸载,Req 3.x/7.1/7.2/8.1）。
 *
 * 路径参数命名为 `:extId`(而非 `:id`),以避免 http-api Router 把它当作 sessionId 做
 * `store.get` 存在性校验 / 会话级授权——扩展 id 不是会话。本层经 `ctx.url` 取末段 extId。
 *
 * 编排:adminPolicy 门控 → 在已安装清单定位 extId(不存在 404,不执行)→ `pi remove`
 * (非交互)→ 成功 ack / 失败脱敏错误 → 审计(成功/失败/被拒绝)。
 */
import { errorResponse, jsonResponse } from "../../http/index.js";
import type { RequestContext, RouteHandler } from "../../http/index.js";
import type { AdminPolicy, OnAudit, PiCli } from "../ext.types.js";
import { assembleRemoveArgs } from "../install/install-args.js";
import { buildAuditRecord } from "../security/audit.js";

export interface RemoveExtensionDeps {
  readonly piCli: PiCli;
  readonly adminPolicy: AdminPolicy;
  readonly onAudit: OnAudit;
  readonly timeoutMs?: number;
}

/** 从 `/extensions/<extId>` 取末段并解码。 */
function extIdFromUrl(ctx: RequestContext): string {
  const segs = ctx.url.pathname.split("/").filter((s) => s.length > 0);
  const last = segs[segs.length - 1] ?? "";
  return decodeURIComponent(last);
}

export function makeRemoveExtensionHandler(
  deps: RemoveExtensionDeps,
): RouteHandler {
  return async (ctx: RequestContext): Promise<Response> => {
    const extId = extIdFromUrl(ctx);

    // 管理员门控(fail fast,执行任何命令前)。
    if (!deps.adminPolicy(ctx.auth)) {
      deps.onAudit(
        buildAuditRecord({
          auth: ctx.auth,
          action: "remove",
          source: extId,
          outcome: "rejected",
          reason: "admin authorization denied",
        }),
      );
      return ctx.auth.anonymous
        ? errorResponse(401, "UNAUTHORIZED", "Admin authentication required.")
        : errorResponse(403, "FORBIDDEN", "Admin authorization denied.");
    }

    // 存在性:在已安装清单定位 extId(不存在 → 404,不执行 pi remove)。
    let installed: readonly { id: string }[];
    try {
      installed = await deps.piCli.listExtensions();
    } catch (err) {
      const summary =
        err instanceof Error ? err.message : "failed to list extensions";
      return errorResponse(502, "EXT_LIST_FAILED", summary);
    }
    const match = installed.find((e) => e.id === extId);
    if (match === undefined) {
      return errorResponse(
        404,
        "EXTENSION_NOT_FOUND",
        `Extension "${extId}" is not installed.`,
      );
    }

    const { args, env } = assembleRemoveArgs(match.id);
    const result = await deps.piCli.runPiCommand(
      args,
      env,
      deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : undefined,
    );

    if (!result.ok) {
      const reason = result.errorSummary ?? "pi remove failed";
      deps.onAudit(
        buildAuditRecord({
          auth: ctx.auth,
          action: "remove",
          source: match.id,
          outcome: "failure",
          reason,
        }),
      );
      return errorResponse(500, "REMOVE_FAILED", reason);
    }

    deps.onAudit(
      buildAuditRecord({
        auth: ctx.auth,
        action: "remove",
        source: match.id,
        outcome: "success",
      }),
    );
    return jsonResponse(200, { ok: true });
  };
}
