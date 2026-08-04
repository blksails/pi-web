/**
 * pane 声明模块(spec cli-agent-build 任务 5.1)——由 `pi-web build` 的 pane-discovery 经
 * `--panes panes-modules.ts` 显式求值(server/cli/build/pane-discovery.ts)。
 *
 * 与 aigc-canvas 同一份 pane 元信息;差别只有本 source 自己的入口(构建期多打包了贴纸
 * 插件捆,见 web/panes/main.tsx)与插件贡献命令的显式授予(style_transfer)。
 *
 * ★ 已知限制:入口跨目录复用 aigc-canvas-agent 的画布组件(web/panes/canvas.tsx),旧
 * build.ts 曾为此显式把 `examples/aigc-canvas-agent/web/**` 加进 Tailwind 内容扫描
 * (`extraContent`)。统一构建管线目前的 `PaneModule` 声明只有二态的 `canvasStyles` 样式
 * 开关,不支持声明额外的内容扫描路径 —— `server/cli/build/pane-discovery.ts`(任务 3.3)
 * 与 `index.ts`(任务 3.8)的画布样式一次性解析目前固定以 agent source 根为扫描基准
 * (超出本任务边界)。若画布组件在 canvas-plugin-stickers 自身目录树之外用到了未被扫描
 * 到的工具类,产物 CSS 可能缺类,需要后续补充 extraContent 透传后复验。
 */
import { canvasPaneMeta } from "../aigc-canvas-agent/pane-meta.js";

export default {
  id: "canvas-plugin-stickers",
  modules: [
    {
      id: canvasPaneMeta.id,
      title: canvasPaneMeta.title,
      icon: canvasPaneMeta.icon,
      entry: "./web/panes/main.tsx",
      canvasStyles: true,
      capabilities: {
        ...canvasPaneMeta.capabilities,
        surfaceCommands: [
          {
            domain: "canvas",
            actions: [
              ...(canvasPaneMeta.capabilities?.surfaceCommands?.[0]?.actions ?? []),
              // ★ 命令名是 style_transfer(下划线)——插件里的 `id: "style-transfer"` 是
              // 动作的 UI 标识,两者不是一回事,见旧 `web/panes/index.ts` 头注(已迁移保留)。
              "style_transfer",
            ],
          },
        ],
      },
    },
  ],
  panelConfig: { initialPaneIds: ["canvas"], maxOpenPanes: 4 },
};
