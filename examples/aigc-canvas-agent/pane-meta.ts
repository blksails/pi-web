/**
 * Canvas pane 的元信息 —— **单一事实源**(web-safe,仅类型依赖):
 *  - web 侧(`web/panes/index.ts`)展开成完整 `PaneDefinition`(注入 document/lifecycle);
 *  - agent 侧(`panes-modules.ts`)作 `PaneAgentModule` 身份与 route 覆盖校验。
 *
 * 与 `examples/panes-agent/pane-meta.ts` 的差别在 `capabilities.routes`:那边 canvas pane
 * 是 `routes: []`(纯 surface 驱动),这里显式授予 `gallery-stats`。也就是说本示例是仓内
 * **唯一**会真正触发 `composePaneAgentModules` 那条「pane 声明了 route 却没人提供 → 抛错」
 * 校验的 canvas pane —— 把 `routes/gallery-stats.ts` 从 `panes-modules.ts` 里摘掉,装配期
 * 立刻炸,而不是等到运行时 pane 调用才 404。
 */
import type { PaneDefinitionInput } from "@blksails/pi-web-panes-kit/contract";

export type PaneMeta = Omit<PaneDefinitionInput, "document" | "lifecycle">;

export const canvasPaneMeta: PaneMeta = {
  id: "canvas",
  title: "画廊",
  icon: "🖼️",
  // 画廊是这个 agent 的主工作台,同时开多个实例没有意义(它们看的是同一份 surface 快照)。
  allowMultiple: false,
  maxInstances: 1,
  capabilities: {
    // 画廊统计经声明式 HTTP route 读取(pane → route.query,不过 LLM)。
    routes: [{ name: "gallery-stats", methods: ["GET"] }],
    // domain="canvas" 的 AAS 快照:pane 订阅它重建画廊。
    surfaceKeys: ["surface:canvas"],
    // 二创命令(A/B/C 档)经 surface.run 上行,同样不过 LLM。
    surfaceCommands: [
      {
        domain: "canvas",
        actions: [
          "sync",
          "register",
          "edit",
          "inpaint",
          "reference",
          "variants",
          "outpaint",
          "reframe",
          "delete",
        ],
      },
    ],
    // 上传原图 → 附件;二创产物同样落附件。
    attachments: "read-write",
    // 「解读」等按钮会把提示词发回对话。
    conversation: "submit",
  },
};
