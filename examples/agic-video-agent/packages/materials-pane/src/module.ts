import type { PaneDefinitionInput } from "@blksails/pi-web-panes-kit";
import { CANVAS_OPEN_ATTACHMENTS_EVENT, SESSION_LOCATE_EVENT } from "./events.js";

export interface MaterialsPaneModule {
  readonly id: string;
  readonly title: string;
  readonly icon: string;
  /** 源文件 URL 使包被复制或安装到任意位置后仍能直接交给 pane 构建器。 */
  readonly entry: URL;
  readonly capabilities: NonNullable<PaneDefinitionInput["capabilities"]>;
}

export const materialsPaneModule: MaterialsPaneModule = {
  id: "materials",
  title: "素材",
  icon: "images",
  entry: new URL("./guest.tsx", import.meta.url),
  capabilities: {
    routes: [
      { name: "assets-list", methods: ["GET"] },
      { name: "materials-library", methods: ["GET", "POST"] },
      { name: "material-status", methods: ["GET"] },
    ],
    surfaceKeys: ["surface:materials"],
    surfaceCommands: [
      {
        domain: "materials",
        actions: [
          "select",
          "set-filter",
          "create-folder",
          "rename-folder",
          "move-folder",
          "delete-folder",
          "move-items",
          "rename-item",
        ],
      },
    ],
    events: { publish: [CANVAS_OPEN_ATTACHMENTS_EVENT, SESSION_LOCATE_EVENT] },
    attachments: "read-write",
    conversation: "submit",
    downloads: true,
  },
};
