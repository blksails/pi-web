/**
 * aigc-canvas-agent — Canvas(aigc-canvas)的**端到端示例 agent**,已迁到隔离 Pane 形态
 * (spec isolated-panes Wave 5)。
 *
 * ## 迁移前后
 *
 * 迁移前:三个扩展在 `extensions:` 平铺、`routes` 另列一处;`.pi/web` 用 `launcherRail`
 * + `panelRight` 两个具名槽把 Canvas 渲染在**宿主同一 JS realm** 里。
 *
 * 迁移后:canvas 域收敛成一个 `PaneAgentModule`(`panes-modules.ts`)——「pane 元信息 +
 * 它自带的 extensions + 它自带的 routes」绑成一体,`composePaneAgentModules` 在**装配期**
 * 校验覆盖;UI 侧改由 `PanesHost` 在 `panelRight` 承载,画廊跑在**独立 iframe**,数据只经
 * 三条受授权的通道往返(Agent Routes / Surface / 附件),不再共享 realm。
 *
 * 三个扩展的职责不变:
 *  - `aigcExtension`:`image_generation` / `image_edit` 工具(生成图落 `att_`);
 *  - `visionExtension`:`image_vision` 工具 + `/img_vision` 命令 —— 画廊里的图对 LLM 只是
 *    `att_` 文本标记,该工具让它真正「看见」某一张(取回字节 → 委派支持图像输入的模型);
 *  - `canvasSurfaceExtension`:`domain="canvas"` 的 AAS 实例(画廊 = attachment store 物化视图,
 *    `hydrate` 枚举重建 + `sync` reconcile + A/B 档二创命令)。
 *
 * 声明式 HTTP route `gallery-stats` 也不变,但主调用方从「外部 curl」变成 **pane 自己**
 * (`guest.query("gallery-stats")`),且必须先在 `pane-meta.ts` 的 `capabilities.routes` 里
 * 被授予 —— 未授予的 route,pane 侧收到的是 `CAPABILITY_DENIED` 而非数据。
 *
 * 执行层经 `@blksails/pi-web-tool-kit/runtime` 子入口引入(含 pi SDK 值导入,仅 jiti 子进程
 * 加载,不进服务端 bundle)。model 省略 → 继承 ~/.pi/agent/settings.json 默认 provider/model。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { aigcSlashCompletions } from "@blksails/pi-web-tool-kit";
import { composePaneAgentModules } from "@blksails/pi-web-tool-kit/runtime";
import { paneModules } from "./panes-modules.js";

// pane 自带 tools:extensions/routes 由各 PaneAgentModule 声明,一次 compose 即用。
// 新增 pane 只需在 panes-modules.ts 加一行,此处不动。
const composed = composePaneAgentModules(paneModules);

export default defineAgent({
  systemPrompt: [
    "You are aigc-canvas-agent, a pi-web example combining AIGC image tools with a Canvas pane.",
    "- Use `image_generation` to generate images; use `image_edit` to edit an uploaded image",
    "  (copy the public id from the [attachment id=att_… …] marker into the tool's `images`).",
    "  `image_edit` takes a single `images` array of att_ ids and/or URLs: the FIRST entry is the",
    "  image being edited, every further entry is a style/character-consistency reference. Collect",
    "  the ids the same way (from the [attachment id=att_… …] markers) and pass as many as you need;",
    "  there is no fixed local limit — the accepted count is decided by the provider/model.",
    "- Use `image_vision` to *look at* an image in the gallery and answer a question about it.",
    "  Gallery images appear in your context only as [attachment id=att_… …] text markers —",
    "  you can read the id, NOT the pixels. Pass that id as `image` to actually see it",
    "  (omit `image` to look at the most recent one).",
    "Generated images land as attachments and are aggregated by the Canvas gallery pane.",
    "The user drives second-creation (edit / inpaint / variants / outpaint) directly in the",
    "Canvas pane; those commands bypass the LLM. Keep chat replies concise.",
  ].join("\n"),
  extensions: [...composed.extensions],
  // slash 补全候选(/img-gen、/img-edit)。
  slashCompletions: aigcSlashCompletions,
  routes: composed.routes,
  // Self-contained:关掉内置工具与磁盘 skills,保持示例 hermetic。
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
