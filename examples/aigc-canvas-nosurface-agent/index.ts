/**
 * aigc-canvas-nosurface-agent — Canvas 面板降级(unavailable)验证 fixture。
 *
 * 与 `aigc-canvas-agent` 的差异只有一处:**不装载 `canvasSurfaceExtension`**。
 * 因此该 agent 不注册 `surface:canvas` 探针命令 —— 前端 `useSurface` /
 * `WebExtSurfaceAccess.hasCommand("surface:canvas")` 求值为假 → 画廊面板退化为
 * 「只读图库(该 source 未提供 canvas surface)」态(Req 8.6/8.7 降级路径)。
 *
 * `.pi/web` 仍贡献 Canvas 入口(`CanvasLauncher`)与面板(`CanvasPanel`)—— 面板可见,
 * 但因无 surface 能力而降级。用于端到端证明「贡献面板但无 surface」的优雅退化。
 *
 * 仍装载 `aigcExtension`(`image_generation` / `image_edit` 工具)以保留一个真实的
 * 「无 canvas surface」的 AIGC agent 形态(非空壳)。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";
import { aigcSlashCompletions } from "@blksails/pi-web-tool-kit";
import { aigcExtension } from "@blksails/pi-web-tool-kit/runtime";

export default defineAgent({
  systemPrompt: [
    "You are aigc-canvas-nosurface-agent, a pi-web fixture with AIGC image tools but",
    "no Canvas surface. The Canvas panel is contributed but degrades to a read-only",
    "gallery because this agent does not register a canvas surface.",
  ].join("\n"),
  // 关键:只装 aigcExtension,不装 canvasSurfaceExtension → 无 surface:canvas 探针。
  extensions: [aigcExtension],
  slashCompletions: aigcSlashCompletions,
  noTools: "builtin",
  skills: ({ diagnostics }) => ({ skills: [], diagnostics }),
});
