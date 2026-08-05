import type { PaneDefinitionInput } from "@blksails/pi-web-panes-kit";

/** 单 pane 可拔插单元：页面入口 + 权限元数据；document 由 build.ts 注入生成。 */
export interface AigcPaneModule {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
  readonly entry: string | URL;
  readonly capabilities: NonNullable<PaneDefinitionInput["capabilities"]>;
  /** 是否叠加 canvas-ui/Tailwind 样式。 */
  readonly canvasStyles?: boolean;
}
