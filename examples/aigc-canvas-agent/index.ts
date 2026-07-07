/**
 * aigc-canvas-agent — Canvas(aigc-canvas)的**端到端示例 agent**。
 *
 * 经 `extensions: [aigcExtension, canvasSurfaceExtension]` 同时装载:
 *  - `aigcExtension`:`image_generation` / `image_edit` 工具(LLM 生成图落 `att_`,即触发源 ①);
 *  - `canvasSurfaceExtension`:`domain="canvas"` 的 AAS 实例——画廊 = attachment store 物化视图
 *    (`hydrate` 枚举重建 + `sync` reconcile + A/B 档二创命令),快照经 `control:"state"`
 *    (`key="surface:canvas"`)镜像下行,命令经 ui-rpc agent 转发路径上行(不过 LLM)。
 *
 * `.pi/web` 用 `launcherRail` 具名槽挂 Canvas 入口(`CanvasLauncher`)、`panelRight` 挂画廊/工作台
 * 面板(`CanvasPanel`,有 surface 接入);门控 `NEXT_PUBLIC_PI_WEB_CANVAS`。
 *
 * 另演示 **agent 声明式 HTTP route**(spec agent-declared-routes):`routes` 声明 `gallery-stats`
 * (GET),外部经 `GET /api/sessions/:id/agent-routes/gallery-stats` 拉画廊统计 JSON,handler 只在
 * agent 子进程内执行、不进 LLM、对话 UI 零可见变化(Req 6.1/6.3;见 README「Agent Routes 演示」)。
 *
 * 执行层经 `@blksails/pi-web-tool-kit/runtime` 子入口引入(含 pi SDK 值导入,仅 jiti 子进程加载,
 * 不进 Next 服务端 bundle)。model 省略 → 继承 ~/.pi/agent/settings.json 默认 provider/model。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { aigcSlashCompletions, getSessionState } from "@blksails/pi-web-tool-kit";
import { aigcExtension, canvasSurfaceExtension } from "@blksails/pi-web-tool-kit/runtime";
import type { GalleryState } from "@blksails/pi-web-tool-kit/aigc-canvas-schema";

/**
 * `gallery-stats` 演示 route handler(agent-declared-routes,Req 6.1/6.3)。
 *
 * 只在 agent 子进程内执行(主进程仅收纯数据声明,handler 函数不过进程边界):从进程内 canvas
 * 状态接缝读当前画廊快照 —— `getSessionState()`(state-injection-bridge 的 globalThis seam)按
 * key `"surface:canvas"`(即 `surfaceStateKey("canvas")`,`createSurface` 每次写快照的同一 KV)
 * 取值,归纳为轻量统计 JSON(只有计数与标志,无二进制、无签名 URL)。
 *
 * 容错:seam 未装配 / canvas surface 尚未写入快照 → 返回稳定的零值结构(`note` 标注原因),
 * 绝不抛错;输出完全由快照决定(无时间戳等不稳定字段)。调用不进 LLM、不产生对话消息,
 * 对话 UI 无任何可见变化(Req 6.3)。
 */
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

export default defineAgent({
  systemPrompt: [
    "You are aigc-canvas-agent, a pi-web example combining AIGC image tools with a Canvas surface.",
    "- Use `image_generation` to generate images; use `image_edit` to edit an uploaded image",
    "  (copy the public id from the [attachment id=att_… …] marker into the tool's `image`).",
    "Generated images land as attachments and are aggregated by the Canvas gallery.",
    "The user drives second-creation (edit / inpaint / variants / outpaint) directly in the",
    "Canvas workbench; those commands bypass the LLM. Keep chat replies concise.",
  ].join("\n"),
  // 进程内 ExtensionFactory 装载:AIGC 工具 + canvas 权威 surface。
  extensions: [aigcExtension, canvasSurfaceExtension],
  // slash 补全候选(/img-gen、/img-edit)。
  slashCompletions: aigcSlashCompletions,
  // agent 声明式 HTTP route(agent-declared-routes):
  // GET /api/sessions/:id/agent-routes/gallery-stats → 画廊统计 JSON(见 README)。
  routes: [
    {
      name: "gallery-stats",
      // methods 缺省 → ["GET"](只读查询)。
      description: "Canvas 画廊统计(资产计数/来源分布/是否生成中)",
      handler: galleryStatsHandler,
    },
  ],
  // Self-contained:关掉内置工具与磁盘 skills,保持示例 hermetic。
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
