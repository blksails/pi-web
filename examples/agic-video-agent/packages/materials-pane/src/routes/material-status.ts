/**
 * `material-status` —— 素材分发状态(**只读**)。
 *
 * 承接独立仓 aigc-agent `app/api/material-uploads` 的**读侧**语义:那边直接 `getServiceClient()`
 * 查 Supabase 四表(`public.material_sync_states` / `pilabs.material_distribute_runs` /
 * `public.material_sync_failures` / `public.advertisers`)后 `aggregateUploadStatus` 聚合。
 * 本仓不能照搬——子进程零凭证(见 ../platform-client.ts 文件头),故经回调 token 调父进程
 * `/api/internal/platform/materials/status`,由父进程做那次聚合。
 *
 * 只读到什么程度:**只有状态,没有动作**。发起分发与失败重试是写路径(会真的对外投放),
 * 不进本 route,也不进本 pane 的授权面;要接须另立写接缝并单独授权。
 *
 * 降级:平台接缝未接 / 回调失败 → `{ error:"platform_unavailable", items: [] }`。
 * guest 侧据此静默不显角标(只读增强,缺了不影响素材面板主功能)。
 *
 * 外部调用:GET /api/sessions/<sid>/agent-routes/material-status?ids=att_a,att_b
 */
import type { AgentRouteDecl, AgentRouteRequest } from "@blksails/pi-web-agent-kit";
import {
  MaterialsApplicationError,
  getMaterialsApplicationService,
  type MaterialsApplicationService,
} from "../application/index.js";

/** 单次查询的 id 上限:一屏素材远小于此,超出者截断而非报错(角标是增强,不值得整批失败)。 */
export const MAX_STATUS_IDS = 200;

/** `ids=a,b,a` → `["a","b"]`(去空、去重、截断)。非串入参一律视作空。 */
export function parseStatusIds(raw: unknown): string[] {
  if (typeof raw !== "string" || raw === "") return [];
  const out = new Set<string>();
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (id === "") continue;
    out.add(id);
    if (out.size >= MAX_STATUS_IDS) break;
  }
  return [...out];
}

export function createMaterialStatusHandler(
  service: MaterialsApplicationService = getMaterialsApplicationService(),
): (req: AgentRouteRequest) => Promise<unknown> {
  return async (req: AgentRouteRequest): Promise<unknown> => {
    const ids = parseStatusIds(req.query.ids);
    if (ids.length === 0) return { items: [] };
    try {
      return await service.query({ kind: "status", ids });
    } catch (error) {
      const known = error instanceof MaterialsApplicationError ? error : undefined;
      return {
        error: known?.code ?? "platform_unavailable",
        items: [],
        retryable: known?.retryable ?? true,
      };
    }
  };
}

export const materialStatusHandler = createMaterialStatusHandler();

/** 路由声明:文件名 material-status.ts === name「material-status」=== URL /agent-routes/material-status。 */
export const materialStatusRoute: AgentRouteDecl = {
  name: "material-status",
  // methods 缺省 → ["GET"](只读查询;分发/重试等写动作不在此)。
  description: "素材分发状态(只读台账聚合:已分发/分发中/失败;发起与重试不在此)",
  handler: materialStatusHandler,
};
