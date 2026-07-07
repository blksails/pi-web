/**
 * `gallery-stats` 声明式 HTTP route(agent-declared-routes,Req 6.1/6.3)。
 *
 * 文件目录标准(见 docs/product/07-agent-development.md「声明式路由的文件组织」):
 * 一路由一文件,文件名 === 路由 `name`(kebab-case)=== URL 段;文件内 co-locate handler +
 * `AgentRouteDecl`。handler 单独导出以便单测,decl 导出给 routes/index.ts barrel 汇总。
 *
 * handler 只在 agent 子进程内执行(主进程仅收纯数据声明,函数不过进程边界):从进程内 canvas
 * 状态接缝读当前画廊快照 —— `getSessionState()`(state-injection-bridge 的 globalThis seam)按
 * key `"surface:canvas"`(即 `surfaceStateKey("canvas")`,`createSurface` 每次写快照的同一 KV)
 * 取值,归纳为轻量统计 JSON(只有计数与标志,无二进制、无签名 URL)。
 *
 * 容错:seam 未装配 / canvas surface 尚未写入快照 → 返回稳定的零值结构(`note` 标注原因),
 * 绝不抛错;输出完全由快照决定(无时间戳等不稳定字段)。调用不进 LLM、不产生对话消息,
 * 对话 UI 无任何可见变化(Req 6.3)。
 */
import type { AgentRouteDecl } from "@blksails/pi-web-agent-kit";
import { getSessionState } from "@blksails/pi-web-tool-kit";
import type { GalleryState } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";

export function galleryStatsHandler(): unknown {
  const snapshot = getSessionState().get<GalleryState>("surface:canvas");
  if (snapshot === undefined || !Array.isArray(snapshot.assets)) {
    return {
      domain: "canvas",
      assets: 0,
      byOrigin: { upload: 0, "tool-output": 0 },
      generating: false,
      note: "canvas surface not registered",
    };
  }
  const byOrigin = { upload: 0, "tool-output": 0 };
  for (const asset of snapshot.assets) {
    if (asset.origin === "upload") byOrigin.upload += 1;
    else if (asset.origin === "tool-output") byOrigin["tool-output"] += 1;
  }
  return {
    domain: "canvas",
    assets: snapshot.assets.length,
    byOrigin,
    generating: snapshot.livePreview != null,
  };
}

/** 路由声明:文件名 gallery-stats.ts === name「gallery-stats」=== URL /agent-routes/gallery-stats。 */
export const galleryStatsRoute: AgentRouteDecl = {
  name: "gallery-stats",
  // methods 缺省 → ["GET"](只读查询)。
  description: "Canvas 画廊统计(资产计数/来源分布/是否生成中)",
  handler: galleryStatsHandler,
};
