/**
 * extension-management — POST /extensions(安装治理编排,Req 2.x/7.1/7.2/8.1/8.4/9.1）。
 *
 * 编排顺序(均在执行 `pi install` 之前完成门控/校验,fail fast):
 *   1) adminPolicy 管理员门控 → 非管理员 401/403 + "被拒绝"审计(Req 7.1/7.2/8.4)。
 *   2) protocol DTO 校验 source → 缺/非法 400(Req 2.2)。
 *   3) checkAllowlist 白名单 + 版本固定 → 拒绝即 422 + "被拒绝"审计(Req 2.3/2.4/8.4)。
 *   4) assembleInstallArgs(含 --ignore-scripts + 非交互 git env)→ pi-cli 执行(带超时)。
 *   5) 非零/超时 → 500 失败(脱敏)+ 失败审计;成功 → 200 + 成功审计(Req 2.5/2.6/8.1)。
 *
 * 扩展安装 = RCE;沙箱/容器隔离为生产硬化关注点(§11.2),本层引用而不实现(Req 9.1)。
 */
import { errorResponse, jsonResponse } from "../../http/index.js";
import type { RequestContext, RouteHandler } from "../../http/index.js";
import { validateBody } from "../../http/validate.js";
import type {
  AdminPolicy,
  AllowlistConfig,
  OnAudit,
  PiCli,
} from "../ext.types.js";
import { InstallExtensionRequestSchema } from "../ext.dto.js";
import { checkAllowlist } from "../install/source-allowlist.js";
import { assembleInstallArgs } from "../install/install-args.js";
import { buildAuditRecord } from "../security/audit.js";

export interface InstallExtensionDeps {
  readonly piCli: PiCli;
  readonly adminPolicy: AdminPolicy;
  readonly onAudit: OnAudit;
  readonly allowlist: AllowlistConfig;
  readonly timeoutMs?: number;
}

export function makeInstallExtensionHandler(
  deps: InstallExtensionDeps,
): RouteHandler {
  return async (ctx: RequestContext): Promise<Response> => {
    // 1) 管理员门控(在解析 body 前 fail fast)。
    if (!deps.adminPolicy(ctx.auth)) {
      deps.onAudit(
        buildAuditRecord({
          auth: ctx.auth,
          action: "install",
          source: "(unknown)",
          outcome: "rejected",
          reason: "admin authorization denied",
        }),
      );
      return ctx.auth.anonymous
        ? errorResponse(401, "UNAUTHORIZED", "Admin authentication required.")
        : errorResponse(403, "FORBIDDEN", "Admin authorization denied.");
    }

    // 2) DTO 校验。
    const parsed = await validateBody(ctx.req, InstallExtensionRequestSchema);
    if (!parsed.ok) {
      deps.onAudit(
        buildAuditRecord({
          auth: ctx.auth,
          action: "install",
          source: "(invalid)",
          outcome: "rejected",
          reason: "invalid install request body",
        }),
      );
      return parsed.response;
    }
    const rawSource = parsed.value.source;

    // 3) 白名单 + 版本固定。
    const decision = checkAllowlist(rawSource, deps.allowlist);
    if (!decision.allowed) {
      deps.onAudit(
        buildAuditRecord({
          auth: ctx.auth,
          action: "install",
          source: rawSource,
          outcome: "rejected",
          reason: decision.reason,
        }),
      );
      return errorResponse(422, "SOURCE_REJECTED", decision.reason);
    }

    // 4) 装配 + 执行。
    const { args, env } = assembleInstallArgs(decision.source);
    const result = await deps.piCli.runPiCommand(
      args,
      env,
      deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : undefined,
    );

    // 5) 结果 + 审计。
    if (!result.ok) {
      const reason = result.errorSummary ?? "pi install failed";
      deps.onAudit(
        buildAuditRecord({
          auth: ctx.auth,
          action: "install",
          source: decision.canonical,
          outcome: "failure",
          reason,
        }),
      );
      return errorResponse(500, "INSTALL_FAILED", reason);
    }

    deps.onAudit(
      buildAuditRecord({
        auth: ctx.auth,
        action: "install",
        source: decision.canonical,
        outcome: "success",
      }),
    );
    return jsonResponse(200, { ok: true, source: decision.canonical });
  };
}
