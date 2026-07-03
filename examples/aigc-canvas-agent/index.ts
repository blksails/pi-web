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
 * 执行层经 `@blksails/pi-web-tool-kit/runtime` 子入口引入(含 pi SDK 值导入,仅 jiti 子进程加载,
 * 不进 Next 服务端 bundle)。model 省略 → 继承 ~/.pi/agent/settings.json 默认 provider/model。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { aigcSlashCompletions } from "@blksails/pi-web-tool-kit";
import { aigcExtension, canvasSurfaceExtension } from "@blksails/pi-web-tool-kit/runtime";

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
  // Self-contained:关掉内置工具与磁盘 skills,保持示例 hermetic。
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
