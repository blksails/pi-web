/**
 * aigc-canvas-agent — Canvas(aigc-canvas)的**端到端示例 agent**。
 *
 * 经 `extensions: [aigcExtension, visionExtension, canvasSurfaceExtension]` 同时装载:
 *  - `aigcExtension`:`image_generation` / `image_edit` 工具(LLM 生成图落 `att_`,即触发源 ①);
 *  - `visionExtension`:`image_vision` 工具 + `/img_vision` 命令(spec image-vision-tool)——
 *    画廊里的图对 LLM 只是 `att_` 文本标记,`image_vision` 让它真正「看见」某一张
 *    (取回字节 → 委派支持图像输入的模型 → 返回文字结论);
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
import { aigcSlashCompletions } from "@blksails/pi-web-tool-kit";
import {
  aigcExtension,
  canvasSurfaceExtension,
  visionExtension,
} from "@blksails/pi-web-tool-kit/runtime";
// 声明式 HTTP route 集中在 routes/ 子目录(一路由一文件),index.ts 只汇总不放 handler 逻辑。
// 见 docs/product/07-agent-development.md「声明式路由的文件组织」。
import { routes } from "./routes/index.js";

export default defineAgent({
  systemPrompt: [
    "You are aigc-canvas-agent, a pi-web example combining AIGC image tools with a Canvas surface.",
    "- Use `image_generation` to generate images; use `image_edit` to edit an uploaded image",
    "  (copy the public id from the [attachment id=att_… …] marker into the tool's `image`).",
    "- Use `image_vision` to *look at* an image in the gallery and answer a question about it.",
    "  Gallery images appear in your context only as [attachment id=att_… …] text markers —",
    "  you can read the id, NOT the pixels. Pass that id as `image` to actually see it",
    "  (omit `image` to look at the most recent one).",
    "Generated images land as attachments and are aggregated by the Canvas gallery.",
    "The user drives second-creation (edit / inpaint / variants / outpaint) directly in the",
    "Canvas workbench; those commands bypass the LLM. Keep chat replies concise.",
  ].join("\n"),
  // 进程内 ExtensionFactory 装载:AIGC 工具 + 视觉识别 + canvas 权威 surface。
  extensions: [aigcExtension, visionExtension, canvasSurfaceExtension],
  // slash 补全候选(/img-gen、/img-edit)。
  slashCompletions: aigcSlashCompletions,
  // agent 声明式 HTTP route(agent-declared-routes):routes/ 子目录汇总。
  // GET /api/sessions/:id/agent-routes/gallery-stats → 画廊统计 JSON(见 README)。
  routes,
  // Self-contained:关掉内置工具与磁盘 skills,保持示例 hermetic。
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
